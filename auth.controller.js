const { validationResult } = require('express-validator');
const authService = require('./auth.service');
const { success, error, validationError, serverError } = require('../utils/response');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// POST /api/auth/send-otp
// Body: { mobile }
// ─────────────────────────────────────────────────────────────
const sendOTP = async (req, res) => {
  // Validate request
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validationError(res, errors.array());
  }

  try {
    const { mobile } = req.body;
    const ipAddress  = req.ip || req.connection.remoteAddress;
    const deviceId   = req.headers['x-device-id'] || null;

    const result = await authService.sendOTP({ mobile, ipAddress, deviceId });
    return success(res, result, 'OTP sent successfully');

  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    logger.error('sendOTP controller error:', err);
    return serverError(res, 'Failed to send OTP');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/auth/verify-otp
// Body: { mobile, otp }
// Returns: JWT token + user object
// ─────────────────────────────────────────────────────────────
const verifyOTP = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return validationError(res, errors.array());
  }

  try {
    const { mobile, otp } = req.body;
    const ipAddress  = req.ip || req.connection.remoteAddress;
    const deviceId   = req.headers['x-device-id'] || null;
    const userAgent  = req.headers['user-agent'] || null;

    const result = await authService.verifyOTP({
      mobile, otp, ipAddress, deviceId, userAgent,
    });

    return success(res, result, 'OTP verified successfully');

  } catch (err) {
    if (err.statusCode) {
      return error(res, err.message, err.statusCode);
    }
    logger.error('verifyOTP controller error:', err);
    return serverError(res, 'OTP verification failed');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/auth/logout
// Headers: Authorization: Bearer <token>
// ─────────────────────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    // req.user and req.session are set by the auth middleware
    const result = await authService.logout(
      req.user.user_id,
      req.session.jti,
      req.session.expires_at,
    );
    return success(res, result, 'Logged out successfully');
  } catch (err) {
    logger.error('logout controller error:', err);
    return serverError(res, 'Logout failed');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/auth/me
// Headers: Authorization: Bearer <token>
// Returns: current user profile
// ─────────────────────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await authService.getUserById(req.user.user_id);
    if (!user) return error(res, 'User not found', 404);

    // Return safe fields only — no encrypted PAN, no sensitive data
    return success(res, {
      user_id:         user.user_id,
      mobile:          `+91 XXXXX${user.mobile.slice(-5)}`,
      full_name:       user.full_name,
      pan_last4:       user.pan_last4,
      email:           user.email,
      kyc_status:      user.kyc_status,
      account_status:  user.account_status,
      onboarding_step: user.onboarding_step,
      ckyc_id:         user.ckyc_id,
      created_at:      user.created_at,
    });
  } catch (err) {
    logger.error('getMe controller error:', err);
    return serverError(res);
  }
};

module.exports = { sendOTP, verifyOTP, logout, getMe };
