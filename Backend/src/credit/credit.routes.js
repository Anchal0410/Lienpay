const express  = require('express');
const router   = express.Router();
const creditService = require('./credit.service');
const { success, error, serverError } = require('../utils/response');
const { authenticate, requireKYC } = require('../middleware/auth.middleware');
const { logger } = require('../../config/logger');

// ── CONTROLLERS ───────────────────────────────────────────────

// POST /api/credit/sanction
const requestSanction = async (req, res) => {
  try {
    const result = await creditService.requestSanction(req.user.user_id);
    return success(res, result, 'Credit line sanctioned successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('requestSanction error:', err);
    return serverError(res);
  }
};

// GET /api/credit/kfs
const getKFS = async (req, res) => {
  try {
    const { sanction_id, approved_limit, apr } = req.query;
    if (!sanction_id) return error(res, 'sanction_id required', 400);

    const result = await creditService.getKFS(req.user.user_id, {
      sanction_id,
      approved_limit: parseInt(approved_limit),
      apr:            parseFloat(apr),
    });

    // Return PDF as base64 or as binary
    if (req.query.format === 'pdf') {
      const buf = Buffer.from(result.kfs_base64, 'base64');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename=LienPay_KFS.pdf');
      return res.send(buf);
    }

    return success(res, result, 'KFS generated');
  } catch (err) {
    logger.error('getKFS error:', err);
    return serverError(res);
  }
};

// POST /api/credit/kfs/accept
const acceptKFS = async (req, res) => {
  try {
    const { sanction_id, kfs_version } = req.body;
    if (!sanction_id) return error(res, 'sanction_id required', 400);

    const result = await creditService.acceptKFS(
      req.user.user_id, sanction_id, kfs_version || 'v1.0'
    );
    return success(res, result, 'KFS accepted. Cooling-off period started.');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('acceptKFS error:', err);
    return serverError(res);
  }
};

// POST /api/credit/activate
const activateCredit = async (req, res) => {
  try {
    const result = await creditService.activateCreditLine(req.user.user_id);
    return success(res, result, result.message);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('activateCredit error:', err);
    return serverError(res);
  }
};

// POST /api/credit/cancel
const cancelCredit = async (req, res) => {
  try {
    const result = await creditService.cancelDuringCoolingOff(req.user.user_id);
    return success(res, result, result.message);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('cancelCredit error:', err);
    return serverError(res);
  }
};

// GET /api/credit/status
const getCreditStatus = async (req, res) => {
  try {
    const account = await creditService.getCreditStatus(req.user.user_id);
    if (!account) return error(res, 'No credit account found', 404);
    return success(res, account);
  } catch (err) {
    logger.error('getCreditStatus error:', err);
    return serverError(res);
  }
};

// ── ROUTES ────────────────────────────────────────────────────
router.use(authenticate);
router.use(requireKYC);

/**
 * POST /api/credit/sanction
 * Request NBFC sanction using risk decision.
 * Call after risk/evaluate and all pledges confirmed.
 */
router.post('/sanction', requestSanction);

/**
 * GET /api/credit/kfs?sanction_id=X&approved_limit=X&apr=X
 * Generate and return KFS PDF.
 * Add ?format=pdf to get binary PDF response.
 */
router.get('/kfs', getKFS);

/**
 * POST /api/credit/kfs/accept
 * Record user's acceptance of KFS. Starts 3-day cooling-off.
 * Body: { sanction_id, kfs_version }
 */
router.post('/kfs/accept', acceptKFS);

/**
 * POST /api/credit/activate
 * Activate credit line after cooling-off period.
 * Creates UPI VPA and makes credit line live.
 */
router.post('/activate', activateCredit);

/**
 * POST /api/credit/cancel
 * Cancel during cooling-off period (no charges).
 * Only works within 3 days of KFS acceptance.
 */
router.post('/cancel', cancelCredit);

/**
 * GET /api/credit/status
 * Get current credit account status, limit, VPA etc.
 */
router.get('/status', getCreditStatus);

module.exports = router;
