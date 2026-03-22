const express = require('express');
const router  = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'lienpay-admin-2026')) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(adminAuth);

router.get('/overview', async (req, res) => {
  try {
    // Each query independent — one failure doesn't kill all
    const empty = { rows: [{}] };
    let users=empty,sessions=empty,otps=empty,credit=empty,txns=empty,pledges=empty,statements=empty;
    try { users = await query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE account_status = 'ONBOARDING') as onboarding, COUNT(*) FILTER (WHERE kyc_status = 'VERIFIED') as kyc_done, COUNT(*) FILTER (WHERE account_status = 'CREDIT_ACTIVE') as active, COUNT(*) FILTER (WHERE account_status = 'OVERDUE') as overdue, COUNT(*) FILTER (WHERE account_status = 'MARGIN_CALL') as margin_call, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_today FROM users WHERE deleted_at IS NULL`); } catch(e) { logger.error('Admin users query:', e.message); }
    try { sessions = await query(`SELECT COUNT(*) as active_sessions FROM sessions WHERE is_active = true AND expires_at > NOW()`); } catch(e) {}
    try { otps = await query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'VERIFIED') as verified, COUNT(*) FILTER (WHERE status = 'LOCKED') as locked, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today FROM otp_logs`); } catch(e) {}
    try { credit = await query(`SELECT COUNT(*) as total_accounts, COALESCE(SUM(credit_limit), 0) as total_limit, COALESCE(SUM(outstanding), 0) as total_outstanding, COALESCE(SUM(available_credit), 0) as total_available, COUNT(*) FILTER (WHERE status = 'ACTIVE') as active, COUNT(*) FILTER (WHERE status = 'FROZEN') as frozen FROM credit_accounts`); } catch(e) {}
    try { txns = await query(`SELECT COUNT(*) as total, COALESCE(SUM(amount), 0) as total_volume, COUNT(*) FILTER (WHERE status = 'SETTLED') as settled, COUNT(*) FILTER (WHERE status = 'FAILED') as failed, COUNT(*) FILTER (WHERE initiated_at > NOW() - INTERVAL '24 hours') as today, COALESCE(SUM(amount) FILTER (WHERE initiated_at > NOW() - INTERVAL '7 days'), 0) as week_volume FROM transactions`); } catch(e) {}
    try { pledges = await query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'ACTIVE') as active, COUNT(*) FILTER (WHERE rta = 'CAMS') as cams, COUNT(*) FILTER (WHERE rta = 'KFINTECH') as kfintech FROM pledges`); } catch(e) {}
    try { statements = await query(`SELECT COUNT(*) as total, COALESCE(SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END), 0) as paid, COALESCE(SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END), 0) as overdue FROM statements`); } catch(e) {}
    res.json({ success: true, data: { users: users.rows[0], sessions: sessions.rows[0], otps: otps.rows[0], credit: credit.rows[0], transactions: txns.rows[0], pledges: pledges.rows[0], statements: statements.rows[0], timestamp: new Date().toISOString() } });
  } catch (err) { logger.error('Admin overview error:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

router.get('/users', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;
    const where = status ? `AND account_status = '${status}'` : '';
    const result = await query(`SELECT user_id, mobile, full_name, pan_last4, kyc_status, account_status, onboarding_step, created_at FROM users WHERE deleted_at IS NULL ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const [user, kyc, credit, pledges, txns, risk] = await Promise.all([
      query('SELECT * FROM users WHERE user_id = $1', [userId]),
      query('SELECT * FROM kyc_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]),
      query('SELECT * FROM credit_accounts WHERE user_id = $1', [userId]),
      query('SELECT * FROM pledges WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      query('SELECT * FROM transactions WHERE user_id = $1 ORDER BY initiated_at DESC LIMIT 20', [userId]),
      query('SELECT * FROM risk_decisions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [userId]),
    ]);
    res.json({ success: true, data: { user: user.rows[0], kyc: kyc.rows[0], credit: credit.rows[0], pledges: pledges.rows, transactions: txns.rows, risk: risk.rows[0] } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/credit-accounts', async (req, res) => {
  try {
    const result = await query(`SELECT ca.*, u.full_name, u.mobile, rd.risk_tier, rd.apr FROM credit_accounts ca JOIN users u ON u.user_id = ca.user_id LEFT JOIN risk_decisions rd ON rd.user_id = ca.user_id ORDER BY ca.created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/ltv-health', async (req, res) => {
  try {
    const result = await query(`SELECT ls.*, u.full_name, ca.credit_limit, ca.outstanding FROM ltv_snapshots ls JOIN users u ON u.user_id = ls.user_id JOIN credit_accounts ca ON ca.user_id = ls.user_id WHERE ls.snapshot_date = (SELECT MAX(snapshot_date) FROM ltv_snapshots) ORDER BY ls.ltv_ratio DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/pledges', async (req, res) => {
  try {
    const result = await query(`SELECT p.*, u.full_name, mh.scheme_name, mh.scheme_type FROM pledges p JOIN users u ON u.user_id = p.user_id LEFT JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id ORDER BY p.created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/transactions', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const result = await query(`SELECT t.*, u.full_name FROM transactions t JOIN users u ON u.user_id = t.user_id ORDER BY t.initiated_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/risk-distribution', async (req, res) => {
  try {
    const result = await query(`SELECT risk_tier, COUNT(*) as count, AVG(approved_limit) as avg_limit, AVG(apr) as avg_apr FROM risk_decisions WHERE decision = 'APPROVED' GROUP BY risk_tier ORDER BY risk_tier`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/audit', async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await query(`SELECT * FROM audit_trail ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/system-health', async (req, res) => {
  try {
    const dbCheck = await query('SELECT NOW() as db_time, version() as db_version');
    res.json({ success: true, data: { database: { status: 'connected', ...dbCheck.rows[0] }, uptime: process.uptime(), memory: process.memoryUsage(), node: process.version } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
