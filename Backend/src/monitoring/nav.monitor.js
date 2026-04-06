const { query }         = require('../../config/database');
const { fetchNAVsByISIN } = require('../portfolio/mf_central.service');
const { checkLTVHealth } = require('../risk/risk.engine');
const { logger, audit } = require('../../config/logger');
const { runNotoriousFundCheck } = require('../portfolio/notorious.service');

// ─────────────────────────────────────────────────────────────
// NAV MONITORING SERVICE  (LienPay LSP — Data Layer Only)
//
// RBI Digital Lending Directions 2025:
//
//  ✅ LienPay CAN:
//    - Fetch NAVs from MF Central / AMFI (data collection is our job)
//    - Recalculate LTV for all accounts
//    - Send IN-APP notifications (we own the app)
//    - Fire webhooks to NBFC with LTV breach data
//    - Freeze UPI at 80% LTV (this is OUR product feature — not a credit decision)
//    - Flag notorious funds and freeze UPI for affected users
//
//  ❌ LienPay CANNOT:
//    - Send SMS (pledge is in NBFC's name — SMS must come from NBFC)
//    - Issue margin calls (NBFC's credit decision)
//    - Invoke/redeem pledge units (NBFC authorizes, LienPay only executes with auth ref)
//    - Make credit decisions (only NBFC can)
//
// DAILY CRON SEQUENCE (11:30pm IST):
//   1. Fetch NAVs via MF Central / AMFI
//   2. Update nav_history + mf_holdings
//   3. Check all active pledges for notorious funds
//   4. Recalculate LTV for all accounts with outstanding > 0
//   5. If LTV ≥ 80%: freeze UPI (our product rule)
//   6. If LTV ≥ 90%: fire RED webhook to NBFC + in-app alert
//   7. If LTV 80-89%: fire AMBER webhook to NBFC + in-app alert + keep UPI frozen
//   8. If LTV < 80%: unfreeze UPI (if was frozen for LTV reason, not notorious)
// ─────────────────────────────────────────────────────────────

