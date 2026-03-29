const { query }         = require('../../config/database');
const { fetchAMFINavs } = require('../portfolio/nav.service');
const { checkLTVHealth } = require('../risk/risk.engine');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// NAV MONITORING SERVICE  (LienPay / LSP Role)
//
// RBI Digital Lending Directions 2025 — LSP Responsibilities:
//
//   ✅ LienPay CAN:
//      - Fetch NAVs and calculate LTV (data collection is our job)
//      - Update portfolio values in our DB
//      - Send IN-APP notifications to user (our app, our notifications)
//      - Fire webhooks to NBFC with LTV breach data
//      - Store margin call records created by NBFC
//
//   ❌ LienPay CANNOT:
//      - Send SMS to users (pledge is in NBFC's name — SMS must come from NBFC)
//      - Issue margin calls unilaterally (NBFC is the RE, they decide)
//      - Invoke/redeem units without NBFC's explicit authorization
//      - Make any credit decisions (only the NBFC / RE can do this)
//
// FLOW:
//   LienPay cron → calculate LTV → webhook to NBFC → NBFC decides →
//   NBFC calls POST /api/nbfc/margin-call/issue or /pledge/invoke →
//   LienPay executes only with NBFC's signed authorization
// ─────────────────────────────────────────────────────────────

// ── NBFC WEBHOOK DELIVERY ─────────────────────────────────────
/**
 * Fire a webhook to the NBFC's endpoint.
 * The NBFC registers their URL via POST /api/nbfc/webhook/register
 * or via the NBFC_WEBHOOK_URL env variable.
 *
 * The NBFC's system receives this and:
 *   - Sends SMS to the user
 *   - Makes the margin call decision
 *   - Updates their own loan management system
 */
const fireNBFCWebhook = async (event, payload) => {
  const webhookUrl = process.env.NBFC_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn('NBFC_WEBHOOK_URL not configured — LTV event logged but not dispatched', { event });
    return { dispatched: false, reason: 'NBFC_WEBHOOK_URL not set' };
  }

  try {
    const body = {
      event,
      timestamp:     new Date().toISOString(),
      source:        'LienPay-LSP',
      lsp_id:        process.env.NBFC_CLIENT_ID || 'lienpay-lsp',
      payload,
    };

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-LienPay-Event': event,
        'X-Webhook-Secret': process.env.NBFC_WEBHOOK_SECRET || '',
      },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });

    clearTimeout(timeout);

    const success = res.status >= 200 && res.status < 300;
    logger.info(`Webhook ${event} ${success ? '✅ delivered' : '❌ failed'}`, {
      status: res.status,
      url:    webhookUrl,
    });

    // Log webhook delivery for compliance audit
    await query(`
      INSERT INTO audit_trail (event_type, entity_type, new_values, created_at)
      VALUES ('NBFC_WEBHOOK_SENT', 'system', $1, NOW())
    `, [JSON.stringify({ event, status: res.status, success })]).catch(() => {});

    return { dispatched: true, status: res.status, success };
  } catch (err) {
    logger.error('NBFC webhook delivery failed:', err.message);
    return { dispatched: false, error: err.message };
  }
};

// ── IN-APP NOTIFICATION (allowed — it's LienPay's own app) ───
/**
 * Store an in-app notification for the user.
 * This is different from SMS — we own the app interface,
 * so we can show alerts inside it. The NBFC sends SMS externally.
 */
const createInAppAlert = async (userId, type, data) => {
  const templates = {
    LTV_AMBER: {
      content: `Portfolio alert: LTV at ${data.ltv_pct}%. Monitor your collateral value.`,
      channel: 'PUSH',
    },
    LTV_RED: {
      content: `Urgent: LTV at ${data.ltv_pct}%. Your lending partner has been notified and will contact you.`,
      channel: 'PUSH',
    },
    LTV_RECOVERED: {
      content: `LTV back to safe levels (${data.ltv_pct}%). Credit line is healthy.`,
      channel: 'PUSH',
    },
  };

  const tpl = templates[type];
  if (!tpl) return;

  await query(`
    INSERT INTO notifications
      (user_id, type, channel, status, content_preview, sent_at, created_at)
    VALUES ($1, $2, $3, 'SENT', $4, NOW(), NOW())
  `, [userId, type, tpl.channel, tpl.content.slice(0, 100)]).catch(() => {
    // Non-blocking — notification failure shouldn't stop monitoring
  });
};

