const express = require('express');
const router  = express.Router();

const controller = require('./auth.controller');
const { sendOTPValidation, verifyOTPValidation } = require('./auth.validators');
const { authenticate, captureDevice } = require('../middleware/auth.middleware');
const { otpRateLimiter, detectSuspiciousIP } = require('../middleware/velocity.middleware');

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES (no auth required)
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/send-otp
 * Send a 6-digit OTP to the provided mobile number.
 * Rate limited: 3 requests per 15 min per IP+mobile combo.
 *
 * Body: { mobile: "9876543210" }
 *
 * Response: { success: true, data: { message, expires_in, resend_after } }
 */
router.post(
  '/send-otp',
  captureDevice,
  detectSuspiciousIP,
  otpRateLimiter,
  sendOTPValidation,
  controller.sendOTP
);

/**
 * POST /api/auth/verify-otp
 * Verify OTP and get JWT token.
 * Creates user record if first time (new user).
 *
 * Body: { mobile: "9876543210", otp: "421980" }
 *
 * Response: { success: true, data: { token, user: { user_id, mobile, kyc_status, onboarding_step } } }
 */
router.post(
  '/verify-otp',
  captureDevice,
  verifyOTPValidation,
  controller.verifyOTP
);

// ─────────────────────────────────────────────────────────────
// PROTECTED ROUTES (JWT required)
// ─────────────────────────────────────────────────────────────

/**
 * POST /api/auth/logout
 * Invalidate the current JWT session.
 * Headers: Authorization: Bearer <token>
 */
router.post('/logout', authenticate, controller.logout);

/**
 * GET /api/auth/me
 * Get current user's profile.
 * Headers: Authorization: Bearer <token>
 */
router.get('/me', authenticate, controller.getMe);

module.exports = router;
