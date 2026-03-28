const express = require('express');
const router  = express.Router();
const { addFundBatch, getFullUniverse } = require('../portfolio/fund.universe');
const { success, error, serverError } = require('../utils/response');
const { logger } = require('../../config/logger');

// ── All routes require admin token ────────────────────────────
const requireAdmin = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  if (token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
};

router.use(requireAdmin);

/**
 * GET /api/admin/fund-universe
 * View the full fund universe (all batches, all statuses).
 */
router.get('/', async (req, res) => {
  try {
    const funds = await getFullUniverse();
    return success(res, {
      total:    funds.length,
      active:   funds.filter(f => f.status === 'ACTIVE').length,
      pending:  funds.filter(f => f.status === 'PENDING').length,
      inactive: funds.filter(f => f.status === 'INACTIVE').length,
      funds,
    });
  } catch (err) {
    logger.error('getFullUniverse error:', err);
    return serverError(res);
  }
});

/**
 * POST /api/admin/fund-universe/batch
 * Upload a new batch of manually categorised funds.
 *
 * Body:
 * {
 *   batch_label: "BATCH_2_MARCH_2026",
 *   funds: [
 *     {
 *       scheme_code: 120586,
 *       fund_name: "ICICI Pru Large Cap - Direct",
 *       scheme_type: "EQUITY_LARGE_CAP",   ← founder assigns this
 *       ltv_rate: 0.40,                     ← pre-defined per category
 *       rta: "CAMS"
 *     },
 *     ...
 *   ]
 * }
 *
 * scheme_type options:
 *   EQUITY_LARGE_CAP, EQUITY_LARGE_MID_CAP, EQUITY_MID_CAP,
 *   EQUITY_SMALL_CAP, EQUITY_FLEXI_CAP, INDEX_FUND,
 *   DEBT_LIQUID, DEBT_SHORT_DUR, HYBRID_BALANCED
 *
 * ltv_rate reference (per fund universe doc):
 *   EQUITY_LARGE_CAP     → 0.40
 *   EQUITY_LARGE_MID_CAP → 0.35
 *   EQUITY_MID_CAP       → 0.40
 *   EQUITY_SMALL_CAP     → 0.25
 *   EQUITY_FLEXI_CAP     → 0.35
 *   INDEX_FUND           → 0.40
 */
router.post('/batch', async (req, res) => {
  try {
    const { batch_label, funds } = req.body;

    if (!funds || !Array.isArray(funds) || funds.length === 0) {
      return error(res, 'funds array is required', 400);
    }
    if (!batch_label) {
      return error(res, 'batch_label is required (e.g. "BATCH_2_MARCH_2026")', 400);
    }

    // Validate each fund
    const VALID_SCHEME_TYPES = [
      'EQUITY_LARGE_CAP', 'EQUITY_LARGE_MID_CAP', 'EQUITY_MID_CAP',
      'EQUITY_SMALL_CAP', 'EQUITY_FLEXI_CAP', 'INDEX_FUND', 'ETF',
      'DEBT_LIQUID', 'DEBT_OVERNIGHT', 'DEBT_SHORT_DUR', 'DEBT_MEDIUM_DUR',
      'DEBT_LONG_DUR', 'DEBT_CORPORATE', 'DEBT_GILT', 'DEBT_CREDIT_RISK',
      'HYBRID_BALANCED', 'HYBRID_AGGRESSIVE', 'HYBRID_CONSERVATIVE',
    ];

    const validationErrors = [];
    for (let i = 0; i < funds.length; i++) {
      const f = funds[i];
      if (!f.scheme_code || isNaN(parseInt(f.scheme_code))) {
        validationErrors.push(`Fund ${i}: scheme_code must be a number`);
      }
      if (!f.fund_name) {
        validationErrors.push(`Fund ${i}: fund_name is required`);
      }
      if (!VALID_SCHEME_TYPES.includes(f.scheme_type)) {
        validationErrors.push(`Fund ${i} (${f.fund_name}): invalid scheme_type "${f.scheme_type}". Valid: ${VALID_SCHEME_TYPES.join(', ')}`);
      }
      if (!f.ltv_rate || parseFloat(f.ltv_rate) <= 0 || parseFloat(f.ltv_rate) > 1) {
        validationErrors.push(`Fund ${i} (${f.fund_name}): ltv_rate must be between 0 and 1 (e.g. 0.40 for 40%)`);
      }
    }

    if (validationErrors.length > 0) {
      return error(res, `Validation failed: ${validationErrors.join('; ')}`, 400);
    }

    const addedBy = req.headers['x-admin-user'] || 'admin';
    const results = await addFundBatch(funds, batch_label, addedBy);

    logger.info(`📦 Fund universe batch uploaded: ${results.added} added, ${results.updated} updated`, {
      batch_label, added_by: addedBy,
    });

    return success(res, results, `Batch "${batch_label}" processed: ${results.added} added, ${results.updated} updated`);
  } catch (err) {
    logger.error('addFundBatch error:', err);
    return serverError(res);
  }
});

/**
 * PATCH /api/admin/fund-universe/:scheme_code/status
 * Activate, deactivate, or mark a fund as pending review.
 * Body: { status: "ACTIVE" | "PENDING" | "INACTIVE" }
 */
router.patch('/:scheme_code/status', async (req, res) => {
  try {
    const { scheme_code } = req.params;
    const { status } = req.body;

    if (!['ACTIVE', 'PENDING', 'INACTIVE'].includes(status)) {
      return error(res, 'status must be ACTIVE, PENDING, or INACTIVE', 400);
    }

    const { query } = require('../../config/database');
    const result = await query(
      `UPDATE fund_universe SET status=$1, updated_at=NOW() WHERE scheme_code=$2 RETURNING *`,
      [status, parseInt(scheme_code)]
    );

    if (!result.rows.length) {
      return error(res, `Fund with scheme_code ${scheme_code} not found`, 404);
    }

    logger.info(`Fund ${scheme_code} status updated to ${status}`);
    return success(res, result.rows[0], `Fund status updated to ${status}`);
  } catch (err) {
    logger.error('updateFundStatus error:', err);
    return serverError(res);
  }
});

module.exports = router;
