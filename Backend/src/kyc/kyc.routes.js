const express    = require('express');
const router     = express.Router();
const controller = require('./kyc.controller');
const { profileValidation, aadhaarOTPValidation, aadhaarVerifyValidation } = require('./kyc.validators');
const { authenticate, captureDevice } = require('../middleware/auth.middleware');

// All KYC routes require authentication
router.use(authenticate);
router.use(captureDevice);

/**
 * POST /api/kyc/consents
 * Log all onboarding consent items.
 * Must be called before any KYC step begins.
 * Body: { consents: [{ type, granted, version }] }
 */
router.post('/consents', controller.logConsents);

/**
 * GET /api/kyc/consents
 * Get current consent status for the user.
 */
router.get('/consents', controller.getConsents);

/**
 * GET /api/kyc/status
 * Get current KYC status and which step to show next.
 */
router.get('/status', controller.getKYCStatus);

/**
 * POST /api/kyc/profile
 * Submit PAN + basic profile. Triggers PAN verify + AML screen.
 * Body: { pan, full_name, date_of_birth, email? }
 */
router.post('/profile', profileValidation, controller.submitProfile);

/**
 * POST /api/kyc/aadhaar/send-otp
 * Initiate Aadhaar OTP KYC. Sends OTP to Aadhaar-linked mobile.
 * Body: { aadhaar_last4, consent_given: "true" }
 */
router.post('/aadhaar/send-otp', aadhaarOTPValidation, controller.sendAadhaarOTP);

/**
 * POST /api/kyc/aadhaar/verify-otp
 * Verify Aadhaar OTP and parse eKYC data.
 * Body: { txn_id, otp }
 * Dev OTP: 421980
 */
router.post('/aadhaar/verify-otp', aadhaarVerifyValidation, controller.verifyAadhaarOTP);

/**
 * POST /api/kyc/ckyc
 * Search/create CKYC registry record.
 * No body required — uses data from previous steps.
 */
router.post('/ckyc', controller.processCKYC);

/**
 * POST /api/kyc/bureau
 * Run bureau check (negative filter only).
 * Body: { consent_given: true }
 */
router.post('/bureau', controller.processBureau);

module.exports = router;
