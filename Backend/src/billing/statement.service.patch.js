// ─────────────────────────────────────────────────────────────
// PATCH — apply to Backend/src/billing/statement.service.js
//
// The ONLY change needed is passing account.due_date to
// calculateStatementInterest so it knows where the free period ends.
//
// FIND this line in generateStatement():
//
//   const interestCalc = calculateStatementInterest(
//     transactions,
//     account.apr,
//     cycleStart,
//     cycleEnd
//   );
//
// REPLACE WITH:
//
//   const interestCalc = calculateStatementInterest(
//     transactions,
//     account.apr,
//     cycleStart,
//     cycleEnd,
//     dueDate       // ← ADD THIS — tells calculator where free period ends
//   );
//
// That's the only change in statement.service.js.
// Everything else stays the same.
//
// WHAT THIS DOES:
// - If statement is generated before due_date (normal case):
//     → calculateStatementInterest sees cycleEnd <= dueDate
//     → chargedDays = 0 for all transactions
//     → total_interest = 0 on the statement
//     → User sees: "Pay by [due_date] to avoid interest"
//
// - If statement is generated after due_date (overdue case):
//     → chargedDays = days from due_date to cycleEnd
//     → Interest = outstanding × APR/365 × days_past_due
//     → User sees interest charged on statement
// ─────────────────────────────────────────────────────────────
