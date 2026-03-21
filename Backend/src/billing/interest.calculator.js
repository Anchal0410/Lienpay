// ─────────────────────────────────────────────────────────────
// INTEREST CALCULATOR
// Method: Daily reducing balance (simple interest)
// Formula: Principal × (APR/365) × Days
// Interest-free period: 30 days from each drawdown
// ─────────────────────────────────────────────────────────────

// ── CALCULATE INTEREST FOR A TRANSACTION ─────────────────────
const calculateTransactionInterest = (amount, apr, fromDate, toDate, isInFreePeriod) => {
  const from = new Date(fromDate);
  const to   = new Date(toDate);

  // Days outstanding
  const msPerDay = 1000 * 60 * 60 * 24;
  const totalDays = Math.ceil((to - from) / msPerDay);

  if (totalDays <= 0) return { interest: 0, days: 0, free_days: 0, charged_days: 0 };

  // Interest-free period: 30 days
  const FREE_DAYS = 30;
  let chargedDays = 0;
  let freeDays    = 0;

  if (isInFreePeriod) {
    freeDays    = Math.min(totalDays, FREE_DAYS);
    chargedDays = Math.max(0, totalDays - FREE_DAYS);
  } else {
    chargedDays = totalDays;
  }

  // Daily interest rate
  const dailyRate = parseFloat(apr) / 100 / 365;
  const interest  = parseFloat(amount) * dailyRate * chargedDays;

  return {
    principal:     parseFloat(amount),
    apr:           parseFloat(apr),
    total_days:    totalDays,
    free_days:     freeDays,
    charged_days:  chargedDays,
    daily_rate:    parseFloat((dailyRate * 100).toFixed(6)),
    interest:      parseFloat(interest.toFixed(2)),
  };
};

// ── CALCULATE STATEMENT INTEREST ─────────────────────────────
// For a full billing cycle — iterates over all transactions
const calculateStatementInterest = (transactions, apr, cycleStart, cycleEnd) => {
  let totalInterest  = 0;
  let totalPrincipal = 0;
  const breakdown    = [];

  for (const txn of transactions) {
    if (txn.status !== 'SETTLED') continue;

    const txnDate    = new Date(txn.settled_at || txn.initiated_at);
    const cycleEndDt = new Date(cycleEnd);

    const calc = calculateTransactionInterest(
      txn.amount,
      apr,
      txnDate,
      cycleEndDt,
      txn.is_in_free_period
    );

    totalInterest  += calc.interest;
    totalPrincipal += calc.principal;

    breakdown.push({
      txn_id:        txn.txn_id,
      merchant:      txn.merchant_name || txn.merchant_vpa,
      amount:        calc.principal,
      txn_date:      txnDate.toISOString().split('T')[0],
      days_charged:  calc.charged_days,
      free_days:     calc.free_days,
      interest:      calc.interest,
    });
  }

  return {
    total_principal: parseFloat(totalPrincipal.toFixed(2)),
    total_interest:  parseFloat(totalInterest.toFixed(2)),
    total_due:       parseFloat((totalPrincipal + totalInterest).toFixed(2)),
    breakdown,
  };
};

// ── CALCULATE PENAL INTEREST ──────────────────────────────────
// 2% per month on overdue amount after due date
const calculatePenalInterest = (overdueAmount, dueDateStr) => {
  const dueDate  = new Date(dueDateStr);
  const today    = new Date();

  if (today <= dueDate) return { penal_interest: 0, overdue_days: 0 };

  const msPerDay    = 1000 * 60 * 60 * 24;
  const overdueDays = Math.ceil((today - dueDate) / msPerDay);
  const penalRate   = 0.02 / 30; // 2% per month = per day
  const penalInt    = parseFloat(overdueAmount) * penalRate * overdueDays;

  return {
    penal_interest: parseFloat(penalInt.toFixed(2)),
    overdue_days:   overdueDays,
    penal_rate:     '2% per month',
  };
};

// ── MINIMUM AMOUNT DUE ────────────────────────────────────────
// MAD = 5% of outstanding OR total interest + fees (whichever is higher)
const calculateMAD = (outstanding, interest, fees = 0) => {
  const fivePercent     = parseFloat(outstanding) * 0.05;
  const interestPlusFees = parseFloat(interest) + parseFloat(fees);
  const mad             = Math.max(fivePercent, interestPlusFees, 200); // min ₹200

  return parseFloat(mad.toFixed(2));
};

module.exports = {
  calculateTransactionInterest,
  calculateStatementInterest,
  calculatePenalInterest,
  calculateMAD,
};
