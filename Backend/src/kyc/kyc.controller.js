const { validationResult } = require('express-validator');
const kycService = require('./kyc.service');
const { logMultipleConsents, getUserConsents } = require('./consent.service');
const { success, error, validationError, serverError } = require('../utils/response');
const { hash } = require('../utils/encryption');
const { logger } = require('../../config/logger');

// POST /api/kyc/consents — log all onboarding consents
const logConsents = async (req, res) => {
  try {
    const { consents } = req.body;
    if (!consents || !Array.isArray(consents)) {
      return error(res, 'consents array is required', 400);
    }

    const ipHash   = hash(req.ip);
    const deviceId = req.headers['x-device-id'];

    const results = await logMultipleConsents(
      req.user.user_id, consents, ipHash, deviceId
    );

    return success(res, { consents_logged: results.length }, 'Consents recorded successfully');
  } catch (err) {
    logger.error('logConsents error:', err);
    return serverError(res);
  }
};

// GET /api/kyc/consents — get user's consent status
const getConsents = async (req, res) => {
  try {
    const consents = await getUserConsents(req.user.user_id);
    return success(res, { consents });
  } catch (err) {
    return serverError(res);
  }
};

// POST /api/kyc/profile — submit PAN + basic profile
const submitProfile = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());

  try {
    const { pan, full_name, date_of_birth, email } = req.body;
    const result = await kycService.submitProfile({
      userId:   req.user.user_id,
      pan:      pan.toUpperCase(),
      fullName: full_name,
      dob:      date_of_birth,
      email,
      ipHash:   hash(req.ip),
      deviceId: req.headers['x-device-id'],
    });

    return success(res, result, 'Profile submitted and PAN verified');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('submitProfile error:', err);
    return serverError(res);
  }
};

// POST /api/kyc/aadhaar/send-otp — initiate Aadhaar KYC
const sendAadhaarOTP = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());

  try {
    const { aadhaar_last4, consent_given } = req.body;
    if (!consent_given) {
      return error(res, 'Aadhaar KYC consent is required before proceeding.', 400);
    }

    const result = await kycService.initiateAadhaarKYC({
      userId:       req.user.user_id,
      aadhaarLast4: aadhaar_last4,
      ipHash:       hash(req.ip),
    });

    return success(res, result, 'Aadhaar OTP sent to your registered mobile number');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('sendAadhaarOTP error:', err);
    return serverError(res);
  }
};

// POST /api/kyc/aadhaar/verify-otp — verify Aadhaar OTP
const verifyAadhaarOTP = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());

  try {
    const { txn_id, otp } = req.body;
    const result = await kycService.verifyAadhaarKYC({
      userId: req.user.user_id,
      txnId:  txn_id,
      otp,
      ipHash: hash(req.ip),
    });

    return success(res, result, 'Aadhaar OTP verified successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('verifyAadhaarOTP error:', err);
    return serverError(res);
  }
};

// POST /api/kyc/ckyc — process CKYC registry
const processCKYC = async (req, res) => {
  try {
    const result = await kycService.processCKYC({ userId: req.user.user_id });
    return success(res, result, 'CKYC record processed successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('processCKYC error:', err);
    return serverError(res);
  }
};

// POST /api/kyc/bureau — run bureau check
const processBureau = async (req, res) => {
  try {
    const { consent_given } = req.body;
    if (!consent_given) {
      return error(res, 'Bureau check consent is required.', 400);
    }

    const result = await kycService.processBureau({
      userId:  req.user.user_id,
      ipHash:  hash(req.ip),
    });

    return success(res, result, result.message);
  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode, { rejection_reason: err.rejection_reason });
    }
    logger.error('processBureau error:', err);
    return serverError(res);
  }
};

// GET /api/kyc/status — get current KYC status
const getKYCStatus = async (req, res) => {
  try {
    const { query } = require('../../config/database');
    const result = await query(`
      SELECT
        u.kyc_status, u.kyc_type, u.kyc_completed_at,
        u.ckyc_id, u.onboarding_step,
        k.status as kyc_step, k.name_match_score,
        k.aadhaar_last4
      FROM users u
      LEFT JOIN kyc_records k ON k.user_id = u.user_id
      WHERE u.user_id = $1
    `, [req.user.user_id]);

    if (!result.rows.length) return error(res, 'User not found', 404);

    const data = result.rows[0];
    return success(res, {
      kyc_status:      data.kyc_status,
      kyc_type:        data.kyc_type,
      kyc_completed_at: data.kyc_completed_at,
      ckyc_id:         data.ckyc_id,
      onboarding_step: data.onboarding_step,
      aadhaar_last4:   data.aadhaar_last4,
    });
  } catch (err) {
    logger.error('getKYCStatus error:', err);
    return serverError(res);
  }
};

module.exports = {
  logConsents, getConsents,
  submitProfile,
  sendAadhaarOTP, verifyAadhaarOTP,
  processCKYC,
  processBureau,
  getKYCStatus,
};
