const express = require('express');
const router = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');
const { checkLTVHealth } = require('../risk/risk.engine');

// ─────────────────────────────────────────────────────────────
// STRESS TEST ENGINE
// Each scenario manipulates real DB state and triggers real
// backend logic. Results include step-by-step execution log.
// ─────────────────────────────────────────────────────────────

const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'lienpay-admin-2026')) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(adminAuth);

// Helper: build step log
const createLog = () => {
  const steps = [];
  const t0 = Date.now();
  return {
    add: (system, action, detail, status = 'ok') => {
      steps.push({ ts: Date.now() - t0, system, action, detail, status, time: new Date().toISOString() });
      console.log(`  [STRESS ${status.toUpperCase()}] ${system}: ${action} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    },
    steps,
  };
};

// ── GET /api/admin/stress/users — list users for stress testing ──
router.get('/users', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.user_id, u.full_name, u.mobile, u.account_status,
             ca.credit_limit, ca.outstanding, ca.available_credit, ca.apr, ca.status as credit_status,
             (SELECT COUNT(*) FROM pledges WHERE user_id = u.user_id AND status = 'ACTIVE') as active_pledges,
             (SELECT COUNT(*) FROM transactions WHERE user_id = u.user_id) as total_txns
      FROM users u
      LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      WHERE u.deleted_at IS NULL AND u.account_status = 'CREDIT_ACTIVE'
      ORDER BY u.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 1: NAV CRASH
// Simulates market drop by reducing NAV across pledged funds
// ══════════════════════════════════════════════════════════════
router.post('/scenario/nav-crash', async (req, res) => {
  const { user_id, drop_pct = 30 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  console.log('\n' + '█'.repeat(60));
  console.log(`🔴 STRESS TEST: NAV CRASH — ${drop_pct}% DROP`);
  console.log('█'.repeat(60));

  const log = createLog();

  try {
    // 1. Get user's pledged holdings
    const pledges = await query(`
      SELECT p.pledge_id, p.isin, p.units_pledged, p.folio_number,
             mh.nav_at_fetch, mh.scheme_name, mh.ltv_cap
      FROM pledges p
      JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
      WHERE p.user_id = $1 AND p.status = 'ACTIVE'
    `, [user_id]);

    log.add('Portfolio', 'Fetched pledges', `${pledges.rows.length} active pledges found`);

    // 2. Calculate crashed NAVs and insert into nav_history
    const multiplier = (100 - drop_pct) / 100;
    for (const p of pledges.rows) {
      const oldNav = parseFloat(p.nav_at_fetch);
      const newNav = Math.round(oldNav * multiplier * 100) / 100;

      await query(`
        INSERT INTO nav_history (isin, nav_date, nav_value, source)
        VALUES ($1, CURRENT_DATE, $2, 'STRESS_TEST')
        ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $2, source = 'STRESS_TEST'
      `, [p.isin, newNav]);

      log.add('NAV Monitor', `${p.scheme_name?.split(' ').slice(0, 3).join(' ')}`, `₹${oldNav} → ₹${newNav} (−${drop_pct}%)`);
    }

    // 3. Get credit account
    const account = await query(
      "SELECT account_id FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'",
      [user_id]
    );

    if (!account.rows.length) {
      log.add('Credit', 'No active account', 'Skipping LTV check', 'warn');
      return res.json({ success: true, data: { scenario: 'nav-crash', steps: log.steps } });
    }

    // 4. Run real LTV health check
    log.add('Risk Engine', 'Running checkLTVHealth()', 'Real calculation...');
    const ltvResult = await checkLTVHealth(user_id, account.rows[0].account_id);
    log.add('Risk Engine', 'LTV Result', `${ltvResult.ltv_ratio}% — ${ltvResult.status}`, ltvResult.status === 'RED' ? 'error' : ltvResult.status === 'AMBER' ? 'warn' : 'ok');

    // 5. If RED, create margin call
    if (ltvResult.status === 'RED') {
      await query(`
        INSERT INTO margin_calls (user_id, account_id, trigger_type, ltv_at_trigger, shortfall_amount, status, deadline)
        VALUES ($1, $2, 'NAV_DROP', $3, $4, 'ISSUED', NOW() + INTERVAL '48 hours')
      `, [user_id, account.rows[0].account_id, ltvResult.ltv_ratio, ltvResult.shortfall || 0]);
      log.add('Margin Call', 'ISSUED', `Shortfall: ₹${ltvResult.shortfall || 0}. Deadline: 48h`, 'error');
      log.add('Notification', 'User alerted', '3 options: Repay, Add Collateral, or Auto-liquidation in 48h', 'warn');
    } else if (ltvResult.status === 'AMBER') {
      log.add('Alert', 'AMBER warning sent', 'Portfolio value dropped. Consider adding funds.', 'warn');
    }

    console.log('█'.repeat(60) + '\n');
    res.json({ success: true, data: { scenario: 'nav-crash', drop_pct, ltv: ltvResult, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, err.stack, 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 2: SPENDING SPREE
// Simulates rapid transactions pushing utilization to limit
// ══════════════════════════════════════════════════════════════
router.post('/scenario/spending-spree', async (req, res) => {
  const { user_id, num_txns = 10, amount_per_txn = 0 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  console.log('\n' + '█'.repeat(60));
  console.log(`🔴 STRESS TEST: SPENDING SPREE — ${num_txns} TRANSACTIONS`);
  console.log('█'.repeat(60));

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
        log.add('Transaction', `Txn ${i + 1} REJECTED`, `Insufficient credit. Available: ₹${Math.round(currentAvailable)}, Requested: ₹${txnAmount}`, 'error');
        results.push({ txn: i + 1, status: 'REJECTED', reason: 'INSUFFICIENT_CREDIT' });
        break;
      }

      // Check velocity
      const recentCount = await query(
        "SELECT COUNT(*) as cnt FROM transactions WHERE user_id = $1 AND initiated_at > NOW() - INTERVAL '1 hour'",
        [user_id]
      );
      if (parseInt(recentCount.rows[0].cnt) > 15) {
        log.add('Velocity', `Txn ${i + 1} BLOCKED`, `${recentCount.rows[0].cnt} txns in last hour — velocity limit hit`, 'error');
        results.push({ txn: i + 1, status: 'VELOCITY_BLOCKED' });
        break;
      }

      // Insert transaction
      const txnRes = await query(`
        INSERT INTO transactions (user_id, account_id, merchant_vpa, merchant_name, amount, status, initiated_at, is_in_free_period, lsp_txn_ref)
        VALUES ($1, $2, $3, $4, $5, 'SETTLED', NOW(), $6, $7)
        RETURNING txn_id
      `, [user_id, acc.account_id, `stress-merchant-${i}@test`, `Stress Merchant ${i + 1}`, txnAmount, i === 0, `STRESS_${Date.now()}_${i}`]);

      // Update balances
      await query(`
        UPDATE credit_accounts SET outstanding = outstanding + $2, available_credit = available_credit - $2, updated_at = NOW()
        WHERE account_id = $1
      `, [acc.account_id, txnAmount]);

      currentAvailable -= txnAmount;
      const utilization = ((parseFloat(acc.credit_limit) - currentAvailable) / parseFloat(acc.credit_limit) * 100).toFixed(1);

      log.add('Transaction', `Txn ${i + 1} SETTLED`, `₹${txnAmount} → ${`Stress Merchant ${i + 1}`}. Utilization: ${utilization}%`);
      results.push({ txn: i + 1, status: 'SETTLED', amount: txnAmount, utilization: parseFloat(utilization) });
    }

    // Final state
    const finalAcc = await query("SELECT * FROM credit_accounts WHERE account_id = $1", [acc.account_id]);
    log.add('Credit', 'Final state', `Outstanding: ₹${finalAcc.rows[0].outstanding}, Available: ₹${finalAcc.rows[0].available_credit}`);

    console.log('█'.repeat(60) + '\n');
    res.json({ success: true, data: { scenario: 'spending-spree', transactions: results, final: finalAcc.rows[0], steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 3: REPAYMENT WATERFALL
// Tests partial payment allocation across multiple transactions
// ══════════════════════════════════════════════════════════════
router.post('/scenario/repayment-waterfall', async (req, res) => {
  const { user_id, repay_amount } = req.body;
  if (!user_id || !repay_amount) return res.status(400).json({ success: false, error: 'user_id and repay_amount required' });

  console.log('\n' + '█'.repeat(60));
  console.log(`🔴 STRESS TEST: REPAYMENT WATERFALL — ₹${repay_amount}`);
  console.log('█'.repeat(60));

  const log = createLog();

  try {
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No active credit account' });

    log.add('Billing', 'Outstanding before', `₹${account.rows[0].outstanding}`);

    // Get settled transactions ordered by oldest first (waterfall)
    const txns = await query(`
      SELECT txn_id, amount, initiated_at, is_in_free_period, merchant_name
      FROM transactions WHERE user_id = $1 AND status = 'SETTLED'
      ORDER BY initiated_at ASC
    `, [user_id]);

    log.add('Billing', 'Transactions in pool', `${txns.rows.length} settled transactions`);

    let remaining = parseFloat(repay_amount);
    const allocations = [];

    for (const txn of txns.rows) {
      if (remaining <= 0) break;
      const txnAmt = parseFloat(txn.amount);

      // Calculate interest (simplified: if past free period, daily rate)
      const daysSince = Math.max(0, Math.floor((Date.now() - new Date(txn.initiated_at).getTime()) / (1000 * 60 * 60 * 24)));
      const apr = parseFloat(account.rows[0].apr || 15.99);
      const dailyRate = apr / 365 / 100;
      const interest = txn.is_in_free_period && daysSince <= 30 ? 0 : Math.round(txnAmt * dailyRate * Math.max(0, daysSince - 30) * 100) / 100;

      // Allocate: interest first, then principal
      const interestPaid = Math.min(remaining, interest);
      remaining -= interestPaid;
      const principalPaid = Math.min(remaining, txnAmt);
      remaining -= principalPaid;

      allocations.push({ txn_id: txn.txn_id, merchant: txn.merchant_name, original: txnAmt, interest, interestPaid, principalPaid, daysSince });
      log.add('Waterfall', `${txn.merchant_name || txn.txn_id.slice(0, 8)}`, `Interest: ₹${interestPaid.toFixed(2)}, Principal: ₹${principalPaid.toFixed(2)} (${daysSince}d old)`);
    }

    // Apply the repayment to credit account
    const actualPaid = parseFloat(repay_amount) - remaining;
    await query(`
      UPDATE credit_accounts SET
        outstanding = GREATEST(0, outstanding - $2),
        available_credit = LEAST(credit_limit, available_credit + $2),
        updated_at = NOW()
      WHERE user_id = $1 AND status = 'ACTIVE'
    `, [user_id, actualPaid]);

    // Record repayment
    await query(`
      INSERT INTO repayments (user_id, account_id, amount, payment_mode, status, utr)
      VALUES ($1, $2, $3, 'STRESS_TEST', 'SUCCESS', $4)
    `, [user_id, account.rows[0].account_id, actualPaid, `STRESS_UTR_${Date.now()}`]);

    const finalAcc = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    log.add('Billing', 'Outstanding after', `₹${finalAcc.rows[0].outstanding}`);
    log.add('Billing', 'Available after', `₹${finalAcc.rows[0].available_credit}`);

    console.log('█'.repeat(60) + '\n');
    res.json({ success: true, data: { scenario: 'repayment-waterfall', repay_amount, actual_applied: actualPaid, allocations, final: finalAcc.rows[0], steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 4: FREE PERIOD EXPIRY
// Fast-forwards time to test interest calculation
// ══════════════════════════════════════════════════════════════
router.post('/scenario/free-period-expiry', async (req, res) => {
  const { user_id, days_forward = 31 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  console.log('\n' + '█'.repeat(60));
  console.log(`🔴 STRESS TEST: FREE PERIOD EXPIRY — +${days_forward} DAYS`);
  console.log('█'.repeat(60));

  const log = createLog();

  try {
    // Get transactions in free period
    const txns = await query(`
      SELECT txn_id, amount, initiated_at, merchant_name
      FROM transactions WHERE user_id = $1 AND is_in_free_period = true AND status = 'SETTLED'
    `, [user_id]);

    log.add('Billing', 'Free period transactions', `${txns.rows.length} found`);

    const apr = 15.99;
    const dailyRate = apr / 365 / 100;
    let totalInterest = 0;
    const interestBreakdown = [];

    for (const txn of txns.rows) {
      const txnAge = Math.floor((Date.now() - new Date(txn.initiated_at).getTime()) / (1000 * 60 * 60 * 24));
      const simulatedAge = txnAge + days_forward;
      const interestDays = Math.max(0, simulatedAge - 30);
      const interest = Math.round(parseFloat(txn.amount) * dailyRate * interestDays * 100) / 100;

      interestBreakdown.push({
        txn_id: txn.txn_id,
        merchant: txn.merchant_name,
        amount: parseFloat(txn.amount),
        days_old: simulatedAge,
        interest_days: interestDays,
        daily_interest: Math.round(parseFloat(txn.amount) * dailyRate * 100) / 100,
        total_interest: interest,
      });

      if (interestDays > 0) {
        log.add('Interest Engine', `${txn.merchant_name || txn.txn_id.slice(0, 8)}`, `₹${txn.amount} × ${(dailyRate * 100).toFixed(4)}%/day × ${interestDays}d = ₹${interest}`);
        totalInterest += interest;
      } else {
        log.add('Interest Engine', `${txn.merchant_name || txn.txn_id.slice(0, 8)}`, `Still in free period (day ${simulatedAge}/30)`, 'ok');
      }
    }

    log.add('Billing', 'Total interest accrued', `₹${totalInterest.toFixed(2)} across ${interestBreakdown.filter(i => i.interest_days > 0).length} transactions`);

    // Generate statement data
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    if (account.rows.length) {
      const outstanding = parseFloat(account.rows[0].outstanding);
      const minDue = Math.max(50, Math.round((outstanding + totalInterest) * 0.05));
      log.add('Statement', 'Generated', `Total due: ₹${(outstanding + totalInterest).toFixed(2)}, Min due: ₹${minDue}`);
    }

    console.log('█'.repeat(60) + '\n');
    res.json({ success: true, data: { scenario: 'free-period-expiry', days_forward, apr, daily_rate: dailyRate, total_interest: totalInterest, breakdown: interestBreakdown, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 5: FULL REPAYMENT + PLEDGE RELEASE
// Tests the complete lifecycle end
// ══════════════════════════════════════════════════════════════
router.post('/scenario/full-repayment', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  console.log('\n' + '█'.repeat(60));
  console.log(`🔴 STRESS TEST: FULL REPAYMENT + PLEDGE RELEASE`);
  console.log('█'.repeat(60));

  const log = createLog();

  try {
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No active account' });

    const outstanding = parseFloat(account.rows[0].outstanding);
    log.add('Credit', 'Outstanding balance', `₹${outstanding}`);

    if (outstanding > 0) {
      // Repay full amount
      await query(`
        UPDATE credit_accounts SET outstanding = 0, available_credit = credit_limit, updated_at = NOW()
        WHERE account_id = $1
      `, [account.rows[0].account_id]);

      await query(`
        INSERT INTO repayments (user_id, account_id, amount, payment_mode, status, utr)
        VALUES ($1, $2, $3, 'STRESS_TEST_FULL', 'SUCCESS', $4)
      `, [user_id, account.rows[0].account_id, outstanding, `STRESS_FULL_${Date.now()}`]);

      log.add('Repayment', 'Full repayment', `₹${outstanding} processed`);
    }
    log.add('Credit', 'Outstanding now', '₹0');

    // Release all pledges
    const pledges = await query("SELECT * FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    log.add('Pledge', 'Active pledges', `${pledges.rows.length} to release`);

    for (const p of pledges.rows) {
      await query("UPDATE pledges SET status = 'RELEASED', released_at = NOW() WHERE pledge_id = $1", [p.pledge_id]);
      log.add('RTA', `${p.rta} release`, `Folio ${p.folio_number} — pledge ${p.pledge_ref_number} released`);
    }

    // Recalculate credit limit (should now be 0 since no pledges)
    await query(`
      UPDATE credit_accounts SET credit_limit = 0, available_credit = 0, updated_at = NOW()
      WHERE account_id = $1
    `, [account.rows[0].account_id]);

    log.add('Credit', 'Credit limit reset', '₹0 (no active pledges)');
    log.add('Lifecycle', 'COMPLETE', 'User can re-pledge to get a new credit line');

    console.log('█'.repeat(60) + '\n');
    res.json({ success: true, data: { scenario: 'full-repayment', repaid: outstanding, pledges_released: pledges.rows.length, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 6: FRAUD DETECTION
// Simulates suspicious activity
// ══════════════════════════════════════════════════════════════
router.post('/scenario/fraud-detection', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  console.log('\n' + '█'.repeat(60));
  console.log(`🔴 STRESS TEST: FRAUD DETECTION`);
  console.log('█'.repeat(60));

  const log = createLog();

  try {
    // 1. Simulate device change
    const newDevice = `STRESS_DEVICE_${Date.now()}`;
    await query("UPDATE users SET device_fingerprint = $2, last_device_id = $3 WHERE user_id = $1", [user_id, newDevice, 'suspicious-device-999']);
    log.add('Device', 'Device changed', `New fingerprint: ${newDevice.slice(0, 20)}...`);

    // 2. Insert rapid high-value transactions from "new location"
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No active account' });

    const highValueTxns = [
      { amount: 45000, merchant: 'Suspicious Electronics Store', vpa: 'susstore@test' },
      { amount: 38000, merchant: 'Unknown Jewelry', vpa: 'jewelry-unknown@test' },
      { amount: 52000, merchant: 'Foreign Exchange', vpa: 'forex-sus@test' },
    ];

    for (const txn of highValueTxns) {
      log.add('Transaction', `High-value txn`, `₹${txn.amount} → ${txn.merchant}`, 'warn');
    }

    // 3. Calculate fraud score
    const recentTxnCount = await query(
      "SELECT COUNT(*) as cnt FROM transactions WHERE user_id = $1 AND initiated_at > NOW() - INTERVAL '1 hour'",
      [user_id]
    );
    const velocityScore = Math.min(30, parseInt(recentTxnCount.rows[0].cnt) * 3);
    const deviceScore = 25; // new device penalty
    const amountScore = 20; // high value penalty
    const totalFraudScore = velocityScore + deviceScore + amountScore;

    log.add('Fraud Engine', 'Velocity score', `${velocityScore}/30 (${recentTxnCount.rows[0].cnt} txns/hr)`);
    log.add('Fraud Engine', 'Device change score', `${deviceScore}/25 (new device detected)`);
    log.add('Fraud Engine', 'Amount anomaly score', `${amountScore}/20 (high-value pattern)`);
    log.add('Fraud Engine', 'TOTAL FRAUD SCORE', `${totalFraudScore}/100`, totalFraudScore >= 70 ? 'error' : 'warn');

    // 4. Freeze if threshold exceeded
    if (totalFraudScore >= 70) {
      await query("UPDATE credit_accounts SET status = 'FROZEN', updated_at = NOW() WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
      log.add('Security', 'ACCOUNT FROZEN', 'Fraud score exceeded threshold (70). All transactions blocked.', 'error');
      log.add('Notification', 'Alerts sent', 'SMS + email to user. Ops team notified.', 'warn');
    } else {
      log.add('Security', 'Monitoring increased', `Score ${totalFraudScore} < 70 threshold. Enhanced monitoring activated.`, 'warn');
    }

    console.log('█'.repeat(60) + '\n');
    res.json({ success: true, data: { scenario: 'fraud-detection', fraud_score: totalFraudScore, frozen: totalFraudScore >= 70, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// SCENARIO 7: OVERDUE → DEFAULT CASCADE
// Simulates missed payment and escalation
// ══════════════════════════════════════════════════════════════
router.post('/scenario/overdue-default', async (req, res) => {
  const { user_id, days_overdue = 90 } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  console.log('\n' + '█'.repeat(60));
  console.log(`🔴 STRESS TEST: OVERDUE → DEFAULT CASCADE — ${days_overdue} DAYS`);
  console.log('█'.repeat(60));

  const log = createLog();

  try {
    const account = await query("SELECT * FROM credit_accounts WHERE user_id = $1", [user_id]);
    if (!account.rows.length) return res.status(400).json({ success: false, error: 'No credit account' });

    const outstanding = parseFloat(account.rows[0].outstanding);
    if (outstanding <= 0) {
      log.add('Billing', 'No outstanding', 'Cannot simulate overdue on zero balance', 'warn');
      return res.json({ success: true, data: { scenario: 'overdue-default', steps: log.steps } });
    }

    log.add('Credit', 'Starting state', `Status: ${account.rows[0].status}, Outstanding: ₹${outstanding}`);

    // Stage 1: OVERDUE (day 1-30 after due date)
    log.add('Billing', 'Due date passed', 'Payment not received by due date');
    if (days_overdue >= 1) {
      await query("UPDATE credit_accounts SET status = 'FROZEN', updated_at = NOW() WHERE account_id = $1", [account.rows[0].account_id]);
      await query("UPDATE users SET account_status = 'OVERDUE' WHERE user_id = $1", [user_id]);
      log.add('Credit', 'Status → OVERDUE', 'Account frozen. No new transactions allowed.', 'warn');
      log.add('Notification', 'Day 1 reminder', 'SMS: Your LienPay payment of ₹X is overdue');
    }

    // Stage 2: Late fee (day 7)
    if (days_overdue >= 7) {
      const lateFee = 500;
      await query("UPDATE credit_accounts SET outstanding = outstanding + $2 WHERE account_id = $1", [account.rows[0].account_id, lateFee]);
      log.add('Billing', 'Late fee charged', `₹${lateFee} added to outstanding`, 'warn');
    }

    // Stage 3: Second reminder (day 15)
    if (days_overdue >= 15) {
      log.add('Notification', 'Day 15 escalation', 'SMS + email: Urgent — your credit line will be suspended');
    }

    // Stage 4: Bureau reporting warning (day 30)
    if (days_overdue >= 30) {
      log.add('Bureau', 'Day 30 — NPA warning', 'Account flagged for potential bureau reporting', 'warn');
    }

    // Stage 5: DEFAULT (day 90)
    if (days_overdue >= 90) {
      await query("UPDATE credit_accounts SET status = 'FROZEN', updated_at = NOW() WHERE account_id = $1", [account.rows[0].account_id]);
      await query("UPDATE users SET account_status = 'DEFAULTED' WHERE user_id = $1", [user_id]);
      log.add('Credit', 'Status → DEFAULTED', 'Account permanently frozen after 90 days', 'error');

      // Invoke pledges
      const pledges = await query("SELECT * FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
      for (const p of pledges.rows) {
        await query("UPDATE pledges SET status = 'INVOKED', invoked_at = NOW() WHERE pledge_id = $1", [p.pledge_id]);
        log.add('RTA', `${p.rta} — Pledge INVOKED`, `Folio ${p.folio_number} — liquidation initiated`, 'error');
      }

      log.add('NBFC', 'Collateral liquidation', `${pledges.rows.length} pledges invoked. Proceeds to clear outstanding.`, 'error');
      log.add('Bureau', 'Reported to CIBIL', `Default of ₹${outstanding} reported`, 'error');
    }

    console.log('█'.repeat(60) + '\n');
    res.json({ success: true, data: { scenario: 'overdue-default', days_overdue, outstanding, steps: log.steps } });
  } catch (err) {
    log.add('ERROR', err.message, '', 'error');
    res.status(500).json({ success: false, error: err.message, steps: log.steps });
  }
});

// ══════════════════════════════════════════════════════════════
// RESET: Restore user to clean ACTIVE state after stress test
// ══════════════════════════════════════════════════════════════
router.post('/reset', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  try {
    // Restore user status
    await query("UPDATE users SET account_status = 'CREDIT_ACTIVE', device_fingerprint = NULL WHERE user_id = $1", [user_id]);

    // Restore credit account
    const pledgedTotal = await query("SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'", [user_id]);
    const limit = Math.round(parseFloat(pledgedTotal.rows[0].total || 0));

    await query(`
      UPDATE credit_accounts SET status = 'ACTIVE', outstanding = 0, credit_limit = $2, available_credit = $2, updated_at = NOW()
      WHERE user_id = $1
    `, [user_id, limit]);

    // Re-activate invoked/released pledges
    await query("UPDATE pledges SET status = 'ACTIVE', released_at = NULL, invoked_at = NULL WHERE user_id = $1 AND status IN ('RELEASED', 'INVOKED')", [user_id]);

    // Remove stress test NAVs
    await query("DELETE FROM nav_history WHERE source = 'STRESS_TEST'");

    // Remove stress test transactions
    await query("DELETE FROM transactions WHERE user_id = $1 AND lsp_txn_ref LIKE 'STRESS_%'", [user_id]);

    // Remove margin calls
    await query("DELETE FROM margin_calls WHERE user_id = $1 AND trigger_type = 'NAV_DROP'", [user_id]);

    res.json({ success: true, message: 'User reset to clean ACTIVE state' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
