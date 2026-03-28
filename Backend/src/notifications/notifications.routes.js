const express   = require('express');
const router    = express.Router();
const { query } = require('../../config/database');
const { authenticate } = require('../middleware/auth.middleware');
const { success, serverError } = require('../utils/response');
const { checkLTVHealth } = require('../risk/risk.engine');

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS SERVICE
// Aggregates real-time data from multiple tables into a unified
// notification feed for the frontend bell.
//
// Sources:
//   1. margin_calls        → MARGIN_CALL alerts
//   2. LTV health check    → LTV_WARNING (>80%) alerts
//   3. statements          → PAYMENT_DUE reminders
//   4. transactions        → CREDIT_ACTIVITY confirmations
// ─────────────────────────────────────────────────────────────

router.use(authenticate);

/**
 * GET /api/notifications
 * Returns up to 20 real notifications for the authenticated user.
 */
router.get('/', async (req, res) => {
  const userId = req.user.user_id;
  const notifs = [];

  try {
    // ── 1. MARGIN CALLS ────────────────────────────────────
    const marginCalls = await query(`
      SELECT mc.*, ca.outstanding, ca.credit_limit
      FROM margin_calls mc
      JOIN credit_accounts ca ON ca.user_id = mc.user_id
      WHERE mc.user_id = $1
        AND mc.status IN ('ISSUED', 'ACKNOWLEDGED')
      ORDER BY mc.issued_at DESC
      LIMIT 3
    `, [userId]).catch(() => ({ rows: [] }));

    for (const mc of marginCalls.rows) {
      notifs.push({
        id:      `mc_${mc.margin_call_id || mc.id}`,
        type:    'margin_calls',
        icon:    '🔴',
        color:   '#EF4444',
        title:   'Margin Call Issued',
        body:    `LTV crossed 90%. Repay ₹${parseFloat(mc.amount_required || mc.outstanding || 0).toLocaleString('en-IN')} within 3 business days to avoid pledge invocation.`,
        ts:      new Date(mc.issued_at).getTime(),
        read:    mc.status === 'ACKNOWLEDGED',
        action:  'repay',
      });
    }

    // ── 2. LTV WARNING (check current LTV) ─────────────────
    const accountRes = await query(
      `SELECT account_id, outstanding, credit_limit FROM credit_accounts
       WHERE user_id=$1 AND status='ACTIVE' LIMIT 1`,
      [userId]
    ).catch(() => ({ rows: [] }));

    if (accountRes.rows.length && parseFloat(accountRes.rows[0].outstanding) > 0) {
      try {
        const ltvHealth = await checkLTVHealth(userId, accountRes.rows[0].account_id);

        if (ltvHealth.status === 'AMBER' || ltvHealth.status === 'RED') {
          const ltvPct  = parseFloat(ltvHealth.ltv_ratio || 0).toFixed(1);
          const isRed   = ltvHealth.status === 'RED';
          notifs.push({
            id:    `ltv_current`,
            type:  'ltv_warnings',
            icon:  isRed ? '🔴' : '⚡',
            color: isRed ? '#EF4444' : '#E0A030',
            title: isRed
              ? `LTV at ${ltvPct}% — Margin Call Risk`
              : `LTV at ${ltvPct}% — Approaching Limit`,
            body:  isRed
              ? 'Portfolio collateral critically low. Repay outstanding balance or add collateral immediately.'
              : 'Portfolio collateral dropped. Add funds or repay to avoid a margin call.',
            ts:    Date.now() - 2 * 60 * 60 * 1000, // mark as 2h ago
            read:  false,
            action: 'repay',
          });
        }
      } catch (_) {}
    }

    // ── 3. PAYMENT DUE (from statements) ───────────────────
    const statements = await query(`
      SELECT statement_id, due_date, total_due, minimum_due, status
      FROM statements
      WHERE user_id = $1
        AND status IN ('GENERATED', 'PARTIALLY_PAID')
        AND total_due > 0
        AND due_date >= CURRENT_DATE
      ORDER BY due_date ASC
      LIMIT 2
    `, [userId]).catch(() => ({ rows: [] }));

    for (const stmt of statements.rows) {
      const dueDate   = new Date(stmt.due_date);
      const daysLeft  = Math.ceil((dueDate - new Date()) / (1000 * 60 * 60 * 24));
      const amount    = parseFloat(stmt.total_due || 0);
      const minDue    = parseFloat(stmt.minimum_due || 0);
      const isUrgent  = daysLeft <= 3;

      notifs.push({
        id:    `stmt_${stmt.statement_id}`,
        type:  'repayment_reminders',
        icon:  '💳',
        color: isUrgent ? '#E0A030' : '#00D4A1',
        title: daysLeft === 0
          ? 'Payment Due Today'
          : daysLeft < 0
          ? 'Payment Overdue'
          : `Interest Due in ${daysLeft} Day${daysLeft === 1 ? '' : 's'}`,
        body:  `₹${amount.toLocaleString('en-IN')} due on ${dueDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Minimum payment: ₹${minDue.toLocaleString('en-IN')}.`,
        ts:    Date.now() - 5 * 60 * 60 * 1000,
        read:  false,
        action: 'billing',
      });
    }

    // ── 4. OVERDUE payments ─────────────────────────────────
    const overdue = await query(`
      SELECT statement_id, due_date, total_due
      FROM statements
      WHERE user_id = $1
        AND status IN ('GENERATED', 'PARTIALLY_PAID')
        AND total_due > 0
        AND due_date < CURRENT_DATE
      ORDER BY due_date ASC
      LIMIT 1
    `, [userId]).catch(() => ({ rows: [] }));

    for (const stmt of overdue.rows) {
      notifs.push({
        id:    `overdue_${stmt.statement_id}`,
        type:  'repayment_reminders',
        icon:  '⚠️',
        color: '#EF4444',
        title: 'Payment Overdue',
        body:  `₹${parseFloat(stmt.total_due).toLocaleString('en-IN')} was due on ${new Date(stmt.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}. Late fees may apply.`,
        ts:    new Date(stmt.due_date).getTime(),
        read:  false,
        action: 'billing',
      });
    }

    // ── 5. RECENT TRANSACTIONS ──────────────────────────────
    const txns = await query(`
      SELECT txn_id, amount, merchant_name, status, initiated_at, is_in_free_period
      FROM transactions
      WHERE user_id = $1
        AND status IN ('SETTLED', 'COMPLETED')
      ORDER BY initiated_at DESC
      LIMIT 5
    `, [userId]).catch(() => ({ rows: [] }));

    for (const txn of txns.rows) {
      const amt = parseFloat(txn.amount || 0);
      notifs.push({
        id:    `txn_${txn.txn_id}`,
        type:  'credit_activity',
        icon:  '↗',
        color: '#4DA8FF',
        title: `Payment of ₹${amt.toLocaleString('en-IN')} Processed`,
        body:  `UPI payment to ${txn.merchant_name || 'Merchant'} via LienPay credit line.${txn.is_in_free_period ? ' Interest-free period applies.' : ''}`,
        ts:    new Date(txn.initiated_at).getTime(),
        read:  true, // past transactions are already read
        action: 'home',
      });
    }

    // ── 6. PLEDGE CONFIRMATIONS ─────────────────────────────
    const recentPledges = await query(`
      SELECT pledge_id, scheme_name, rta, registered_at
      FROM pledges
      WHERE user_id = $1
        AND status = 'ACTIVE'
        AND registered_at >= NOW() - INTERVAL '7 days'
      ORDER BY registered_at DESC
      LIMIT 3
    `, [userId]).catch(() => ({ rows: [] }));

    for (const p of recentPledges.rows) {
      notifs.push({
        id:    `pledge_${p.pledge_id}`,
        type:  'credit_activity',
        icon:  '🔒',
        color: '#00D4A1',
        title: 'Pledge Registered Successfully',
        body:  `${p.scheme_name || 'Fund'} (${p.rta}) has been lien-marked. Your credit limit is now active.`,
        ts:    new Date(p.registered_at).getTime(),
        read:  true,
        action: 'portfolio',
      });
    }

    // Sort by timestamp descending, cap at 20
    notifs.sort((a, b) => b.ts - a.ts);
    const final = notifs.slice(0, 20);
    const unread = final.filter(n => !n.read).length;

    return success(res, { notifications: final, unread_count: unread });
  } catch (err) {
    return serverError(res);
  }
});

/**
 * POST /api/notifications/mark-read
 * Mark one or all notifications as read.
 * Body: { notification_ids?: string[] }  — omit to mark all
 */
router.post('/mark-read', async (req, res) => {
  // Notifications are computed dynamically so "marking read"
  // is handled client-side (stored in localStorage).
  // This endpoint exists for future persistence upgrade.
  return success(res, { message: 'ok' });
});

module.exports = router;
