const { query }  = require('../../config/database');
const { calculateStatementInterest, calculateMAD, calculatePenalInterest } = require('./interest.calculator');
const { sendSMS } = require('../utils/sms.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// STATEMENT GENERATOR
// Runs on 1st of every month (cron job)
// Generates monthly statement for every active credit account
// Calculates interest, MAD, total due
// Sends SMS notification to user
// ─────────────────────────────────────────────────────────────

const generateStatement = async (accountId) => {
  const accountRes = await query('SELECT * FROM credit_accounts WHERE account_id = $1', [accountId]);
  if (!accountRes.rows.length) throw new Error(`Account ${accountId} not found`);
  const account = accountRes.rows[0];

  if (account.status !== 'ACTIVE') return null;

  const cycleStart = account.current_cycle_start;
  const cycleEnd   = account.current_cycle_end;
  const dueDate    = account.due_date;

  // Idempotency — don't generate twice for same cycle
  const existingRes = await query(
    'SELECT statement_id FROM statements WHERE account_id = $1 AND billing_period_start = $2',
    [accountId, cycleStart]
  );
  if (existingRes.rows.length > 0) return existingRes.rows[0];

  // Get settled transactions for this cycle
  const txnsRes = await query(`
    SELECT txn_id, merchant_vpa, merchant_name, amount,
           settled_at, initiated_at, is_in_free_period, status
    FROM transactions
    WHERE account_id = $1 AND status = 'SETTLED'
      AND initiated_at >= $2 AND initiated_at <= $3
    ORDER BY initiated_at ASC
  `, [accountId, cycleStart, cycleEnd]);

  // Get repayments this cycle
  const repaymentsRes = await query(`
    SELECT COALESCE(SUM(amount), 0) as total_repaid
    FROM repayments
    WHERE account_id = $1 AND status = 'SUCCESS'
      AND created_at >= $2 AND created_at <= $3
  `, [accountId, cycleStart, cycleEnd]);

  const totalRepaid  = parseFloat(repaymentsRes.rows[0]?.total_repaid || 0);
  const transactions = txnsRes.rows;

  // Calculate interest
  const interestCalc = calculateStatementInterest(transactions, account.apr, cycleStart, cycleEnd);

  // Check penal interest from previous overdue statement
  const prevStmtRes = await query(
    "SELECT total_due, due_date, status FROM statements WHERE account_id = $1 ORDER BY billing_period_end DESC LIMIT 1",
    [accountId]
  );
  let penalInterest = 0;
  if (prevStmtRes.rows.length > 0 && prevStmtRes.rows[0].status === 'OVERDUE') {
    const penal = calculatePenalInterest(prevStmtRes.rows[0].total_due, prevStmtRes.rows[0].due_date);
    penalInterest = penal.penal_interest;
  }

  // Totals
  const openingBalance    = parseFloat(account.outstanding || 0);
  const totalSpend        = interestCalc.total_principal;
  const totalInterest     = interestCalc.total_interest + penalInterest;
  const closingBalance    = openingBalance + totalSpend + totalInterest - totalRepaid;
  const minimumAmountDue  = calculateMAD(closingBalance, totalInterest);
  const stmtDate          = new Date(cycleEnd);
  const stmtNumber        = `LP-${stmtDate.getFullYear()}-${String(stmtDate.getMonth() + 1).padStart(2, '0')}-${accountId.slice(0, 6).toUpperCase()}`;

  // Store statement
  const stmtRes = await query(`
    INSERT INTO statements (
      account_id, user_id, statement_number,
      billing_period_start, billing_period_end, due_date,
      opening_balance, total_spend, total_repayments,
      total_interest, penal_interest,
      closing_balance, minimum_amount_due, total_due,
      transaction_count, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'GENERATED')
    RETURNING statement_id
  `, [
    accountId, account.user_id, stmtNumber,
    cycleStart, cycleEnd, dueDate,
    openingBalance, totalSpend, totalRepaid,
    totalInterest, penalInterest,
    closingBalance, minimumAmountDue,
    Math.max(closingBalance, 0),
    transactions.length,
  ]);

  const statementId = stmtRes.rows[0].statement_id;

  // Roll billing cycle forward
  const nextStart  = new Date(cycleEnd);
  nextStart.setDate(nextStart.getDate() + 1);
  const nextEnd    = new Date(nextStart.getFullYear(), nextStart.getMonth() + 1, 0);
  const nextDue    = new Date(nextStart.getFullYear(), nextStart.getMonth() + 2, 1);

  await query(`
    UPDATE credit_accounts SET
      current_cycle_start = $2, current_cycle_end = $3, due_date = $4, updated_at = NOW()
    WHERE account_id = $1
  `, [accountId, nextStart, nextEnd, nextDue]);

  // Notify user
  await sendSMS(account.user_id, 'STATEMENT_GENERATED', {
    amount:  `₹${Math.round(closingBalance).toLocaleString('en-IN')}`,
    due:     new Date(dueDate).toLocaleDateString('en-IN'),
    mad:     `₹${Math.round(minimumAmountDue).toLocaleString('en-IN')}`,
    stmt_no: stmtNumber,
  }).catch(() => {});

  audit('STATEMENT_GENERATED', account.user_id, { statement_id: statementId, closing_balance: closingBalance });

  return {
    statement_id:       statementId,
    statement_number:   stmtNumber,
    billing_period:     { start: cycleStart, end: cycleEnd },
    due_date:           dueDate,
    opening_balance:    openingBalance,
    total_spend:        totalSpend,
    total_repayments:   totalRepaid,
    total_interest:     parseFloat(totalInterest.toFixed(2)),
    closing_balance:    parseFloat(closingBalance.toFixed(2)),
    minimum_amount_due: minimumAmountDue,
    total_due:          Math.max(parseFloat(closingBalance.toFixed(2)), 0),
    transaction_count:  transactions.length,
    interest_breakdown: interestCalc.breakdown,
  };
};

// ── MONTHLY CRON ──────────────────────────────────────────────
const runMonthlyCron = async () => {
  logger.info('📋 Running monthly statement cron...');
  const accountsRes = await query(`
    SELECT account_id FROM credit_accounts
    WHERE status = 'ACTIVE'
      AND DATE(current_cycle_end) = CURRENT_DATE - INTERVAL '1 day'
  `);

  const results = { success: 0, failed: 0, skipped: 0, errors: [] };
  for (const account of accountsRes.rows) {
    try {
      const stmt = await generateStatement(account.account_id);
      if (stmt) results.success++; else results.skipped++;
    } catch (err) {
      results.failed++;
      results.errors.push({ account_id: account.account_id, error: err.message });
    }
  }
  logger.info('✅ Monthly statement cron complete', results);
  return results;
};

const getStatement = async (userId, statementId) => {
  const result = await query(
    'SELECT * FROM statements WHERE statement_id = $1 AND user_id = $2',
    [statementId, userId]
  );
  if (!result.rows.length) throw { statusCode: 404, message: 'Statement not found' };
  return result.rows[0];
};

const getStatements = async (userId) => {
  const result = await query(`
    SELECT statement_id, statement_number, billing_period_start, billing_period_end,
           due_date, total_spend, total_interest, total_due, minimum_amount_due, status, generated_at
    FROM statements WHERE user_id = $1
    ORDER BY billing_period_end DESC LIMIT 12
  `, [userId]);
  return result.rows;
};

module.exports = { generateStatement, runMonthlyCron, getStatement, getStatements };

// Alias for cron scheduler compatibility
const runMonthlyStatements = runMonthlyCron;
module.exports.runMonthlyStatements = runMonthlyStatements;