// ── MAIN: RUN DAILY NAV MONITORING ───────────────────────────
const runDailyNAVMonitoring = async () => {
  const startTime = Date.now();
  logger.info('🌙 Starting daily NAV monitoring (LSP data layer)...');

  const results = {
    date:             new Date().toISOString().split('T')[0],
    accounts_checked: 0,
    green:            0,
    amber:            0,
    red:              0,
    webhooks_fired:   0,
    inapp_sent:       0,
    errors:           0,
  };

  try {
    // 1. Fetch all NAVs from AMFI (LienPay's data job)
    const navMap = await fetchAMFINavs();
    logger.info(`📊 AMFI NAVs fetched: ${Object.keys(navMap).length} schemes`);

    // 2. Update NAVs for all active pledged holdings in our DB
    await updatePledgedHoldingNAVs(navMap);

    // 3. Get all active accounts with outstanding balance
    const accounts = await query(`
      SELECT ca.account_id, ca.user_id, ca.outstanding,
             ca.credit_limit, ca.available_credit, ca.apr,
             ca.ltv_alert_level
      FROM credit_accounts ca
      WHERE ca.status = 'ACTIVE'
        AND ca.outstanding > 0
    `);

    results.accounts_checked = accounts.rows.length;

    // 4. For each account: calculate LTV, update DB, notify NBFC via webhook
    for (const account of accounts.rows) {
      try {
        const health       = await checkLTVHealth(account.user_id, account.account_id);
        const prevLevel    = account.ltv_alert_level || 'GREEN';
        const levelChanged = health.status !== prevLevel;

        // Update LTV on account record (LienPay's DB — our job)
        await query(`
          UPDATE credit_accounts
          SET ltv_ratio       = $2,
              ltv_alert_level = $3,
              updated_at      = NOW()
          WHERE account_id = $1
        `, [account.account_id, health.ltv_ratio, health.status]);

        // Store snapshot for historical analysis
        await query(`
          INSERT INTO ltv_snapshots
            (user_id, account_id, ltv_ratio, status, outstanding, snapshot_date)
          VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
          ON CONFLICT (user_id, snapshot_date)
          DO UPDATE SET
            ltv_ratio   = EXCLUDED.ltv_ratio,
            status      = EXCLUDED.status,
            outstanding = EXCLUDED.outstanding
        `, [
          account.user_id,
          account.account_id,
          health.ltv_ratio,
          health.status,
          account.outstanding,
        ]).catch(() => {});

        switch (health.status) {
          case 'GREEN':
            results.green++;
            // If recovering from alert — notify user in-app, tell NBFC
            if (levelChanged && prevLevel !== 'GREEN') {
              await createInAppAlert(account.user_id, 'LTV_RECOVERED', {
                ltv_pct: health.ltv_ratio.toFixed(1),
              });
              results.inapp_sent++;

              await fireNBFCWebhook('ltv.recovered', {
                user_id:    account.user_id,
                account_id: account.account_id,
                ltv_ratio:  health.ltv_ratio,
                previous_status: prevLevel,
              });
              results.webhooks_fired++;
            }
            break;

          case 'AMBER':
            results.amber++;
            // In-app alert (LienPay is allowed to do this)
            await createInAppAlert(account.user_id, 'LTV_AMBER', {
              ltv_pct: health.ltv_ratio.toFixed(1),
            });
            results.inapp_sent++;

            // Webhook to NBFC — THEY decide whether to issue margin call and send SMS
            await fireNBFCWebhook('ltv.amber_alert', {
              user_id:    account.user_id,
              account_id: account.account_id,
              ltv_ratio:  health.ltv_ratio,
              outstanding:    parseFloat(account.outstanding),
              shortfall:      health.shortfall || 0,
              message:    health.message,
              note:       'NBFC should issue margin call warning and send SMS/email per RBI guidelines',
            });
            results.webhooks_fired++;

            audit('LTV_AMBER_WEBHOOK_SENT', account.user_id, {
              account_id: account.account_id,
              ltv_ratio:  health.ltv_ratio,
            });
            break;

          case 'RED':
            results.red++;
            // In-app alert
            await createInAppAlert(account.user_id, 'LTV_RED', {
              ltv_pct: health.ltv_ratio.toFixed(1),
            });
            results.inapp_sent++;

            // Webhook to NBFC — NBFC must:
            //   1. Send margin call SMS/email to user
            //   2. Call POST /api/nbfc/margin-call/issue to formally record the call
            //   3. After 3 business days with no resolution, call POST /api/nbfc/pledge/invoke
            await fireNBFCWebhook('ltv.red_alert', {
              user_id:    account.user_id,
              account_id: account.account_id,
              ltv_ratio:  health.ltv_ratio,
              outstanding:    parseFloat(account.outstanding),
              shortfall:      health.shortfall || 0,
              message:    health.message,
              action_required: 'ISSUE_MARGIN_CALL',
              instructions: [
                'Send margin call SMS/email to borrower (NBFC obligation per RBI)',
                'Call POST /api/nbfc/margin-call/issue to record margin call in LienPay',
                'Per RBI NPA framework: 90 days of non-payment → NPA → call POST /api/nbfc/pledge/invoke',
              ],
            });
            results.webhooks_fired++;

            audit('LTV_RED_WEBHOOK_SENT', account.user_id, {
              account_id: account.account_id,
              ltv_ratio:  health.ltv_ratio,
              outstanding: account.outstanding,
            });
            break;
        }

      } catch (err) {
        logger.error(`LTV check failed for account ${account.account_id}:`, err.message);
        results.errors++;
      }
    }

    // 5. Store monitoring run summary in audit trail
    const duration = Date.now() - startTime;
    await query(`
      INSERT INTO audit_trail (event_type, entity_type, new_values, created_at)
      VALUES ('DAILY_NAV_MONITORING_COMPLETE', 'system', $1, NOW())
    `, [JSON.stringify({ ...results, duration_ms: duration })]).catch(() => {});

    logger.info('✅ Daily NAV monitoring complete', results);
  } catch (err) {
    logger.error('❌ NAV monitoring run failed:', err.message);
    results.errors++;
  }

  return results;
};

