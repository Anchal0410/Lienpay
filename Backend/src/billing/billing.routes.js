const express  = require('express');
const router   = express.Router();
const statementService = require('./statement.service');
const repaymentService = require('./repayment.service');
const invoiceService   = require('./invoice.service');
const { success, error, serverError } = require('../utils/response');
const { authenticate, requireActiveAccount } = require('../middleware/auth.middleware');
const { logger } = require('../../config/logger');

// ── CONTROLLERS ───────────────────────────────────────────────

// GET /api/billing/statements
const getStatements = async (req, res) => {
  try {
    const statements = await statementService.getStatements(req.user.user_id);
    return success(res, { statements });
  } catch (err) { return serverError(res); }
};

// GET /api/billing/statements/:id
const getStatement = async (req, res) => {
  try {
    const stmt = await statementService.getStatement(req.user.user_id, req.params.id);
    if (!stmt) return error(res, 'Statement not found', 404);
    return success(res, stmt);
  } catch (err) { return serverError(res); }
};

// POST /api/billing/statements/generate (dev/ops only)
const generateStatement = async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !req.headers['x-internal-key']) {
    return error(res, 'Forbidden', 403);
  }
  try {
    const accountRes = await require('../../config/database').query(
      "SELECT account_id FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'",
      [req.user.user_id]
    );
    if (!accountRes.rows.length) return error(res, 'No active account', 404);
    const stmt = await statementService.generateStatement(accountRes.rows[0].account_id);
    return success(res, stmt, 'Statement generated');
  } catch (err) {
    logger.error('generateStatement error:', err);
    return serverError(res);
  }
};

// POST /api/billing/repay
const initiateRepay = async (req, res) => {
  try {
    const { amount, payment_mode } = req.body;
    if (!amount || amount <= 0) return error(res, 'Valid amount required', 400);
    const result = await repaymentService.initiateRepayment(
      req.user.user_id, parseFloat(amount), payment_mode || 'UPI'
    );
    return success(res, result, result.message);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

// POST /api/billing/repay/mock (dev only)
const mockRepay = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount) return error(res, 'Amount required', 400);
    const result = await repaymentService.mockRepayment(req.user.user_id, parseFloat(amount));
    return success(res, result, result.message);
  } catch (err) {
    logger.error('mockRepay error details:', { 
      message: err.message, 
      statusCode: err.statusCode,
      stack: err.stack 
    });
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

// POST /api/billing/repay/initiate — generates UPI payment link for repayment
const initiateRepayment = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return error(res, 'Valid amount required', 400);

    const accountRes = await require('../../config/database').query(
      'SELECT * FROM credit_accounts WHERE user_id = $1 AND status = $2',
      [req.user.user_id, 'ACTIVE']
    );
    if (!accountRes.rows.length) return error(res, 'No active credit account', 404);

    const account = accountRes.rows[0];
    const repayAmount = Math.min(parseFloat(amount), parseFloat(account.outstanding));

    if (repayAmount <= 0) return error(res, 'No outstanding balance to repay', 400);

    // Generate UPI payment link
    const repaymentId = `REPAY_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const upiId = process.env.REPAYMENT_UPI_ID || 'lienpay-repay@icici';
    const upiLink = `upi://pay?pa=${upiId}&pn=LienPay%20Repayment&am=${repayAmount.toFixed(2)}&tn=CreditLine%20Repayment%20${repaymentId}&cu=INR`;

    return success(res, {
      repayment_id: repaymentId,
      amount: repayAmount,
      upi_id: upiId,
      upi_link: upiLink,
      outstanding_before: parseFloat(account.outstanding),
      outstanding_after: parseFloat(account.outstanding) - repayAmount,
    }, 'Repayment initiated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

// POST /api/billing/repay/webhook (called by payment processor)
const repayWebhook = async (req, res) => {
  try {
    const { repayment_ref, utr, amount } = req.body;
    const result = await repaymentService.confirmRepayment(repayment_ref, utr, parseFloat(amount));
    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error('repayWebhook error:', err);
    return res.status(500).json({ success: false });
  }
};

// GET /api/billing/repayments
const getRepayments = async (req, res) => {
  try {
    const repayments = await repaymentService.getRepaymentHistory(req.user.user_id);
    return success(res, { repayments });
  } catch (err) { return serverError(res); }
};

// POST /api/billing/nach/setup
const setupNACH = async (req, res) => {
  try {
    const { account_number, ifsc, bank_name } = req.body;
    if (!account_number || !ifsc) return error(res, 'account_number and ifsc required', 400);
    const result = await repaymentService.setupNACHMandate(
      req.user.user_id, account_number, ifsc, bank_name
    );
    return success(res, result, result.message);
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    return serverError(res);
  }
};

// GET /api/billing/invoice (internal ops)
const getInvoices = async (req, res) => {
  try {
    const invoices = await invoiceService.getInvoiceHistory();
    return success(res, { invoices });
  } catch (err) { return serverError(res); }
};

// ── ROUTES ────────────────────────────────────────────────────
router.use(authenticate);

// Statements
router.get('/statements',             getStatements);
router.get('/statements/:id',         getStatement);
router.post('/statements/generate',   generateStatement);

// Repayments
router.post('/repay',                 requireActiveAccount, initiateRepay);
router.post('/repay/initiate',        requireActiveAccount, initiateRepayment);
router.post('/repay/mock',            requireActiveAccount, mockRepay);
router.post('/repay/webhook',         repayWebhook);
router.get('/repayments',             getRepayments);

// NACH
router.post('/nach/setup',            requireActiveAccount, setupNACH);

// Invoices (ops)
router.get('/invoices',               getInvoices);

module.exports = router;
