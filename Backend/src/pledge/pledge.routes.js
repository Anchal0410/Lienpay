const express  = require('express');
const router   = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const pledgeService = require('./pledge.service');
const { success, error, validationError, serverError } = require('../utils/response');
const { authenticate, requireKYC } = require('../middleware/auth.middleware');
const { logger } = require('../../config/logger');

// ── CONTROLLERS ───────────────────────────────────────────────

// POST /api/pledge/validate
const validateSelection = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());
  try {
    const { selected_folios } = req.body;
    const result = await pledgeService.validatePledgeSelection(req.user.user_id, selected_folios);
    return success(res, result, 'Pledge selection validated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('validateSelection error:', err);
    return serverError(res);
  }
};

// POST /api/pledge/initiate
const initiatePledge = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());
  try {
    const { selected_folios } = req.body;
    const { validatedFolios } = await pledgeService.validatePledgeSelection(req.user.user_id, selected_folios);
    const result = await pledgeService.initiatePledges(req.user.user_id, validatedFolios);
    return success(res, { pledges: result }, 'Pledge initiated. Check your registered mobile for OTP from CAMS/KFintech.');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('initiatePledge error:', err);
    return serverError(res);
  }
};

// POST /api/pledge/confirm-otp
const confirmOTP = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());
  try {
    const { pledge_id, otp } = req.body;
    const result = await pledgeService.confirmPledgeOTP(req.user.user_id, pledge_id, otp);
    return success(res, result, 'Pledge confirmed successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('confirmOTP error:', err);
    return serverError(res);
  }
};

// POST /api/pledge/notify-nbfc
const notifyNBFC = async (req, res) => {
  try {
    const { pledge_ids } = req.body;
    if (!pledge_ids?.length) return error(res, 'pledge_ids array required', 400);
    const result = await pledgeService.notifyNBFCOfCollateral(req.user.user_id, pledge_ids);
    return success(res, result, 'NBFC notified of collateral');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('notifyNBFC error:', err);
    return serverError(res);
  }
};

// GET /api/pledge/status
const getStatus = async (req, res) => {
  try {
    const pledges = await pledgeService.getPledgeStatus(req.user.user_id);
    return success(res, { pledges });
  } catch (err) {
    logger.error('getStatus error:', err);
    return serverError(res);
  }
};

// ── ROUTES ────────────────────────────────────────────────────
router.use(authenticate);
router.use(requireKYC);

/**
 * POST /api/pledge/validate
 * Validate fund selection before pledging.
 * Body: { selected_folios: [{ folio_number, units_to_pledge? }] }
 */
router.post('/validate',
  [body('selected_folios').isArray({ min: 1 }).withMessage('Select at least one fund')],
  validateSelection
);

/**
 * POST /api/pledge/initiate
 * Initiate pledge with CAMS/KFintech. Sends OTP to unit holder.
 * Mock OTPs: CAMS=123456, KFintech=654321
 * Body: { selected_folios: [{ folio_number, units_to_pledge? }] }
 */
router.post('/initiate',
  [body('selected_folios').isArray({ min: 1 }).withMessage('Select at least one fund')],
  initiatePledge
);

/**
 * POST /api/pledge/confirm-otp
 * Confirm pledge with OTP received from RTA.
 * Body: { pledge_id, otp }
 */
router.post('/confirm-otp',
  [
    body('pledge_id').notEmpty().withMessage('pledge_id required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric(),
  ],
  confirmOTP
);

/**
 * POST /api/pledge/notify-nbfc
 * Notify NBFC of all confirmed pledges (call after all OTPs confirmed).
 * Body: { pledge_ids: [uuid, uuid] }
 */
router.post('/notify-nbfc', notifyNBFC);

/**
 * GET /api/pledge/status
 * Get all pledges for current user.
 */
router.get('/status', getStatus);

module.exports = router;
