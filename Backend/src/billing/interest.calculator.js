// ─────────────────────────────────────────────────────────────
// INTEREST CALCULATOR — CREDIT CARD BILLING CYCLE MODEL
//
// CORRECT MODEL:
//   All transactions within a billing cycle are interest-free
//   until the due_date. This matches how credit cards work:
//   you can spend all month, pay by the due date, pay zero interest.
//
//   After due_date passes with outstanding balance:
//     interest = outstanding × (APR/365) × days_past_due
//
//   This is a CYCLE-LEVEL calculation, not per-transaction.
//
// OLD (WRONG) MODEL:
//   Each transaction had its own 30-day free period from its
//   transaction date. Wrong — this is not how credit cards work.
// ─────────────────────────────────────────────────────────────

// ── CALCULATE INTEREST FOR A SINGLE TRANSACTION ───────────────
// Used in statement generation.
// Now takes dueDate instead of isInFreePeriod boolean.
// Interest only accrues from dueDate → cycleEnd (if past due).
const calculateTransactionInterest = (amount, apr, txnDate, cycleEnd, dueDate) => {
  const from       = new Date(txnDate)
  const to         = new Date(cycleEnd)
  const dueDt      = dueDate ? new Date(dueDate) : null
  const msPerDay   = 1000 * 60 * 60 * 24

  const totalDays  = Math.max(0, Math.ceil((to - from) / msPerDay))

  if (totalDays <= 0) {
    return { principal: parseFloat(amount), apr: parseFloat(apr), total_days: 0, free_days: 0, charged_days: 0, daily_rate: 0, interest: 0 }
  }

  // ── CREDIT CARD MODEL ─────────────────────────────────────
  // If statement is being generated BEFORE due_date →
  //   still in free period → 0 interest on this transaction
  // If statement is generated AFTER due_date →
  //   chargedDays = days from due_date to cycleEnd
  let chargedDays = 0
  let freeDays    = totalDays

  if (dueDt && to > dueDt) {
    // Past due: charge interest from due_date to cycleEnd
    chargedDays = Math.max(0, Math.ceil((to - dueDt) / msPerDay))
    freeDays    = totalDays - chargedDays
  }
  // If dueDate is null or cycleEnd <= dueDate: still free period, chargedDays = 0

  const dailyRate = parseFloat(apr) / 100 / 365
  const interest  = parseFloat(amount) * dailyRate * chargedDays

  return {
    principal:     parseFloat(amount),
    apr:           parseFloat(apr),
    total_days:    totalDays,
    free_days:     Math.max(0, freeDays),
    charged_days:  chargedDays,
    daily_rate:    parseFloat((dailyRate * 100).toFixed(6)),
    interest:      parseFloat(interest.toFixed(2)),
  }
}

// ── CALCULATE STATEMENT INTEREST FOR A FULL BILLING CYCLE ────
// Called at statement generation time.
// Now accepts dueDate to correctly identify the free period.
const calculateStatementInterest = (transactions, apr, cycleStart, cycleEnd, dueDate) => {
  let totalInterest  = 0
  let totalPrincipal = 0
  const breakdown    = []

  for (const txn of transactions) {
    if (txn.status !== 'SETTLED') continue

    const txnDate = new Date(txn.settled_at || txn.initiated_at)
    const calc    = calculateTransactionInterest(
      txn.amount,
      apr,
      txnDate,
      cycleEnd,
      dueDate,  // ← passed through now
    )

    totalInterest  += calc.interest
    totalPrincipal += calc.principal

    breakdown.push({
      txn_id:       txn.txn_id,
      merchant:     txn.merchant_name || txn.merchant_vpa,
      amount:       calc.principal,
      txn_date:     txnDate.toISOString().split('T')[0],
      free_days:    calc.free_days,
      charged_days: calc.charged_days,
      interest:     calc.interest,
      note: calc.charged_days === 0
        ? 'Interest-free (within billing cycle free period)'
        : `Interest charged from due date (${new Date(dueDate).toLocaleDateString('en-IN')})`,
    })
  }

  return {
    total_principal: parseFloat(totalPrincipal.toFixed(2)),
    total_interest:  parseFloat(totalInterest.toFixed(2)),
    total_due:       parseFloat((totalPrincipal + totalInterest).toFixed(2)),
    apr,
    cycle_start:     cycleStart,
    cycle_end:       cycleEnd,
    due_date:        dueDate,
    breakdown,
  }
}

// ── CALCULATE MINIMUM AMOUNT DUE ─────────────────────────────
// Minimum due = max(5% of total_due, total_interest + fees, ₹200)
const calculateMAD = (closingBalance, interestCharged) => {
  if (closingBalance <= 0) return 0

  const fivePercent    = closingBalance * 0.05
  const interestAndFee = interestCharged
  const minimumFloor   = 200

  return Math.max(Math.round(Math.max(fivePercent, interestAndFee, minimumFloor)), 0)
}

// ── CALCULATE PENAL INTEREST (for overdue statements) ─────────
// If a statement is not paid by due_date, penal interest applies
// on the next statement cycle at 2× the normal APR
const calculatePenalInterest = (overdueAmount, dueDateStr, apr = 12) => {
  const dueDate   = new Date(dueDateStr)
  const today     = new Date()
  const msPerDay  = 1000 * 60 * 60 * 24
  const daysOverdue = Math.max(0, Math.ceil((today - dueDate) / msPerDay))

  if (daysOverdue === 0) return { penal_interest: 0, days_overdue: 0 }

  // Penal rate = 2× normal APR (capped at 24%)
  const penalApr    = Math.min(apr * 2, 24)
  const dailyRate   = penalApr / 100 / 365
  const penalAmount = parseFloat(overdueAmount) * dailyRate * daysOverdue

  return {
    penal_interest: parseFloat(penalAmount.toFixed(2)),
    days_overdue:   daysOverdue,
    penal_apr:      penalApr,
    daily_rate:     parseFloat((dailyRate * 100).toFixed(6)),
  }
}

// ── HOW MANY DAYS LEFT IN FREE PERIOD ────────────────────────
// Used by frontend to show countdown
const daysUntilDue = (dueDateStr) => {
  if (!dueDateStr) return null
  const dueDate  = new Date(dueDateStr)
  const today    = new Date()
  const msPerDay = 1000 * 60 * 60 * 24
  return Math.max(0, Math.ceil((dueDate - today) / msPerDay))
}

module.exports = {
  calculateTransactionInterest,
  calculateStatementInterest,
  calculateMAD,
  calculatePenalInterest,
  daysUntilDue,
}
