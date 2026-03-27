const express = require('express');
const router = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { checkLTVHealth } = require('../risk/risk.engine');

const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'lienpay-admin-2026')) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(adminAuth);

const createLog = () => {
  const steps = [];
  const t0 = Date.now();
  return {
    add: (system, action, detail, status = 'ok') => {
      steps.push({ ts: Date.now() - t0, system, action, detail: typeof detail === 'object' ? JSON.stringify(detail) : detail, status, time: new Date().toISOString() });
      console.log(`  [STRESS ${status.toUpperCase()}] ${system}: ${action}`);
    },
    steps,
  };
};

// ── LIST USERS ──
router.get('/users', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.user_id, u.full_name, u.mobile, u.account_status,
             ca.credit_limit, ca.outstanding, ca.available_credit, ca.apr, ca.status as credit_status,
             (SELECT COUNT(*) FROM pledges WHERE user_id = u.user_id AND status = 'ACTIVE') as active_pledges,
             (SELECT COUNT(*) FROM transactions WHERE user_id = u.user_id) as total_txns
      FROM users u LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 1: NAV CRASH
// ══════════════════════════════════════════════════════════════
router.post('/scenario/nav-crash', async (req, res) => {
  const { user_id, drop_pct = 30 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  console.log(`\n${'█'.repeat(60)}\n🔴 STRESS TEST: NAV CRASH — ${drop_pct}% DROP\n${'█'.repeat(60)}`);
  const log = createLog();

  try {
    const pledges = await query(`
      SELECT p.pledge_id, p.isin, p.units_pledged, p.folio_number,
             mh.nav_at_fetch, mh.scheme_name, mh.ltv_cap
      FROM pledges p
      JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
      WHERE p.user_id = $1 AND p.status = 'ACTIVE'
    `, [user_id]);
    log.add('Portfolio', 'Fetched pledges', `${pledges.rows.length} active pledges found`);

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
      log.add('NAV Monitor', `${(p.scheme_name || '').split(' ').slice(0, 3).join(' ')}`, `₹${oldNav} → ₹${newNav} (−${drop_pct}%)`);
    }

    // Also update mf_holdings nav so the app reflects it
    for (const p of pledges.rows) {
      const newNav = Math.round(parseFloat(p.nav_at_fetch) * multiplier * 100) / 100;
      const newValue = Math.round(p.units_pledged * newNav);
      await query(`UPDATE mf_holdings SET nav_at_fetch = $2, value_at_fetch = $3, updated_at = NOW() WHERE isin = $1 AND user_id = $4`, [p.isin, newNav, newValue, user_id]);
    }
    log.add('Portfolio', 'Holdings updated', 'mf_holdings NAVs + values updated for app display');

    const account = await query("SELECT account_id FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    if (!account.rows.length) {
      log.add('Credit', 'No active account', 'Skipping LTV check', 'warn');
      return res.json({ success: true, data: { scenario: 'nav-crash', steps: log.steps } });
    }

    log.add('Risk Engine', 'Running checkLTVHealth()', 'Calculating...');
    const ltvResult = await checkLTVHealth(user_id, account.rows[0].account_id);
    log.add('Risk Engine', 'LTV Result', `${ltvResult.ltv_ratio}% — ${ltvResult.status}`, ltvResult.status === 'RED' ? 'error' : ltvResult.status === 'AMBER' ? 'warn' : 'ok');

    // Update account LTV
    await query(`UPDATE credit_accounts SET ltv_ratio = $2, ltv_alert_level = $3, updated_at = NOW() WHERE account_id = $1`,
      [account.rows[0].account_id, ltvResult.ltv_ratio / 100, ltvResult.status]);

    if (ltvResult.status === 'RED') {
      await query(`
        INSERT INTO margin_calls (user_id, account_id, ltv_at_trigger, outstanding_at_trigger, status, deadline)
        VALUES ($1, $2, $3, $4, 'ISSUED', NOW() + INTERVAL '48 hours')
      `, [user_id, account.rows[0].account_id, ltvResult.ltv_ratio / 100, ltvResult.outstanding || 0]);
      log.add('Margin Call', 'ISSUED', `LTV: ${ltvResult.ltv_ratio}%. Deadline: 48h`, 'error');
      log.add('Notification', 'User alerted', '3 options: Repay, Add Collateral, or Auto-liquidation in 48h', 'warn');
    } else if (ltvResult.status === 'AMBER') {
      log.add('Alert', 'AMBER warning', 'Portfolio value dropped. User should add funds.', 'warn');
    }

    res.json({ success: true, data: { scenario: 'nav-crash', drop_pct, ltv: ltvResult, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, err.stack?.split('\n')[1] || '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 2: SPENDING SPREE
// ══════════════════════════════════════════════════════════════
router.post('/scenario/spending-spree', async (req, res) => {
  const { user_id, num_txns = 10, amount_per_txn = 0 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  const log = createLog();

  try {
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No active credit account' });
    const acc = account.rows[0];
    const available = parseFloat(acc.available_credit);
    const txnAmount = amount_per_txn || Math.floor(available / num_txns * 0.95);
    log.add('Credit', 'Starting balance', `Available: ₹${available}, Limit: ₹${acc.credit_limit}`);

    const results = [];
    let currentAvailable = available;

    for (let i = 0; i < num_txns; i++) {
      if (currentAvailable < txnAmount) {
        log.add('Transaction', `Txn ${i + 1} REJECTED`, `Insufficient: ₹${Math.round(currentAvailable)} < ₹${txnAmount}`, 'error');
        results.push({ txn: i + 1, status: 'REJECTED', reason: 'INSUFFICIENT_CREDIT' });
        break;
      }
      await query(`
        INSERT INTO transactions (user_id, account_id, merchant_vpa, merchant_name, amount, status, initiated_at, is_in_free_period, lsp_txn_ref)
        VALUES ($1, $2, $3, $4, $5, 'SETTLED', NOW(), $6, $7)
      `, [user_id, acc.account_id, `stress-merchant-${i}@test`, `Stress Merchant ${i + 1}`, txnAmount, i === 0, `STRESS_${Date.now()}_${i}`]);

      await query(`UPDATE credit_accounts SET outstanding = outstanding + $2, available_credit = available_credit - $2, updated_at = NOW() WHERE account_id = $1`, [acc.account_id, txnAmount]);
      currentAvailable -= txnAmount;
      const utilization = ((parseFloat(acc.credit_limit) - currentAvailable) / parseFloat(acc.credit_limit) * 100).toFixed(1);
      log.add('Transaction', `Txn ${i + 1} SETTLED`, `₹${txnAmount}. Utilization: ${utilization}%`);
      results.push({ txn: i + 1, status: 'SETTLED', amount: txnAmount, utilization: parseFloat(utilization) });
    }

    const finalAcc = await query("SELECT * FROM credit_accounts WHERE account_id = $1", [acc.account_id]);
    log.add('Credit', 'Final state', `Outstanding: ₹${finalAcc.rows[0].outstanding}, Available: ₹${finalAcc.rows[0].available_credit}`);
    res.json({ success: true, data: { scenario: 'spending-spree', transactions: results, final: finalAcc.rows[0], steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 3: REPAYMENT WATERFALL
// ══════════════════════════════════════════════════════════════
router.post('/scenario/repayment-waterfall', async (req, res) => {
  const { user_id, repay_amount } = req.body;
  if (!user_id || !repay_amount) return res.status(400).json({ success: false, error: 'user_id and repay_amount required' });
  const log = createLog();

  try {
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No active credit account' });
    log.add('Billing', 'Outstanding before', `₹${account.rows[0].outstanding}`);

    const txns = await query(`SELECT txn_id, amount, initiated_at, is_in_free_period, merchant_name FROM transactions WHERE user_id = $1 AND status = 'SETTLED' ORDER BY initiated_at ASC`, [user_id]);
    log.add('Billing', 'Transactions in pool', `${txns.rows.length} settled transactions`);

    let remaining = parseFloat(repay_amount);
    const allocations = [];
    const apr = parseFloat(account.rows[0].apr || 12);

    for (const txn of txns.rows) {
      if (remaining <= 0) break;
      const txnAmt = parseFloat(txn.amount);
      const daysSince = Math.max(0, Math.floor((Date.now() - new Date(txn.initiated_at).getTime()) / (1000 * 60 * 60 * 24)));
      const dailyRate = apr / 365 / 100;
      const interest = txn.is_in_free_period && daysSince <= 30 ? 0 : Math.round(txnAmt * dailyRate * Math.max(0, daysSince - 30) * 100) / 100;

      const interestPaid = Math.min(remaining, interest);
      remaining -= interestPaid;
      const principalPaid = Math.min(remaining, txnAmt);
      remaining -= principalPaid;

      allocations.push({ txn_id: txn.txn_id, merchant: txn.merchant_name, original: txnAmt, interest, interestPaid, principalPaid, daysSince });
      log.add('Waterfall', `${txn.merchant_name || txn.txn_id.slice(0, 8)}`, `Interest: ₹${interestPaid.toFixed(2)}, Principal: ₹${principalPaid.toFixed(2)} (${daysSince}d old)`);
    }

    const actualPaid = parseFloat(repay_amount) - remaining;
    await query(`UPDATE credit_accounts SET outstanding = GREATEST(0, outstanding - $2), available_credit = LEAST(credit_limit, available_credit + $2), updated_at = NOW() WHERE user_id = $1 AND status = 'ACTIVE'`, [user_id, actualPaid]);
    await query(`INSERT INTO repayments (user_id, account_id, amount, payment_mode, status, utr) VALUES ($1, $2, $3, 'STRESS_TEST', 'SUCCESS', $4)`, [user_id, account.rows[0].account_id, actualPaid, `STRESS_UTR_${Date.now()}`]);

    const finalAcc = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    log.add('Billing', 'Outstanding after', `₹${finalAcc.rows[0]?.outstanding || 0}`);
    res.json({ success: true, data: { scenario: 'repayment-waterfall', repay_amount, actual_applied: actualPaid, allocations, final: finalAcc.rows[0], steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 4: FREE PERIOD EXPIRY
// ══════════════════════════════════════════════════════════════
router.post('/scenario/free-period-expiry', async (req, res) => {
  const { user_id, days_forward = 31 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  const log = createLog();

  try {
    const txns = await query(`SELECT txn_id, amount, initiated_at, merchant_name FROM transactions WHERE user_id = $1 AND is_in_free_period = true AND status = 'SETTLED'`, [user_id]);
    log.add('Billing', 'Free period transactions', `${txns.rows.length} found`);

    const apr = parseFloat(process.env.BASE_APR) || 12;
    const dailyRate = apr / 365 / 100;
    let totalInterest = 0;
    const breakdown = [];

    for (const txn of txns.rows) {
      const txnAge = Math.floor((Date.now() - new Date(txn.initiated_at).getTime()) / (1000 * 60 * 60 * 24));
      const simulatedAge = txnAge + days_forward;
      const interestDays = Math.max(0, simulatedAge - 30);
      const interest = Math.round(parseFloat(txn.amount) * dailyRate * interestDays * 100) / 100;

      breakdown.push({ txn_id: txn.txn_id, merchant: txn.merchant_name, amount: parseFloat(txn.amount), days_old: simulatedAge, interest_days: interestDays, total_interest: interest });
      if (interestDays > 0) {
        log.add('Interest', `${txn.merchant_name || txn.txn_id.slice(0, 8)}`, `₹${txn.amount} × ${(dailyRate * 100).toFixed(4)}%/day × ${interestDays}d = ₹${interest}`);
        totalInterest += interest;
      } else {
        log.add('Interest', `${txn.merchant_name || txn.txn_id.slice(0, 8)}`, `Still in free period (day ${simulatedAge}/30)`, 'ok');
      }
    }
    log.add('Billing', 'Total interest', `₹${totalInterest.toFixed(2)}`);
    res.json({ success: true, data: { scenario: 'free-period-expiry', days_forward, apr, total_interest: totalInterest, breakdown, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 5: FULL REPAYMENT + PLEDGE RELEASE
// ══════════════════════════════════════════════════════════════
router.post('/scenario/full-repayment', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  const log = createLog();

  try {
    // Find account (any status — might be frozen from previous stress test)
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No credit account' });

    const outstanding = parseFloat(account.rows[0].outstanding || 0);
    log.add('Credit', 'Outstanding', `₹${outstanding}`);

    if (outstanding > 0) {
      await query(`INSERT INTO repayments (user_id, account_id, amount, payment_mode, status, utr) VALUES ($1, $2, $3, 'STRESS_FULL', 'SUCCESS', $4)`, [user_id, account.rows[0].account_id, outstanding, `STRESS_FULL_${Date.now()}`]);
      log.add('Repayment', 'Full repayment', `₹${outstanding} processed`);
    }

    // Release all pledges
    const pledges = await query("SELECT * FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    for (const p of pledges.rows) {
      await query("UPDATE pledges SET status = 'RELEASED', released_at = NOW() WHERE pledge_id = $1", [p.pledge_id]);
      log.add('RTA', `${p.rta} release`, `Folio ${p.folio_number} released`);
    }

    // CRITICAL: Zero out credit AND freeze account — no more transactions allowed
    await query(`
      UPDATE credit_accounts SET
        outstanding = 0, credit_limit = 0, available_credit = 0,
        status = 'FROZEN', upi_active = false,
        updated_at = NOW()
      WHERE account_id = $1
    `, [account.rows[0].account_id]);
    log.add('Credit', 'Account FROZEN', 'Limit: ₹0, Available: ₹0, UPI disabled');

    await query("UPDATE users SET account_status = 'PORTFOLIO_LINKED', onboarding_step = 'PLEDGE' WHERE user_id = $1", [user_id]);
    log.add('User', 'Status reset', 'Can re-pledge to get new credit line');

    res.json({ success: true, data: { scenario: 'full-repayment', repaid: outstanding, pledges_released: pledges.rows.length, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 6: FRAUD DETECTION
// ══════════════════════════════════════════════════════════════
router.post('/scenario/fraud-detection', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  const log = createLog();

  try {
    const newDevice = `STRESS_DEVICE_${Date.now()}`;
    await query("UPDATE users SET device_fingerprint = $2, last_device_id = $3 WHERE user_id = $1", [user_id, newDevice, 'suspicious-device-999']);
    log.add('Device', 'Device changed', `New fingerprint detected`);

    const recentTxnCount = await query("SELECT COUNT(*) as cnt FROM transactions WHERE user_id = $1 AND initiated_at > NOW() - INTERVAL '1 hour'", [user_id]);
    const velocityScore = Math.min(30, parseInt(recentTxnCount.rows[0].cnt) * 3);
    const deviceScore = 25;
    const amountScore = 20;
    const totalFraudScore = velocityScore + deviceScore + amountScore;

    log.add('Fraud Engine', 'Velocity', `${velocityScore}/30 (${recentTxnCount.rows[0].cnt} txns/hr)`);
    log.add('Fraud Engine', 'Device change', `${deviceScore}/25`);
    log.add('Fraud Engine', 'Amount anomaly', `${amountScore}/20`);
    log.add('Fraud Engine', 'TOTAL', `${totalFraudScore}/100`, totalFraudScore >= 70 ? 'error' : 'warn');

    if (totalFraudScore >= 70) {
      await query("UPDATE credit_accounts SET status = 'FROZEN', updated_at = NOW() WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
      log.add('Security', 'ACCOUNT FROZEN', 'Fraud threshold exceeded', 'error');
    }

    res.json({ success: true, data: { scenario: 'fraud-detection', fraud_score: totalFraudScore, frozen: totalFraudScore >= 70, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 7: OVERDUE → DEFAULT
// ══════════════════════════════════════════════════════════════
router.post('/scenario/overdue-default', async (req, res) => {
  const { user_id, days_overdue = 90 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  const log = createLog();

  try {
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No credit account' });

    const outstanding = parseFloat(account.rows[0].outstanding || 0);
    if (outstanding <= 0) {
      log.add('Billing', 'No outstanding', 'Cannot simulate overdue on zero balance', 'warn');
      return res.json({ success: true, data: { scenario: 'overdue-default', steps: log.steps } });
    }
    log.add('Credit', 'Starting', `Status: ${account.rows[0].status}, Outstanding: ₹${outstanding}`);

    if (days_overdue >= 1) {
      await query("UPDATE credit_accounts SET status = 'FROZEN', updated_at = NOW() WHERE account_id = $1", [account.rows[0].account_id]);
      await query("UPDATE users SET account_status = 'OVERDUE' WHERE user_id = $1", [user_id]);
      log.add('Credit', 'OVERDUE', 'Account frozen. No new transactions.', 'warn');
    }
    if (days_overdue >= 7) {
      await query("UPDATE credit_accounts SET outstanding = outstanding + 500 WHERE account_id = $1", [account.rows[0].account_id]);
      log.add('Billing', 'Late fee', '₹500 added', 'warn');
    }
    if (days_overdue >= 15) { log.add('Notification', 'Day 15', 'Urgent payment reminder sent', 'warn'); }
    if (days_overdue >= 30) { log.add('Bureau', 'Day 30', 'NPA warning — bureau reporting flagged', 'warn'); }

    if (days_overdue >= 90) {
      await query("UPDATE users SET account_status = 'DEFAULTED' WHERE user_id = $1", [user_id]);
      log.add('Credit', 'DEFAULTED', '90 days overdue', 'error');
      const pledges = await query("SELECT * FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
      for (const p of pledges.rows) {
        await query("UPDATE pledges SET status = 'INVOKED', invoked_at = NOW() WHERE pledge_id = $1", [p.pledge_id]);
        log.add('RTA', `${p.rta} INVOKED`, `Folio ${p.folio_number} — liquidation`, 'error');
      }
      log.add('Bureau', 'CIBIL reported', `Default of ₹${outstanding}`, 'error');
    }

    res.json({ success: true, data: { scenario: 'overdue-default', days_overdue, outstanding, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// RESET: Restore user to clean ACTIVE state
// FIX: Restore pledges FIRST, then calculate limit
// ══════════════════════════════════════════════════════════════
router.post('/reset', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  const log = createLog();

  try {
    // 1. FIRST: Re-activate all released/invoked pledges
    await query("UPDATE pledges SET status = 'ACTIVE', released_at = NULL, invoked_at = NULL WHERE user_id = $1 AND status IN ('RELEASED', 'INVOKED')", [user_id]);
    log.add('Pledge', 'Restored', 'All released/invoked pledges set to ACTIVE');

    // 2. NOW calculate limit from active pledges (order matters!)
    const pledgedTotal = await query("SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    const limit = Math.round(parseFloat(pledgedTotal.rows[0].total || 0));
    log.add('Credit', 'Recalculated limit', `₹${limit} from active pledges`);

    // 3. Restore credit account
    await query(`
      UPDATE credit_accounts SET status = 'ACTIVE', outstanding = 0, credit_limit = $2,
        available_credit = $2, upi_active = true, ltv_ratio = NULL, ltv_alert_level = 'GREEN',
        margin_call_issued_at = NULL, updated_at = NOW()
      WHERE user_id = $1
    `, [user_id, limit]);
    log.add('Credit', 'Account restored', `ACTIVE, Limit: ₹${limit}, Outstanding: ₹0`);

    // 4. Restore user status
    await query("UPDATE users SET account_status = 'CREDIT_ACTIVE', device_fingerprint = NULL WHERE user_id = $1", [user_id]);
    log.add('User', 'Status restored', 'CREDIT_ACTIVE');

    // 5. Restore original NAVs (remove stress test overrides)
    await query("DELETE FROM nav_history WHERE source = 'STRESS_TEST'");
    log.add('NAV', 'Stress NAVs removed', 'Original AMFI NAVs restored');

    // 6. Restore mf_holdings NAVs from pledge data
    const holdings = await query(`
      SELECT DISTINCT p.isin, p.nav_at_pledge, p.units_pledged
      FROM pledges p WHERE p.user_id = $1 AND p.status = 'ACTIVE'
    `, [user_id]);
    for (const h of holdings.rows) {
      await query(`UPDATE mf_holdings SET nav_at_fetch = $2, value_at_fetch = $3, updated_at = NOW() WHERE isin = $1 AND user_id = $4`,
        [h.isin, h.nav_at_pledge, Math.round(h.units_pledged * parseFloat(h.nav_at_pledge)), user_id]);
    }
    log.add('Portfolio', 'Holdings NAVs restored', 'Using pledge-time NAV values');

    // 7. Remove stress test artifacts
    await query("DELETE FROM transactions WHERE user_id = $1 AND lsp_txn_ref LIKE 'STRESS_%'", [user_id]);
    await query("DELETE FROM margin_calls WHERE user_id = $1", [user_id]);
    await query("DELETE FROM repayments WHERE user_id = $1 AND payment_mode LIKE 'STRESS%'", [user_id]);
    log.add('Cleanup', 'Artifacts removed', 'Stress txns, margin calls, stress repayments deleted');

    res.json({ success: true, message: 'User reset to clean ACTIVE state', steps: log.steps });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// BLOCK / UNBLOCK USER
// ══════════════════════════════════════════════════════════════
router.post('/block-user', async (req, res) => {
  const { user_id, reason = 'Admin action' } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  try {
    await query("UPDATE credit_accounts SET status = 'FROZEN', upi_active = false, updated_at = NOW() WHERE user_id = $1", [user_id]);
    await query("UPDATE users SET account_status = 'FROZEN' WHERE user_id = $1", [user_id]);
    await query("INSERT INTO audit_trail (event_type, entity_type, entity_id, new_values) VALUES ('USER_BLOCKED', 'user', $1, $2)", [user_id, JSON.stringify({ reason, blocked_by: 'admin', blocked_at: new Date().toISOString() })]);

    console.log(`🚫 USER BLOCKED: ${user_id} — Reason: ${reason}`);
    res.json({ success: true, message: 'User blocked', user_id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/unblock-user', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  try {
    const pledgedTotal = await query("SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    const limit = Math.round(parseFloat(pledgedTotal.rows[0].total || 0));

    await query("UPDATE credit_accounts SET status = 'ACTIVE', upi_active = true, credit_limit = $2, available_credit = $2 - COALESCE(outstanding, 0), updated_at = NOW() WHERE user_id = $1", [user_id, limit]);
    await query("UPDATE users SET account_status = 'CREDIT_ACTIVE' WHERE user_id = $1", [user_id]);
    await query("INSERT INTO audit_trail (event_type, entity_type, entity_id, new_values) VALUES ('USER_UNBLOCKED', 'user', $1, $2)", [user_id, JSON.stringify({ unblocked_by: 'admin', unblocked_at: new Date().toISOString() })]);

    console.log(`✅ USER UNBLOCKED: ${user_id}`);
    res.json({ success: true, message: 'User unblocked', user_id, new_limit: limit });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
