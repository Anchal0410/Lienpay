// ─────────────────────────────────────────────────────────────
// INTEREST CALCULATION ENGINE
//
// LienPay interest model:
// - 30-day interest-free period from first drawdown of each cycle
// - After free period: daily reducing balance simple interest
// - Formula: Outstanding × (APR/365) × days used
// - BASE APR: 12% for all customers
// - PENALTY APR: 18% if payment is overdue (past due date)
// - Interest calculated daily, billed monthly
// - No compounding — simple interest only
// ─────────────────────────────────────────────────────────────

const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

const BASE_APR = parseFloat(process.env.BASE_APR) || 12.00;
const PENALTY_APR = parseFloat(process.env.PENALTY_APR) || 18.00;

// ── GET EFFECTIVE APR (checks overdue status) ─────────────────
const getEffectiveAPR = async (accountId) => {
  const res = await query('SELECT status, apr FROM credit_accounts WHERE account_id = $1', [accountId]);
  if (!res.rows.length) return BASE_APR;
  const account = res.rows[0];
  // If account is frozen/overdue, apply penalty rate
  if (account.status === 'FROZEN' || account.status === 'OVERDUE') {
    return PENALTY_APR;
  }
  return BASE_APR;
};

// ── CALCULATE INTEREST FOR A TRANSACTION ─────────────────────
const calculateTransactionInterest = (amount, apr, daysUsed, isInFreePeriod) => {
  if (isInFreePeriod && daysUsed <= 30) {
    return {
      interest:       0,
      free_days_used: daysUsed,
      paid_days:      0,
      rate_applied:   0,
    };
  }

  // Days beyond free period
  const paidDays = isInFreePeriod ? Math.max(0, daysUsed - 30) : daysUsed;
  const dailyRate = parseFloat(apr) / 100 / 365;
  const interest  = parseFloat(amount) * dailyRate * paidDays;

  return {
    interest:       parseFloat(interest.toFixed(2)),
    free_days_used: isInFreePeriod ? Math.min(daysUsed, 30) : 0,
    paid_days:      paidDays,
    rate_applied:   dailyRate,
  };
};

// ── CALCULATE STATEMENT INTEREST ─────────────────────────────
// Called at end of billing cycle to calculate total interest
const calculateStatementInterest = async (accountId, cycleStart, cycleEnd) => {
  // Get all settled transactions in this cycle
  const txns = await query(`
    SELECT txn_id, amount, settled_at, is_in_free_period
    FROM transactions
    WHERE account_id = $1
      AND status = 'SETTLED'
      AND settled_at BETWEEN $2 AND $3
    ORDER BY settled_at ASC
  `, [accountId, cycleStart, cycleEnd]);

  // Get account APR — may be penalty rate if overdue
  const effectiveApr = await getEffectiveAPR(accountId);
  const accountRes = await query(
    'SELECT apr, credit_limit FROM credit_accounts WHERE account_id = $1',
    [accountId]
  );
  const apr = effectiveApr;

  // Get repayments during cycle
  const repayments = await query(`
    SELECT amount, created_at FROM repayments
    WHERE account_id = $1
      AND status = 'SUCCESS'
      AND created_at BETWEEN $2 AND $3
    ORDER BY created_at ASC
  `, [accountId, cycleStart, cycleEnd]);

  // Calculate interest on each transaction
  let totalInterest   = 0;
  let totalPrincipal  = 0;
  const breakdown     = [];

  const cycleEndDate = new Date(cycleEnd);

  for (const txn of txns.rows) {
    const txnDate  = new Date(txn.settled_at);
    const daysUsed = Math.ceil((cycleEndDate - txnDate) / (1000 * 60 * 60 * 24));

    // Check if any repayment reduces this transaction's balance
    let effectiveAmount = parseFloat(txn.amount);
    for (const repayment of repayments.rows) {
      if (new Date(repayment.created_at) > txnDate) {
        effectiveAmount = Math.max(0, effectiveAmount - parseFloat(repayment.amount));
      }
    }

    const calc = calculateTransactionInterest(
      effectiveAmount, apr, daysUsed, txn.is_in_free_period
    );

    totalInterest  += calc.interest;
    totalPrincipal += effectiveAmount;

    breakdown.push({
      txn_id:        txn.txn_id,
      amount:        effectiveAmount,
      days_used:     daysUsed,
      free_days:     calc.free_days_used,
      paid_days:     calc.paid_days,
      interest:      calc.interest,
      is_free_period: txn.is_in_free_period,
    });
  }

  return {
    total_principal: parseFloat(totalPrincipal.toFixed(2)),
    total_interest:  parseFloat(totalInterest.toFixed(2)),
    apr,
    cycle_start:     cycleStart,
    cycle_end:       cycleEnd,
    breakdown,
  };
};

// ── CALCULATE MINIMUM PAYMENT DUE ────────────────────────────
const calculateMinimumDue = (outstanding, interest, totalDue) => {
  if (totalDue <= 0) return 0;

  // Minimum due = higher of:
  // 1. 5% of total outstanding
  // 2. All interest + 1% of principal
  // 3. ₹100 (minimum floor)
  const option1 = totalDue * 0.05;
  const option2 = interest + (outstanding * 0.01);
  const minDue  = Math.max(option1, option2, 100);

  return parseFloat(Math.min(minDue, totalDue).toFixed(2));
};

module.exports = {
  calculateTransactionInterest,
  calculateStatementInterest,
  calculateMinimumDue,
  getEffectiveAPR,
  BASE_APR,
  PENALTY_APR,
};
