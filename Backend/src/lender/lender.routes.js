const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

// ── TIMING-SAFE AUTH ──────────────────────────────────────────
// NEVER use === for token comparison — timing attacks can extract
// the secret character-by-character. Always use crypto.timingSafeEqual.
const lenderAuth = (req, res, next) => {
  const provided = req.headers['x-lender-token'] || '';
  const expected = process.env.LENDER_TOKEN || 'lienpay-lender-2026';

  if (provided.length !== expected.length) {
    logger.warn('Lender auth failure (length mismatch)', { ip: req.ip });
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8')
  );

  if (!match) {
    logger.warn('Lender auth failure (bad token)', { ip: req.ip, path: req.path });
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(lenderAuth);

// ── BOOK OVERVIEW ─────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    let book = {rows:[{}]}, risk = {rows:[]}, collections = {rows:[{}]}, ltv = {rows:[{}]};
    try { book = await query(`
      SELECT COUNT(*) as total_accounts,
             COALESCE(SUM(credit_limit),0) as total_sanctioned,
             COALESCE(SUM(outstanding),0) as total_outstanding,
             COALESCE(SUM(available_credit),0) as total_undrawn,
             COUNT(*) FILTER (WHERE status='ACTIVE') as active_accounts,
             COALESCE(AVG(credit_limit),0) as avg_ticket_size
      FROM credit_accounts`); } catch(e) { logger.error('Lender book query:', e.message); }
    try { risk = await query(`
      SELECT rd.risk_tier, COUNT(*) as count,
             COALESCE(SUM(rd.approved_limit),0) as tier_exposure,
             AVG(rd.apr) as avg_apr
      FROM risk_decisions rd
      JOIN credit_accounts ca ON ca.user_id = rd.user_id
      WHERE rd.decision='APPROVED' GROUP BY rd.risk_tier`); } catch(e) {}
    try { collections = await query(`
      SELECT COUNT(*) as total_repayments,
             COALESCE(SUM(amount),0) as total_collected,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as repayments_30d,
             COALESCE(SUM(amount) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'),0) as collected_30d
      FROM repayments WHERE status='SUCCESS'`); } catch(e) {}
    try { ltv = await query(`
      SELECT COUNT(*) FILTER (WHERE ltv_ratio < 0.50) as safe,
             COUNT(*) FILTER (WHERE ltv_ratio >= 0.50 AND ltv_ratio < 0.75) as watch,
             COUNT(*) FILTER (WHERE ltv_ratio >= 0.75 AND ltv_ratio < 0.90) as amber,
             COUNT(*) FILTER (WHERE ltv_ratio >= 0.90) as red
      FROM ltv_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ltv_snapshots)`); } catch(e) {}

    res.json({ success: true, data: {
      book:        book.rows[0],
      risk_tiers:  risk.rows,
      collections: collections.rows[0],
      ltv_health:  ltv.rows[0] || { safe:0, watch:0, amber:0, red:0 },
      timestamp:   new Date().toISOString(),
    }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── COLLATERAL ────────────────────────────────────────────────
router.get('/collateral', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.pledge_id, p.folio_number, p.scheme_name, p.isin,
             p.units_pledged, p.nav_at_pledge, p.value_at_pledge,
             p.ltv_cap, p.status, p.created_at,
             mh.scheme_type,
             u.full_name,
             ca.credit_limit, ca.outstanding,
             COALESCE(nf.is_active, false) as is_notorious
      FROM pledges p
      JOIN users u ON u.user_id = p.user_id
      JOIN credit_accounts ca ON ca.user_id = p.user_id
      LEFT JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
      LEFT JOIN notorious_funds nf ON nf.isin = p.isin AND nf.is_active = true
      WHERE p.status = 'ACTIVE'
      ORDER BY p.value_at_pledge DESC
    `);
    res.json({ success: true, data: {
      pledges: result.rows,
      total_collateral_value: result.rows.reduce((s,r) => s + parseFloat(r.value_at_pledge||0), 0),
    }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── EXPOSURE ──────────────────────────────────────────────────
router.get('/exposure', async (req, res) => {
  try {
    const result = await query(`
      SELECT ca.account_id, ca.credit_limit, ca.outstanding, ca.available_credit,
             ca.apr, ca.apr_product, ca.ltv_ratio, ca.ltv_alert_level,
             ca.upi_vpa, ca.upi_active, ca.status,
             u.full_name, u.mobile,
             rd.risk_tier, rd.fraud_score
      FROM credit_accounts ca
      JOIN users u ON u.user_id = ca.user_id
      LEFT JOIN risk_decisions rd ON rd.user_id = ca.user_id
      ORDER BY ca.outstanding DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── MARGIN CALLS ──────────────────────────────────────────────
router.get('/margin-calls', async (req, res) => {
  try {
    const result = await query(`
      SELECT mc.margin_call_id, mc.ltv_at_trigger, mc.outstanding_at_trigger,
             mc.deadline, mc.status, mc.created_at, mc.resolved_at,
             EXTRACT(DAY FROM NOW() - mc.created_at) as days_elapsed,
             u.full_name, u.mobile,
             ca.credit_limit, ca.outstanding, ca.ltv_ratio
      FROM margin_calls mc
      JOIN users u ON u.user_id = mc.user_id
      JOIN credit_accounts ca ON ca.user_id = mc.user_id
      WHERE mc.status IN ('PENDING', 'ISSUED')
      ORDER BY mc.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── DISBURSEMENTS ─────────────────────────────────────────────
router.get('/disbursements', async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await query(`
      SELECT t.txn_id, t.merchant_vpa, t.merchant_name, t.amount,
             t.status, t.utr, t.initiated_at, t.settled_at,
             t.is_in_free_period,
             u.full_name,
             ca.credit_limit, ca.outstanding
      FROM transactions t
      JOIN users u ON u.user_id = t.user_id
      JOIN credit_accounts ca ON ca.user_id = t.user_id
      ORDER BY t.initiated_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── APPLICATIONS (enrichment for NBFC credit decisions) ───────
router.get('/applications', async (req, res) => {
  try {
    const { status = 'PENDING' } = req.query;

    const result = await query(`
      SELECT
        u.user_id, u.full_name, u.pan_last4, u.kyc_status, u.created_at,
        rd.decision_id, rd.approved_limit, rd.risk_tier, rd.apr,
        rd.fraud_score, rd.decided_at,
        ca.status as account_status, ca.apr_product,

        -- Portfolio summary
        (SELECT COUNT(*) FROM pledges p WHERE p.user_id = u.user_id AND p.status = 'ACTIVE') as pledge_count,
        (SELECT COALESCE(SUM(value_at_pledge),0) FROM pledges p WHERE p.user_id = u.user_id AND p.status = 'ACTIVE') as total_pledged,
        (SELECT COALESCE(SUM(mh.value_at_fetch),0) FROM mf_holdings mh WHERE mh.user_id = u.user_id) as total_portfolio,

        -- Enrichment: pledge concentration %
        CASE
          WHEN (SELECT COALESCE(SUM(mh.value_at_fetch),0) FROM mf_holdings mh WHERE mh.user_id = u.user_id) > 0
          THEN ROUND(
            (SELECT COALESCE(SUM(value_at_pledge),0) FROM pledges p WHERE p.user_id = u.user_id AND p.status = 'ACTIVE')
            / (SELECT COALESCE(SUM(mh.value_at_fetch),0) FROM mf_holdings mh WHERE mh.user_id = u.user_id) * 100, 1
          )
          ELSE 0
        END as pledge_concentration_pct,

        -- Enrichment: notorious fund flag
        EXISTS(
          SELECT 1 FROM pledges p
          JOIN notorious_funds nf ON nf.isin = p.isin AND nf.is_active = true
          WHERE p.user_id = u.user_id AND p.status = 'ACTIVE'
        ) as has_notorious_funds

      FROM users u
      JOIN risk_decisions rd ON rd.user_id = u.user_id
      LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      WHERE rd.decision = 'APPROVED'
        AND (ca.status = $1 OR ca.status IS NULL)
      ORDER BY rd.decided_at DESC
    `, [status === 'PENDING' ? 'COOLING_OFF' : status]);

    // Calculate fund quality score for each application
    const enriched = await Promise.all(result.rows.map(async (row) => {
      try {
        const funds = await query(`
          SELECT mh.scheme_type,
                 COALESCE(p.eligible_value_at_pledge, mh.eligible_value) as eligible_value
          FROM mf_holdings mh
          LEFT JOIN pledges p ON p.folio_number = mh.folio_number AND p.user_id = mh.user_id AND p.status = 'ACTIVE'
          WHERE mh.user_id = $1
        `, [row.user_id]);

        const QUALITY_SCORES = {
          'DEBT_LIQUID':      100, 'DEBT_SHORT_DUR':    90,
          'EQUITY_LARGE_CAP': 90,  'EQUITY_INDEX':       85,
          'EQUITY_FLEXI_CAP': 75,  'EQUITY_MID_CAP':    65,
          'HYBRID_BALANCED':  70,  'EQUITY_SMALL_CAP':   45,
        };

        let totalValue = 0, weightedScore = 0;
        for (const f of funds.rows) {
          const v = parseFloat(f.eligible_value || 0);
          const s = QUALITY_SCORES[f.scheme_type] || 60;
          totalValue    += v;
          weightedScore += v * s;
        }

        const fundQualityScore = totalValue > 0
          ? Math.round(weightedScore / totalValue)
          : 60;

        // Concentration band
        const conc = parseFloat(row.pledge_concentration_pct || 0);
        const concentrationBand = conc <= 30 ? 'LOW' : conc <= 70 ? 'MEDIUM' : 'HIGH';

        // Confidence score (out of 100)
        const fraudScore = parseInt(row.fraud_score || 0);
        const fraudPoints = fraudScore < 20 ? 30 : fraudScore < 50 ? 20 : 0;
        const qualityPoints = fundQualityScore >= 80 ? 25 : fundQualityScore >= 65 ? 15 : 5;
        const concPoints = conc <= 30 ? 25 : conc <= 75 ? 15 : 5;
        const vintagePoints = 12; // Default — accurate vintage needs live MF Central API
        const confidenceScore = fraudPoints + qualityPoints + concPoints + vintagePoints;
        const confidenceLevel = confidenceScore >= 80 ? 'HIGH' : confidenceScore >= 55 ? 'MEDIUM' : 'LOW';

        return {
          ...row,
          fund_quality_score:   fundQualityScore,
          concentration_band:   concentrationBand,
          confidence_score:     confidenceScore,
          confidence_level:     confidenceLevel,
        };
      } catch (_) {
        return { ...row, fund_quality_score: 60, concentration_band: 'MEDIUM', confidence_score: 55, confidence_level: 'MEDIUM' };
      }
    }));

    res.json({ success: true, data: { applications: enriched, total: enriched.length } });
  } catch (err) {
    logger.error('Lender applications error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
