const express  = require('express');
const router   = express.Router();
const { evaluateCreditLimit, checkLTVHealth } = require('./risk.engine');
const { success, error, serverError } = require('../utils/response');
const { authenticate, requireKYC } = require('../middleware/auth.middleware');
const { logger } = require('../../config/logger');
const { query }  = require('../../config/database');

// ── CONTROLLER ────────────────────────────────────────────────

// POST /api/risk/evaluate
// Runs the full risk engine and returns credit limit decision
const evaluateCredit = async (req, res) => {
  try {
    const result = await evaluateCreditLimit(req.user.user_id);
    return success(res, result, 'Credit limit calculated successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('evaluateCredit error:', err);
    return serverError(res);
  }
};

// GET /api/risk/ltv-health
// Returns current LTV health for active credit account
const getLTVHealth = async (req, res) => {
  try {
    const accountRes = await query(
      'SELECT account_id FROM credit_accounts WHERE user_id = $1 AND status = $2',
      [req.user.user_id, 'ACTIVE']
    );

    if (!accountRes.rows.length) {
      return error(res, 'No active credit account found', 404);
    }

    const result = await checkLTVHealth(req.user.user_id, accountRes.rows[0].account_id);
    return success(res, result);
  } catch (err) {
    logger.error('getLTVHealth error:', err);
    return serverError(res);
  }
};

// GET /api/risk/decision
// Get the latest risk decision for the user
const getRiskDecision = async (req, res) => {
  try {
    const result = await query(`
      SELECT decision_id, approved_limit, risk_tier, apr,
             bureau_score_band, fraud_score, decided_at
      FROM risk_decisions
      WHERE user_id = $1
      ORDER BY decided_at DESC LIMIT 1
    `, [req.user.user_id]);

    if (!result.rows.length) {
      return error(res, 'No risk decision found. Please complete portfolio linking first.', 404);
    }

    return success(res, result.rows[0]);
  } catch (err) {
    logger.error('getRiskDecision error:', err);
    return serverError(res);
  }
};

// ── ROUTES ────────────────────────────────────────────────────
router.use(authenticate);
router.use(requireKYC);

/**
 * POST /api/risk/evaluate
 * Run risk engine. Returns approved_limit, risk_tier, APR.
 * Called after portfolio is linked and pledge is complete.
 */
router.post('/evaluate', evaluateCredit);

/**
 * GET /api/risk/ltv-health
 * Get current LTV health status (GREEN/AMBER/RED).
 * Called daily by frontend dashboard.
 */
router.get('/ltv-health', getLTVHealth);

/**
 * GET /api/risk/decision
 * Get the latest risk decision for display in app.
 */
router.get('/decision', getRiskDecision);

module.exports = router;
