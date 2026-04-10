const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { checkLTVHealth } = require('../risk/risk.engine');

// ── TIMING-SAFE AUTH ──────────────────────────────────────────
const adminAuth = (req, res, next) => {
  const provided = req.headers['x-admin-token'] || '';
  const expected = process.env.ADMIN_TOKEN || 'lienpay-admin-2026';

  if (provided.length !== expected.length) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  const match = crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
  if (!match) {
    logger.warn('Stress route auth failure', { ip: req.ip });
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(adminAuth);

// ── STEP LOGGER ───────────────────────────────────────────────
const createLog = () => {
  const steps = [];
  const t0 = Date.now();
  return {
    add: (system, action, detail, status = 'ok') => {
      steps.push({
        ts: Date.now() - t0, system, action,
        detail: typeof detail === 'object' ? JSON.stringify(detail) : detail,
        status, time: new Date().toISOString(),
      });
      logger.info(`[STRESS ${status.toUpperCase()}] ${system}: ${action}`);
    },
    steps,
  };
};

// ── UUID VALIDATION HELPER ────────────────────────────────────
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidUUID = (id) => UUID_REGEX.test(id);

// ── LIST USERS (for stress test selector) ─────────────────────
router.get('/users', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.user_id, u.full_name,
             CONCAT('XXXXX', RIGHT(u.mobile, 5)) as mobile_masked,
             u.account_status,
             ca.credit_limit, ca.outstanding, ca.available_credit,
             ca.apr, ca.status as credit_status,
             (SELECT COUNT(*) FROM pledges WHERE user_id = u.user_id AND status = 'ACTIVE') as active_pledges,
             (SELECT COUNT(*) FROM transactions WHERE user_id = u.user_id) as total_txns
      FROM users u
      LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      WHERE u.deleted_at IS NULL
      ORDER BY u.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 1: NAV CRASH
// Default 10% drop (founder-corrected from 30%)
// ═══════════════════════════════════════════════════════════════
router.post('/scenario/nav-crash', async (req, res) => {
  const { user_id, drop_pct = 10 } = req.body; // default 10%, was 30% — founder corrected

  if (!user_id || !isValidUUID(user_id)) {
    return res.status(400).json({ success: false, error: 'Valid user_id (UUID) required' });
  }
  if (drop_pct < 0 || drop_pct > 80) {
    return res.status(400).json({ success: false, error: 'drop_pct must be 0-80' });
  }

  logger.info(`STRESS: NAV crash ${drop_pct}% for user ${user_id}`);
  const log = createLog();

  try {
    const pledges = await query(`
      SELECT p.pledge_id, p.isin, p.units_pledged, p.folio_number,
             mh.nav_at_fetch, mh.scheme_name, mh.ltv_cap
      FROM pledges p
      JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
      WHERE p.user_id = $1 AND p.status = 'ACTIVE'
    `, [user_id]);

    log.add('Portfolio', 'Fetched pledges', `${pledges.rows.length} active pledges`);

    if (!pledges.rows.length) {
      log.add('Portfolio', 'No active pledges', 'Cannot simulate NAV crash', 'warn');
      return res.json({ success: true, data: { scenario: 'nav-crash', steps: log.steps } });
    }

    const multiplier = (100 - drop_pct) / 100;
    for (const p of pledges.rows) {
      const oldNav = parseFloat(p.nav_at_fetch);
      const newNav = Math.round(oldNav * multiplier * 100) / 100;

      await query(`
        INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value, source)
        VALUES ($1, $2, CURRENT_DATE, $3, 'STRESS_TEST')
        ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $3, source = 'STRESS_TEST'
      `, [p.isin, p.scheme_name, newNav]);

      await query(`
        UPDATE mf_holdings SET nav_at_fetch = $2, value_at_fetch = $3, updated_at = NOW()
        WHERE isin = $1 AND user_id = $4
      `, [p.isin, newNav, Math.round(p.units_pledged * newNav), user_id]);

      log.add('NAV', `${(p.scheme_name || '').split(' ').slice(0,3).join(' ')}`,
        `₹${oldNav} → ₹${newNav} (−${drop_pct}%)`);
    }

    const account = await query(`
      SELECT account_id FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'
    `, [user_id]);

    if (!account.rows.length) {
      log.add('Credit', 'No active account', 'Skipping LTV check', 'warn');
      return res.json({ success: true, data: { scenario: 'nav-crash', steps: log.steps } });
    }

    log.add('Risk Engine', 'Running checkLTVHealth()', 'Calculating...');
    const ltvResult = await checkLTVHealth(user_id, account.rows[0].account_id);
    log.add('Risk Engine', 'LTV Result',
      `${ltvResult.ltv_ratio}% — ${ltvResult.status}`,
      ltvResult.status === 'RED' ? 'error' : ltvResult.status === 'AMBER' ? 'warn' : 'ok'
    );

    await query(`
      UPDATE credit_accounts SET ltv_ratio = $2, ltv_alert_level = $3, updated_at = NOW()
      WHERE account_id = $1
    `, [account.rows[0].account_id, ltvResult.ltv_ratio / 100, ltvResult.status]);

    if (ltvResult.status === 'RED') {
      await query(`
        INSERT INTO margin_calls (user_id, account_id, ltv_at_trigger, outstanding_at_trigger, status, deadline)
        VALUES ($1, $2, $3, $4, 'ISSUED', NOW() + INTERVAL '90 days')
      `, [user_id, account.rows[0].account_id, ltvResult.ltv_ratio / 100, ltvResult.outstanding || 0]);
      log.add('Margin Call', 'ISSUED', `LTV: ${ltvResult.ltv_ratio}%. Deadline: 90 days (NPA framework).`, 'error');
    } else if (ltvResult.status === 'AMBER') {
      log.add('Alert', 'AMBER warning', 'Portfolio value dropped. UPI frozen at 80% LTV.', 'warn');
    }

    res.json({ success: true, data: { scenario: 'nav-crash', drop_pct, steps: log.steps } });
  } catch (err) {
    logger.error('NAV crash scenario error:', err.message);
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 2: SPENDING SPREE
// ═══════════════════════════════════════════════════════════════
router.post('/scenario/spending-spree', async (req, res) => {
  const { user_id, num_txns = 5, amount_per_txn = 1000 } = req.body;

  if (!user_id || !isValidUUID(user_id)) {
    return res.status(400).json({ success: false, error: 'Valid user_id required' });
  }

  const log = createLog();
  try {
    const account = await query(`
      SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'
    `, [user_id]);

    if (!account.rows.length) {
      return res.status(404).json({ success: false, error: 'No active credit account' });
    }

    const merchants = ['Zomato', 'Amazon', 'Swiggy', 'Myntra', 'Flipkart'];
    let blocked = 0;

    for (let i = 0; i < Math.min(num_txns, 20); i++) {
      const merchant = merchants[i % merchants.length];
      const ref = `STRESS_${Date.now()}_${i}`;

      const acct = await query(`
        SELECT available_credit, outstanding, credit_limit FROM credit_accounts WHERE user_id = $1
      `, [user_id]);
      const avail = parseFloat(acct.rows[0]?.available_credit || 0);

      if (avail < amount_per_txn) {
        log.add('Transaction', `Txn ${i+1} BLOCKED`, `Insufficient credit: ₹${avail}`, 'warn');
        blocked++;
        continue;
      }

      await query(`
        INSERT INTO transactions
          (user_id, account_id, lsp_txn_ref, merchant_vpa, merchant_name, amount, status, is_in_free_period, initiated_at, settled_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'SETTLED', true, NOW(), NOW())
      `, [user_id, account.rows[0].account_id, ref, `${merchant.toLowerCase()}@upi`, merchant, amount_per_txn]);

      await query(`
        UPDATE credit_accounts SET
          outstanding = outstanding + $2, available_credit = available_credit - $2, updated_at = NOW()
        WHERE user_id = $1
      `, [user_id, amount_per_txn]);

      log.add('Transaction', `Txn ${i+1} settled`, `₹${amount_per_txn} at ${merchant}`);
    }

    const final = await query(`
      SELECT outstanding, available_credit FROM credit_accounts WHERE user_id = $1
    `, [user_id]);

    log.add('Summary', 'Spending complete',
      `Outstanding: ₹${final.rows[0]?.outstanding} | Available: ₹${final.rows[0]?.available_credit} | Blocked: ${blocked}`
    );

    res.json({ success: true, data: { scenario: 'spending-spree', steps: log.steps } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 3: REPAYMENT WATERFALL
// ═══════════════════════════════════════════════════════════════
router.post('/scenario/repayment-waterfall', async (req, res) => {
  const { user_id, repay_amount } = req.body;
  if (!user_id || !isValidUUID(user_id) || !repay_amount) {
    return res.status(400).json({ success: false, error: 'user_id and repay_amount required' });
  }

  const log = createLog();
  try {
    const account = await query(`
      SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'
    `, [user_id]);

    if (!account.rows.length) return res.status(404).json({ success: false, error: 'No active account' });

    const outstanding = parseFloat(account.rows[0].outstanding || 0);
    const amount = Math.min(parseFloat(repay_amount), outstanding);

    log.add('Repayment', 'Before', `Outstanding: ₹${outstanding}`);

    await query(`
      UPDATE credit_accounts SET
        outstanding = outstanding - $2, available_credit = available_credit + $2, updated_at = NOW()
      WHERE user_id = $1
    `, [user_id, amount]);

    await query(`
      INSERT INTO repayments (account_id, user_id, amount, payment_method, payment_ref, status, initiated_at, confirmed_at)
      VALUES ($1, $2, $3, 'STRESS_TEST', $4, 'SUCCESS', NOW(), NOW())
    `, [account.rows[0].account_id, user_id, amount, `STRESS_REPAY_${Date.now()}`]);

    const after = await query(`SELECT outstanding, available_credit FROM credit_accounts WHERE user_id = $1`, [user_id]);
    log.add('Repayment', 'After', `Outstanding: ₹${after.rows[0]?.outstanding} | Available: ₹${after.rows[0]?.available_credit}`);

    res.json({ success: true, data: { scenario: 'repayment-waterfall', steps: log.steps } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 4: FREE PERIOD EXPIRY
// ═══════════════════════════════════════════════════════════════
router.post('/scenario/free-period-expiry', async (req, res) => {
  const { user_id, days_forward = 35 } = req.body;
  if (!user_id || !isValidUUID(user_id)) return res.status(400).json({ success: false, error: 'user_id required' });

  const log = createLog();
  try {
    const result = await query(`
      UPDATE transactions SET
        is_in_free_period = false, updated_at = NOW()
      WHERE user_id = $1 AND is_in_free_period = true
        AND initiated_at < NOW() - INTERVAL '${Math.min(parseInt(days_forward), 365)} days'
      RETURNING txn_id, amount
    `, [user_id]);

    log.add('Free Period', 'Expired transactions', `${result.rows.length} txns now bearing interest`);
    res.json({ success: true, data: { scenario: 'free-period-expiry', steps: log.steps } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 5: FULL REPAYMENT + ACCOUNT CLOSE
// ═══════════════════════════════════════════════════════════════
router.post('/scenario/full-repayment', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id || !isValidUUID(user_id)) return res.status(400).json({ success: false, error: 'user_id required' });

  const log = createLog();
  try {
    const account = await query(`SELECT * FROM credit_accounts WHERE user_id = $1`, [user_id]);
    const outstanding = parseFloat(account.rows[0]?.outstanding || 0);

    if (outstanding > 0) {
      await query(`
        UPDATE credit_accounts SET outstanding = 0, available_credit = credit_limit, updated_at = NOW()
        WHERE user_id = $1
      `, [user_id]);
      log.add('Repayment', 'Full repayment', `₹${outstanding} cleared`);
    }

    await query(`
      UPDATE credit_accounts SET status = 'CLOSED', upi_active = false, updated_at = NOW()
      WHERE user_id = $1
    `, [user_id]);
    await query(`UPDATE pledges SET status = 'RELEASED', updated_at = NOW() WHERE user_id = $1 AND status = 'ACTIVE'`, [user_id]);
    await query(`UPDATE users SET account_status = 'CLOSED', updated_at = NOW() WHERE user_id = $1`, [user_id]);

    log.add('Account', 'CLOSED', 'All pledges released, UPI deactivated');
    res.json({ success: true, data: { scenario: 'full-repayment', steps: log.steps } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 6: FRAUD DETECTION
// ═══════════════════════════════════════════════════════════════
router.post('/scenario/fraud-detection', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id || !isValidUUID(user_id)) return res.status(400).json({ success: false, error: 'user_id required' });

  const log = createLog();
  try {
    // Elevate fraud score artificially
    for (let i = 0; i < 6; i++) {
      await query(`
        INSERT INTO otp_logs (mobile, otp_type, otp_hash, max_attempts, ip_hash, expires_at)
        SELECT mobile, 'MOBILE_VERIFY', 'test_hash', 3,
               'stress_test_ip', NOW() + INTERVAL '10 minutes'
        FROM users WHERE user_id = $1
      `, [user_id]);
    }
    log.add('Fraud', 'OTP velocity elevated', '6 OTP requests inserted → fraud score ~40');
    log.add('Fraud', 'Note', 'Score 70+ required for rejection. This elevates score to test detection threshold.');

    res.json({ success: true, data: { scenario: 'fraud-detection', steps: log.steps } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ═══════════════════════════════════════════════════════════════
// SCENARIO 7: OVERDUE DEFAULT
// ═══════════════════════════════════════════════════════════════
router.post('/scenario/overdue-default', async (req, res) => {
  const { user_id, days_overdue = 35 } = req.body;
  if (!user_id || !isValidUUID(user_id)) return res.status(400).json({ success: false, error: 'user_id required' });

  const log = createLog();
  try {
    await query(`UPDATE users SET account_status = 'OVERDUE', updated_at = NOW() WHERE user_id = $1`, [user_id]);

    if (days_overdue >= 90) {
      const account = await query(`SELECT account_id, outstanding, ltv_ratio FROM credit_accounts WHERE user_id = $1`, [user_id]);
      if (account.rows.length) {
        await query(`
          INSERT INTO margin_calls (user_id, account_id, ltv_at_trigger, outstanding_at_trigger, status, deadline)
          VALUES ($1, $2, $3, $4, 'ISSUED', NOW() + INTERVAL '90 days')
          ON CONFLICT DO NOTHING
        `, [user_id, account.rows[0].account_id, account.rows[0].ltv_ratio || 0, account.rows[0].outstanding || 0]);
        log.add('Margin Call', 'Created', `90+ days overdue — NPA territory`);
      }
    }

    log.add('User', 'Status', `OVERDUE (${days_overdue} days simulated)`);
    res.json({ success: true, data: { scenario: 'overdue-default', steps: log.steps } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ═══════════════════════════════════════════════════════════════
// RESET USER
// ═══════════════════════════════════════════════════════════════
router.post('/reset', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id || !isValidUUID(user_id)) return res.status(400).json({ success: false, error: 'user_id required' });

  const log = createLog();
  try {
    const pledgeData = await query(`
      SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total
      FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'
    `, [user_id]);
    const limit = Math.round(parseFloat(pledgeData.rows[0].total || 0));

    await query(`
      UPDATE credit_accounts SET
        status = 'ACTIVE', outstanding = 0, credit_limit = $2, available_credit = $2,
        upi_active = true, ltv_ratio = NULL, ltv_alert_level = 'GREEN',
        notorious_fund_freeze = false, updated_at = NOW()
      WHERE user_id = $1
    `, [user_id, limit]);
    log.add('Credit', 'Restored', `ACTIVE | Limit: ₹${limit} | Outstanding: ₹0`);

    await query(`UPDATE users SET account_status = 'CREDIT_ACTIVE', updated_at = NOW() WHERE user_id = $1`, [user_id]);
    await query(`DELETE FROM nav_history WHERE source = 'STRESS_TEST'`);

    const holdings = await query(`
      SELECT DISTINCT p.isin, p.nav_at_pledge, p.units_pledged
      FROM pledges p WHERE p.user_id = $1 AND p.status = 'ACTIVE'
    `, [user_id]);
    for (const h of holdings.rows) {
      await query(`
        UPDATE mf_holdings SET nav_at_fetch = $2, value_at_fetch = $3, updated_at = NOW()
        WHERE isin = $1 AND user_id = $4
      `, [h.isin, h.nav_at_pledge, Math.round(h.units_pledged * parseFloat(h.nav_at_pledge)), user_id]);
    }
    log.add('NAV', 'Restored', 'Stress test NAVs removed');

    await query(`DELETE FROM transactions WHERE user_id = $1 AND lsp_txn_ref LIKE 'STRESS_%'`, [user_id]);
    await query(`DELETE FROM margin_calls WHERE user_id = $1`, [user_id]);
    await query(`DELETE FROM repayments WHERE user_id = $1 AND payment_method LIKE 'STRESS%'`, [user_id]);
    log.add('Cleanup', 'Done', 'All stress artifacts removed');

    res.json({ success: true, message: 'User reset to clean ACTIVE state', steps: log.steps });
  } catch (err) {
    logger.error('Reset error:', err.message);
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

module.exports = router;