// ── UPDATE PLEDGED HOLDING NAVs (LienPay's data job) ─────────
const updatePledgedHoldingNAVs = async (navMap) => {
  const today = new Date().toISOString().split('T')[0];

  const pledges = await query(`
    SELECT DISTINCT p.isin, mh.scheme_name
    FROM pledges p
    JOIN mf_holdings mh ON mh.isin = p.isin AND mh.user_id = p.user_id
    WHERE p.status = 'ACTIVE'
  `).catch(() => ({ rows: [] }));

  let updated = 0;
  for (const pledge of pledges.rows) {
    const navData = navMap[pledge.isin];
    if (!navData) continue;

    await query(`
      INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $4
    `, [pledge.isin, pledge.scheme_name, today, navData.nav]).catch(() => {});

    updated++;
  }

  logger.info(`📈 Updated NAVs for ${updated} pledged funds`);
  return updated;
};

// ── GET LTV HEALTH SUMMARY (API helper) ──────────────────────
const getLTVHealthSummary = async (userId) => {
  const result = await query(`
    SELECT
      ca.ltv_ratio,
      ca.ltv_alert_level,
      ca.outstanding,
      ca.available_credit,
      ca.credit_limit,
      COUNT(p.pledge_id) as pledge_count,
      COALESCE(SUM(p.units_pledged * COALESCE(n.nav_value, p.nav_at_pledge)), 0) as current_pledge_value
    FROM credit_accounts ca
    LEFT JOIN pledges p ON p.user_id = ca.user_id AND p.status = 'ACTIVE'
    LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
    WHERE ca.user_id = $1
    GROUP BY ca.account_id, ca.ltv_ratio, ca.ltv_alert_level,
             ca.outstanding, ca.available_credit, ca.credit_limit
  `, [userId]);

  return result.rows[0] || null;
};

module.exports = {
  runDailyNAVMonitoring,
  getLTVHealthSummary,
  updatePledgedHoldingNAVs,
  fireNBFCWebhook, // exported so nbfc.routes can use it for ad-hoc notifications
};