// ── NBFC WEBHOOK DELIVERY ─────────────────────────────────────
const fireNBFCWebhook = async (event, payload) => {
  const webhookUrl = process.env.NBFC_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.warn('NBFC_WEBHOOK_URL not configured — event logged but not dispatched', { event });
    return { dispatched: false };
  }

  try {
    const body = {
      event,
      timestamp: new Date().toISOString(),
      source:    'LienPay-LSP',
      lsp_id:    process.env.NBFC_CLIENT_ID || 'lienpay-lsp',
      payload,
    };

    const controller = new AbortController();
    const timeout    = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(webhookUrl, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/json',
        'X-LienPay-Event':  event,
        'X-Webhook-Secret': process.env.NBFC_WEBHOOK_SECRET || '',
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const success = res.status >= 200 && res.status < 300;

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

// ── IN-APP ALERT (LienPay owns the app — this is allowed) ────
const createInAppAlert = async (userId, type, data = {}) => {
  const templates = {
    LTV_AMBER: {
      content: `Portfolio alert: LTV at ${data.ltv_pct}%. UPI spending is paused. Repay or add collateral.`,
    },
    LTV_RED: {
      content: `Urgent: LTV at ${data.ltv_pct}%. Your lending partner has been notified and will contact you.`,
    },
    LTV_RECOVERED: {
      content: `LTV back to safe levels (${data.ltv_pct}%). UPI spending restored.`,
    },
    UPI_FROZEN_LTV: {
      content: `UPI paused: Portfolio LTV reached 80%. Repay or pledge more to resume spending.`,
    },
    UPI_UNFROZEN_LTV: {
      content: `UPI restored: Your LTV is now below 80%. You can spend again.`,
    },
  };

  const tpl = templates[type];
  if (!tpl) return;

  await query(`
    INSERT INTO notifications
      (user_id, type, channel, status, content_preview, sent_at, created_at)
    VALUES ($1, $2, 'PUSH', 'SENT', $3, NOW(), NOW())
  `, [userId, type, tpl.content.slice(0, 100)]).catch(() => {});
};

// ── MAIN: DAILY NAV MONITORING ────────────────────────────────
const runDailyNAVMonitoring = async () => {
  const startTime = Date.now();
  logger.info('🌙 Starting daily NAV monitoring (LienPay LSP)...');

  const results = {
    date:              new Date().toISOString().split('T')[0],
    accounts_checked:  0,
    green:             0,
    amber:             0,
    red:               0,
    upi_frozen:        0,
    upi_unfrozen:      0,
    webhooks_fired:    0,
    inapp_sent:        0,
    notorious_check:   null,
    errors:            0,
  };

  try {
    // STEP 1: Run notorious fund check first
    results.notorious_check = await runNotoriousFundCheck().catch(err => {
      logger.error('Notorious fund check failed (non-blocking):', err.message);
      return { error: err.message };
    });

    // STEP 2: Fetch all ISINs from active pledges
    const activePledgeIsins = await query(`
      SELECT DISTINCT p.isin, mh.scheme_name
      FROM pledges p
      JOIN mf_holdings mh ON mh.isin = p.isin AND mh.user_id = p.user_id
      WHERE p.status = 'ACTIVE'
    `).catch(() => ({ rows: [] }));

    // STEP 3: Fetch NAVs from MF Central
    const isins  = activePledgeIsins.rows.map(r => r.isin);
    const navMap = isins.length > 0
      ? await fetchNAVsByISIN(isins).catch(() => ({}))
      : {};

    logger.info(`📊 NAVs fetched: ${Object.keys(navMap).length} schemes via MF Central`);

    // STEP 4: Update nav_history and mf_holdings
    await updatePledgedHoldingNAVs(navMap, activePledgeIsins.rows);

    // STEP 5: Get all active accounts with outstanding balance
    const accounts = await query(`
      SELECT ca.account_id, ca.user_id, ca.outstanding,
             ca.credit_limit, ca.available_credit, ca.apr,
             ca.ltv_alert_level, ca.upi_active,
             ca.notorious_fund_freeze
      FROM credit_accounts ca
      WHERE ca.status = 'ACTIVE' AND ca.outstanding > 0
    `);

    results.accounts_checked = accounts.rows.length;

    // STEP 6: Process each account
    for (const account of accounts.rows) {
      try {
        const health     = await checkLTVHealth(account.user_id, account.account_id);
        const prevLevel  = account.ltv_alert_level || 'GREEN';
        const ltv        = health.ltv_ratio;
        const ltvPct     = ltv.toFixed(1);

        // Update LTV on account
        await query(`
          UPDATE credit_accounts
          SET ltv_ratio       = $2,
              ltv_alert_level = $3,
              updated_at      = NOW()
          WHERE account_id = $1
        `, [account.account_id, ltv, health.status]);

        // Store snapshot
        await query(`
          INSERT INTO ltv_snapshots
            (user_id, account_id, ltv_ratio, status, outstanding, snapshot_date)
          VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)
          ON CONFLICT (user_id, snapshot_date)
          DO UPDATE SET ltv_ratio = EXCLUDED.ltv_ratio,
                        status = EXCLUDED.status,
                        outstanding = EXCLUDED.outstanding
        `, [account.user_id, account.account_id, ltv, health.status, account.outstanding]).catch(() => {});

        // ── UPI FREEZE LOGIC (LienPay product rule, not credit decision) ──
        // Freeze at 80% LTV — ensures fund maintains 50% of its value as buffer
        // Notorious fund freeze is handled separately by notorious.service.js
        const shouldFreezeForLTV = ltv >= 80 && !account.notorious_fund_freeze;
        const shouldUnfreezeForLTV = ltv < 80 && account.upi_active === false && !account.notorious_fund_freeze;

        if (shouldFreezeForLTV && account.upi_active) {
          await query(`
            UPDATE credit_accounts
            SET upi_active = false, updated_at = NOW()
            WHERE account_id = $1
          `, [account.account_id]);

          await createInAppAlert(account.user_id, 'UPI_FROZEN_LTV', { ltv_pct: ltvPct });
          results.upi_frozen++;
          audit('UPI_FROZEN_LTV_80', account.user_id, { account_id: account.account_id, ltv });
        }

        if (shouldUnfreezeForLTV) {
          await query(`
            UPDATE credit_accounts
            SET upi_active = true, updated_at = NOW()
            WHERE account_id = $1
          `, [account.account_id]);

          await createInAppAlert(account.user_id, 'UPI_UNFROZEN_LTV', { ltv_pct: ltvPct });
          results.upi_unfrozen++;
        }

        // ── LTV STATE NOTIFICATIONS & WEBHOOKS ──
        switch (health.status) {
          case 'GREEN':
            results.green++;
            if (prevLevel !== 'GREEN') {
              await createInAppAlert(account.user_id, 'LTV_RECOVERED', { ltv_pct: ltvPct });
              results.inapp_sent++;
              await fireNBFCWebhook('ltv.recovered', {
                user_id:    account.user_id,
                account_id: account.account_id,
                ltv_ratio:  ltv,
                previous_status: prevLevel,
              });
              results.webhooks_fired++;
            }
            break;

          case 'AMBER':
            results.amber++;
            await createInAppAlert(account.user_id, 'LTV_AMBER', { ltv_pct: ltvPct });
            results.inapp_sent++;

            await fireNBFCWebhook('ltv.amber_alert', {
              user_id:    account.user_id,
              account_id: account.account_id,
              ltv_ratio:  ltv,
              outstanding: parseFloat(account.outstanding),
              shortfall:   health.shortfall || 0,
              upi_status: 'FROZEN',
              note:       'UPI frozen by LienPay at 80% LTV. NBFC to decide on margin call actions.',
            });
            results.webhooks_fired++;

            audit('LTV_AMBER_NOTIFIED', account.user_id, {
              account_id: account.account_id,
              ltv_ratio:  ltv,
            });
            break;

          case 'RED':
            results.red++;
            await createInAppAlert(account.user_id, 'LTV_RED', { ltv_pct: ltvPct });
            results.inapp_sent++;

            await fireNBFCWebhook('ltv.red_alert', {
              user_id:    account.user_id,
              account_id: account.account_id,
              ltv_ratio:  ltv,
              outstanding: parseFloat(account.outstanding),
              shortfall:   health.shortfall || 0,
              upi_status: 'FROZEN',
              action_required: 'ISSUE_MARGIN_CALL',
              has_notorious_funds: health.has_notorious_funds,
              instructions: [
                'LienPay has frozen UPI spending (LTV ≥ 80%)',
                'NBFC must send margin call SMS/email to borrower per RBI guidelines',
                'Call POST /api/nbfc/margin-call/issue to record margin call in LienPay',
                'Per RBI NPA framework: if unresolved after 90 days, call POST /api/nbfc/pledge/invoke',
              ],
            });
            results.webhooks_fired++;

            audit('LTV_RED_NOTIFIED', account.user_id, {
              account_id:  account.account_id,
              ltv_ratio:   ltv,
              outstanding: account.outstanding,
            });
            break;
        }

      } catch (err) {
        logger.error(`LTV check failed for account ${account.account_id}:`, err.message);
        results.errors++;
      }
    }

    // STEP 7: Store cron run summary
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

// ── UPDATE NAV HISTORY ────────────────────────────────────────
const updatePledgedHoldingNAVs = async (navMap, pledgeRows) => {
  const today   = new Date().toISOString().split('T')[0];
  let updated   = 0;

  for (const pledge of pledgeRows) {
    const navData = navMap[pledge.isin];
    if (!navData) continue;

    await query(`
      INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $4
    `, [pledge.isin, pledge.scheme_name, today, navData.nav]).catch(() => {});

    updated++;
  }

  logger.info(`📈 Updated NAVs for ${updated} pledged funds via MF Central`);
  return updated;
};

// ── GET LTV HEALTH SUMMARY (API helper) ──────────────────────
const getLTVHealthSummary = async (userId) => {
  const result = await query(`
    SELECT
      ca.ltv_ratio, ca.ltv_alert_level, ca.outstanding,
      ca.available_credit, ca.credit_limit, ca.upi_active,
      COUNT(p.pledge_id) as pledge_count,
      COALESCE(SUM(p.units_pledged * COALESCE(n.nav_value, p.nav_at_pledge)), 0) as current_pledge_value
    FROM credit_accounts ca
    LEFT JOIN pledges p ON p.user_id = ca.user_id AND p.status = 'ACTIVE'
    LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
    WHERE ca.user_id = $1
    GROUP BY ca.account_id, ca.ltv_ratio, ca.ltv_alert_level,
             ca.outstanding, ca.available_credit, ca.credit_limit, ca.upi_active
  `, [userId]);

  return result.rows[0] || null;
};

module.exports = {
  runDailyNAVMonitoring,
  getLTVHealthSummary,
  updatePledgedHoldingNAVs,
  fireNBFCWebhook,
  createInAppAlert,
};
