const express = require('express');
const router  = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

const lenderAuth = (req, res, next) => {
  const token = req.headers['x-lender-token'];
  if (token !== (process.env.LENDER_TOKEN || 'lienpay-lender-2026')) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(lenderAuth);

router.get('/overview', async (req, res) => {
  try {
    // Each query independent — one failure doesn't kill all
    let book = { rows: [{}] }, risk = { rows: [] }, collections = { rows: [{}] }, ltv = { rows: [{}] };
    try { book = await query(`SELECT COUNT(*) as total_accounts, COALESCE(SUM(credit_limit), 0) as total_sanctioned, COALESCE(SUM(outstanding), 0) as total_outstanding, COALESCE(SUM(available_credit), 0) as total_undrawn, COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_accounts, COALESCE(AVG(credit_limit), 0) as avg_ticket_size FROM credit_accounts`); } catch(e) { logger.error('Lender book query:', e.message); }
    try { risk = await query(`SELECT risk_tier, COUNT(*) as count, COALESCE(SUM(approved_limit), 0) as tier_exposure, AVG(apr) as avg_apr FROM risk_decisions rd JOIN credit_accounts ca ON ca.user_id = rd.user_id WHERE rd.decision = 'APPROVED' GROUP BY risk_tier`); } catch(e) { logger.error('Lender risk query:', e.message); }
    try { collections = await query(`SELECT COUNT(*) as total_repayments, COALESCE(SUM(amount), 0) as total_collected, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as repayments_30d, COALESCE(SUM(amount) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0) as collected_30d FROM repayments WHERE status = 'SUCCESS'`); } catch(e) { logger.error('Lender collections query:', e.message); }
    try { ltv = await query(`SELECT COUNT(*) FILTER (WHERE ltv_ratio < 0.50) as safe, COUNT(*) FILTER (WHERE ltv_ratio >= 0.50 AND ltv_ratio < 0.75) as watch, COUNT(*) FILTER (WHERE ltv_ratio >= 0.75 AND ltv_ratio < 0.90) as amber, COUNT(*) FILTER (WHERE ltv_ratio >= 0.90) as red FROM ltv_snapshots WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ltv_snapshots)`); } catch(e) { logger.error('Lender ltv query:', e.message); }
    res.json({ success: true, data: { book: book.rows[0], risk_tiers: risk.rows, collections: collections.rows[0], ltv_health: ltv.rows[0] || { safe: 0, watch: 0, amber: 0, red: 0 }, timestamp: new Date().toISOString() } });
  } catch (err) { logger.error('Lender overview error:', err.message); res.status(500).json({ success: false, error: err.message }); }
});

router.get('/collateral', async (req, res) => {
  try {
    const result = await query(`SELECT p.*, mh.scheme_name, mh.scheme_type, mh.ltv_cap, u.full_name, ca.credit_limit, ca.outstanding FROM pledges p JOIN users u ON u.user_id = p.user_id JOIN credit_accounts ca ON ca.user_id = p.user_id LEFT JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id WHERE p.status = 'ACTIVE' ORDER BY p.value_at_pledge DESC`);
    res.json({ success: true, data: { pledges: result.rows, total_collateral_value: result.rows.reduce((s, r) => s + parseFloat(r.value_at_pledge || 0), 0) } });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/exposure', async (req, res) => {
  try {
    const result = await query(`SELECT ca.*, u.full_name, u.mobile, rd.risk_tier, rd.fraud_score FROM credit_accounts ca JOIN users u ON u.user_id = ca.user_id LEFT JOIN risk_decisions rd ON rd.user_id = ca.user_id ORDER BY ca.outstanding DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/margin-calls', async (req, res) => {
  try {
    const result = await query(`SELECT mc.*, u.full_name, u.mobile, ca.credit_limit, ca.outstanding FROM margin_calls mc JOIN users u ON u.user_id = mc.user_id JOIN credit_accounts ca ON ca.user_id = mc.user_id WHERE mc.status IN ('PENDING', 'ISSUED') ORDER BY mc.created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/disbursements', async (req, res) => {
  try {
    const result = await query(`SELECT t.*, u.full_name, ca.credit_limit, ca.outstanding FROM transactions t JOIN users u ON u.user_id = t.user_id JOIN credit_accounts ca ON ca.user_id = t.user_id ORDER BY t.initiated_at DESC LIMIT 100`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
