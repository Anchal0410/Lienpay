const express  = require('express');
const router   = express.Router();
const { body } = require('express-validator');
const { validationResult } = require('express-validator');
const txnService    = require('./transaction.service');
const pspSDK        = require('./psp.sdk.service');
const { runDailyReconciliation, reconcileCreditBalances, resolveStuckTransactions } = require('./reconciliation/reconciliation.engine');
const { success, error, validationError, serverError } = require('../utils/response');
const { authenticate, requireActiveAccount } = require('../middleware/auth.middleware');
const { logger } = require('../../config/logger');

// ── CONTROLLERS ───────────────────────────────────────────────

const decodeQR = async (req, res) => {
  try {
    const { qr_string } = req.body;
    if (!qr_string) return error(res, 'qr_string required', 400);
    const result = txnService.decodeUPIQR(qr_string);
    if (!result.is_valid) return error(res, 'Invalid QR code', 400);
    return success(res, result);
  } catch (err) { return serverError(res); }
};

const validateTxn = async (req, res) => {
  try {
    const { merchant_vpa, amount, mcc } = req.body;
    if (!merchant_vpa || !amount) return error(res, 'merchant_vpa and amount required', 400);
    await txnService.validateTransaction(req.user.user_id, merchant_vpa, parseFloat(amount), mcc);
    return success(res, { valid: true, routing_model: 'WORLD1' });
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode, { reason: err.reason });
    return serverError(res);
  }
};

const initiateTxn = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());
  try {
    const { merchant_vpa, merchant_name, amount, mcc, qr_string } = req.body;
    const result = await txnService.initiateTransaction({
      userId: req.user.user_id, merchantVPA: merchant_vpa,
      merchantName: merchant_name, amount: parseFloat(amount), mcc, qrData: qr_string,
    });
    return success(res, result, result.message);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode, { reason: err.reason });
    logger.error('initiateTxn error:', err);
    return serverError(res);
  }
};

// Called after user enters PIN via PSP SDK
const completePINVerification = async (req, res) => {
  try {
    const { txn_id, pin_verified, sdk_callback_token } = req.body;
    if (!txn_id) return error(res, 'txn_id required', 400);

    // Verify PIN with PSP SDK
    const { verified } = await pspSDK.verifyPINForPayment(
      req.user.user_id, txn_id, sdk_callback_token
    );

    // Route payment
    const result = await txnService.completePaymentAfterPIN(txn_id, req.user.user_id, verified);
    return success(res, result, result.success ? 'Payment completed' : 'Payment failed');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('completePINVerification error:', err);
    return serverError(res);
  }
};

// PSP SDK: initiate PIN setup
const initPINSetup = async (req, res) => {
  try {
    const result = await pspSDK.initiatePINSetup(req.user.user_id);
    return success(res, result, 'PIN setup session created');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

// PSP SDK: confirm PIN set callback
const confirmPINSetup = async (req, res) => {
  try {
    const { session_token, success: pinSuccess } = req.body;
    const result = await pspSDK.confirmPINSetup(req.user.user_id, session_token, pinSuccess !== false);
    return success(res, result, 'UPI PIN set successfully. Credit line ready to use.');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

// PSP SDK: initiate PIN change
const initPINChange = async (req, res) => {
  try {
    const result = await pspSDK.initiatePINChange(req.user.user_id);
    return success(res, result);
  } catch (err) { return serverError(res); }
};

const nbfcWebhook = async (req, res) => {
  try {
    const result = await txnService.handleSettlementWebhook(req.body);
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('nbfcWebhook error:', err);
    return res.status(500).json({ success: false });
  }
};

const mockSettle = async (req, res) => {
  if (process.env.NODE_ENV === 'production') return error(res, 'Not available in production', 403);
  try {
    const { txn_id } = req.body;
    if (!txn_id) return error(res, 'txn_id required', 400);
    const result = await txnService.mockPaymentSuccess(txn_id, req.user.user_id);
    return success(res, result, 'Mock payment settled (World 1 routing simulated)');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

const getTxnHistory = async (req, res) => {
  try {
    const result = await txnService.getTransactionHistory(
      req.user.user_id,
      parseInt(req.query.limit) || 20,
      parseInt(req.query.offset) || 0
    );
    return success(res, result);
  } catch (err) { return serverError(res); }
};

const initiateReversal = async (req, res) => {
  try {
    const { txn_id, reason } = req.body;
    if (!txn_id) return error(res, 'txn_id required', 400);
    const result = await txnService.initiateReversal(txn_id, req.user.user_id, reason || 'CUSTOMER_REQUEST');
    return success(res, result, 'Reversal initiated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

// Reconciliation (internal ops endpoint)
const runReconciliation = async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !req.headers['x-internal-key']) {
    return error(res, 'Forbidden', 403);
  }
  try {
    const [recon, balances, stuck] = await Promise.all([
      runDailyReconciliation(),
      reconcileCreditBalances(),
      resolveStuckTransactions(),
    ]);
    return success(res, { reconciliation: recon, balances, stuck_resolved: stuck });
  } catch (err) { return serverError(res); }
};

// ── ROUTES ────────────────────────────────────────────────────
router.use(authenticate);

// QR + Validation (no active account required — for pre-check)
router.post('/decode-qr', decodeQR);
router.post('/validate', validateTxn);

// PIN Setup (after credit activation)
router.post('/pin/setup', initPINSetup);
router.post('/pin/setup/confirm', confirmPINSetup);
router.post('/pin/change', initPINChange);

// Transaction flow
router.post('/initiate',       requireActiveAccount, [
  body('merchant_vpa').notEmpty().withMessage('merchant_vpa required'),
  body('amount').isFloat({ min: 1 }).withMessage('amount must be positive'),
], initiateTxn);

router.post('/complete-pin',   requireActiveAccount, completePINVerification);
router.post('/reverse',        requireActiveAccount, initiateReversal);
router.get('/history',         getTxnHistory);

// Webhooks (called by NBFC — no user auth)
router.post('/webhook/nbfc', nbfcWebhook);

// Dev only
router.post('/mock-settle', mockSettle);

// Internal ops
router.post('/internal/reconcile', runReconciliation);

module.exports = router;
