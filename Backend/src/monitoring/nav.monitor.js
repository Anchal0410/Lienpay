const { query }  = require('../../config/database');
const { fetchAMFINavs } = require('../portfolio/nav.service');
const { checkLTVHealth } = require('../risk/risk.engine');
const { sendSMS }   = require('../utils/sms.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// NAV MONITORING SERVICE
//
// Runs every day after 11pm (after AMFI updates NAVs).
// For every active user:
// 1. Fetch latest NAVs from AMFI
// 2. Update portfolio values
// 3. Calculate new LTV ratios
// 4. Trigger alerts if LTV is AMBER or RED
// 5. Initiate pledge invocation if RED + 3 days no action
// ─────────────────────────────────────────────────────────────

// ── MAIN: RUN DAILY NAV MONITORING ───────────────────────────
const runDailyNAVMonitoring = async () => {
  const startTime = Date.now();
  logger.info('🌙 Starting daily NAV monitoring...');

  const results = {
    date:            new Date().toISOString().split('T')[0],
    accounts_checked: 0,
    green:           0,
    amber:           0,
    red:             0,
    alerts_sent:     0,
    errors:          0,
  };

  try {
    // 1. Fetch all NAVs from AMFI (one call for all funds)
    const navMap = await fetchAMFINavs();
    logger.info(`📊 AMFI NAVs fetched: ${Object.keys(navMap).length} schemes`);

    // 2. Update NAVs for all active pledged holdings
    await updatePledgedHoldingNAVs(navMap);

    // 3. Get all active accounts with outstanding balance
    const accounts = await query(`
      SELECT ca.account_id, ca.user_id, ca.outstanding,
             ca.credit_limit, ca.available_credit, ca.apr,
             ca.ltv_alert_level, ca.margin_call_issued_at
      FROM credit_accounts ca
      WHERE ca.status = 'ACTIVE'
        AND ca.outstanding > 0
    `);

    results.accounts_checked = accounts.rows.length;

    // 4. Check LTV health for each account
    for (const account of accounts.rows) {
      try {
        const health = await checkLTVHealth(account.user_id, account.account_id);
        await processLTVHealth(account, health, results);
      } catch (err) {
        logger.error(`LTV check failed for account ${account.account_id}:`, err.message);
        results.errors++;
      }
    }

    // 5. Store monitoring run in audit trail
    await query(`
      INSERT INTO audit_trail (event_type, entity_type, new_values)
      VALUES ('DAILY_NAV_MONITORING', 'system', $1)
    `, [JSON.stringify({ ...results, duration_ms: Date.now() - startTime })]);

    logger.info('✅ Daily NAV monitoring complete', results);

  } catch (err) {
    logger.error('NAV monitoring failed:', err.message);
    results.errors++;
  }

  return results;
};

// ── UPDATE PLEDGED HOLDING NAVs ───────────────────────────────
const updatePledgedHoldingNAVs = async (navMap) => {
  const today = new Date().toISOString().split('T')[0];

  // Get all active pledges with their ISINs
  const pledges = await query(`
    SELECT DISTINCT p.isin, mh.scheme_name
    FROM pledges p
    JOIN mf_holdings mh ON mh.isin = p.isin AND mh.user_id = p.user_id
    WHERE p.status = 'ACTIVE'
  `);

  let updated = 0;
  for (const pledge of pledges.rows) {
    const navData = navMap[pledge.isin];
    if (!navData) continue;

    // Store in nav_history
    await query(`
      INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $4
    `, [pledge.isin, pledge.scheme_name, today, navData.nav]);

    updated++;
  }

  logger.info(`📈 Updated NAVs for ${updated} pledged funds`);
  return updated;
};

// ── PROCESS LTV HEALTH RESULT ─────────────────────────────────
const processLTVHealth = async (account, health, results) => {
  const prevAlertLevel = account.ltv_alert_level || 'GREEN';

  // Update LTV health on account
  await query(`
    UPDATE credit_accounts SET
      ltv_ratio        = $2,
      ltv_alert_level  = $3,
      updated_at       = NOW()
    WHERE account_id = $1
  `, [account.account_id, health.ltv_ratio, health.status]);

  switch (health.status) {
    case 'GREEN':
      results.green++;
      // If recovering from AMBER/RED — send recovery notification
      if (prevAlertLevel !== 'GREEN') {
        await sendSMS(account.user_id, 'LTV_RECOVERED', {
          ltv: `${health.ltv_ratio}%`,
        }).catch(() => {});
      }
      break;

    case 'AMBER':
      results.amber++;
      results.alerts_sent++;
      await sendAmberAlert(account, health);
      break;

    case 'RED':
      results.red++;
      results.alerts_sent++;
      await sendRedAlert(account, health, prevAlertLevel);
      break;
  }
};

// ── SEND AMBER ALERT ──────────────────────────────────────────
const sendAmberAlert = async (account, health) => {
  await sendSMS(account.user_id, 'LTV_AMBER', {
    ltv:       `${health.ltv_ratio}%`,
    shortfall: `₹${health.shortfall?.toLocaleString('en-IN') || '0'}`,
    message:   health.message,
  }).catch(() => {});

  audit('LTV_AMBER_ALERT', account.user_id, {
    account_id: account.account_id,
    ltv_ratio:  health.ltv_ratio,
    outstanding: account.outstanding,
  });
};

// ── SEND RED ALERT + MARGIN CALL ─────────────────────────────
const sendRedAlert = async (account, health, prevAlertLevel) => {
  const isNewMarginCall = prevAlertLevel !== 'RED';

  if (isNewMarginCall) {
    // Issue margin call — record timestamp
    await query(`
      UPDATE credit_accounts SET
        margin_call_issued_at = NOW(),
        updated_at            = NOW()
      WHERE account_id = $1
    `, [account.account_id]);

    await sendSMS(account.user_id, 'MARGIN_CALL', {
      shortfall: `₹${health.shortfall?.toLocaleString('en-IN') || '0'}`,
      deadline:  '3 business days',
      action:    'Add more mutual funds as collateral or repay outstanding',
    }).catch(() => {});

    audit('MARGIN_CALL_ISSUED', account.user_id, {
      account_id: account.account_id,
      ltv_ratio:  health.ltv_ratio,
      shortfall:  health.shortfall,
    });
  }

  // Check if margin call deadline exceeded (3 business days)
  if (account.margin_call_issued_at) {
    const issuedAt    = new Date(account.margin_call_issued_at);
    const businessDaysElapsed = getBusinessDaysBetween(issuedAt, new Date());

    if (businessDaysElapsed >= 3) {
      logger.warn('⚠️ Margin call deadline exceeded — initiating pledge invocation', {
        account_id: account.account_id,
        user_id:    account.user_id,
      });

      await initiatePledgeInvocation(account, health);
    }
  }
};

// ── INITIATE PLEDGE INVOCATION (on default) ──────────────────
const initiatePledgeInvocation = async (account, health) => {
  const { invokePledgeForDefault } = require('../pledge/pledge.service');

  // Get active pledges
  const pledges = await query(
    "SELECT pledge_id FROM pledges WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1",
    [account.user_id]
  );

  if (!pledges.rows.length) return;

  try {
    await invokePledgeForDefault(
      account.user_id,
      pledges.rows[0].pledge_id,
      parseFloat(account.outstanding)
    );

    await sendSMS(account.user_id, 'PLEDGE_INVOKED', {
      amount: `₹${parseFloat(account.outstanding).toLocaleString('en-IN')}`,
      reason: 'Margin call not resolved within 3 business days',
    }).catch(() => {});

  } catch (err) {
    logger.error('Pledge invocation failed:', err.message);
  }
};

// ── BUSINESS DAY CALCULATOR ───────────────────────────────────
const getBusinessDaysBetween = (startDate, endDate) => {
  let count = 0;
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
};

// ── GET LTV HEALTH SUMMARY ────────────────────────────────────
const getLTVHealthSummary = async (userId) => {
  const result = await query(`
    SELECT
      ca.ltv_ratio,
      ca.ltv_alert_level,
      ca.outstanding,
      ca.available_credit,
      ca.credit_limit,
      ca.margin_call_issued_at,
      COUNT(p.pledge_id) as pledge_count,
      SUM(p.units_pledged * COALESCE(n.nav_value, p.nav_at_pledge)) as current_pledge_value
    FROM credit_accounts ca
    LEFT JOIN pledges p ON p.user_id = ca.user_id AND p.status = 'ACTIVE'
    LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
    WHERE ca.user_id = $1
    GROUP BY ca.account_id, ca.ltv_ratio, ca.ltv_alert_level,
             ca.outstanding, ca.available_credit, ca.credit_limit,
             ca.margin_call_issued_at
  `, [userId]);

  return result.rows[0] || null;
};

module.exports = {
  runDailyNAVMonitoring,
  getLTVHealthSummary,
  updatePledgedHoldingNAVs,
};
