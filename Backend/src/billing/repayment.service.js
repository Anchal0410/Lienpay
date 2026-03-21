const axios  = require('axios');
const { v4: uuidv4 } = require('uuid');
const { query }  = require('../../config/database');
const { sendSMS }    = require('../utils/sms.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// REPAYMENT SERVICE
//
// Two repayment modes:
// 1. Manual — user initiates repayment via UPI/NEFT
// 2. NACH auto-debit — automatic on due date
//
// Flow:
// User initiates → NBFC processes → webhook confirms →
// outstanding reduced → available credit restored →
// pledge value freed if outstanding = 0
// ─────────────────────────────────────────────────────────────

// ── INITIATE MANUAL REPAYMENT ─────────────────────────────────
const initiateRepayment = async (userId, amount, paymentMode = 'UPI') => {
  // Get active credit account
  const accountRes = await query(
    "SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'",
    [userId]
  );

  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No active credit account found.' };
  }

  const account = accountRes.rows[0];

  // Calculate true outstanding directly from transactions (source of truth)
  const trueOutstandingRes = await query(`
    SELECT 
      COALESCE(SUM(t.amount), 0) as total_settled,
      COALESCE((
        SELECT SUM(r.amount) FROM repayments r 
        WHERE r.account_id = $1 AND r.status = 'SUCCESS'
      ), 0) as total_repaid
    FROM transactions t
    WHERE t.account_id = $1 AND t.status = 'SETTLED'
  `, [account.account_id]);

  const totalSettled = parseFloat(trueOutstandingRes.rows[0].total_settled);
  const totalRepaid  = parseFloat(trueOutstandingRes.rows[0].total_repaid);
  const outstanding  = Math.max(0, totalSettled - totalRepaid);

  // Sync credit account outstanding with true value
  if (Math.abs(outstanding - parseFloat(account.outstanding)) > 1) {
    logger.info('Syncing outstanding from transactions', {
      account_id:          account.account_id,
      db_outstanding:      account.outstanding,
      true_outstanding:    outstanding,
    });
    await query(`
      UPDATE credit_accounts SET
        outstanding      = $2,
        available_credit = credit_limit - $2,
        updated_at       = NOW()
      WHERE account_id = $1
    `, [account.account_id, outstanding]);
  }

  logger.info('Repayment check', { 
    account_id:   account.account_id,
    outstanding, 
    total_settled: totalSettled,
    total_repaid:  totalRepaid,
  });

  if (outstanding <= 0) {
    throw { statusCode: 400, message: 'No outstanding balance to repay.' };
  }

  if (amount <= 0) {
    throw { statusCode: 400, message: 'Repayment amount must be greater than zero.' };
  }

  // Cap at outstanding amount
  const repayAmount = Math.min(amount, outstanding);

  // Get current statement if exists
  const stmtRes = await query(`
    SELECT statement_id FROM statements
    WHERE account_id = $1 AND status IN ('GENERATED', 'OVERDUE')
    ORDER BY billing_period_end DESC LIMIT 1
  `, [account.account_id]);

  const repayRef = `REPAY_${Date.now()}_${uuidv4().slice(0, 8).toUpperCase()}`;

  // Create repayment record
  const repayRes = await query(`
    INSERT INTO repayments (
      account_id, user_id, statement_id,
      amount, payment_method, payment_ref,
      status, initiated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',NOW())
    RETURNING repayment_id
  `, [
    account.account_id, userId,
    stmtRes.rows[0]?.statement_id || null,
    repayAmount, paymentMode, repayRef,
  ]);

  const repaymentId = repayRes.rows[0].repayment_id;

  // Generate payment instructions for user
  const paymentInstructions = getPaymentInstructions(
    paymentMode, repayAmount, repayRef, account
  );

  audit('REPAYMENT_INITIATED', userId, {
    repayment_id: repaymentId,
    amount:       repayAmount,
    mode:         paymentMode,
  });

  return {
    repayment_id:         repaymentId,
    payment_ref:        repayRef,
    amount:               repayAmount,
    payment_method:         paymentMode,
    payment_instructions: paymentInstructions,
    message:              `Repayment of ₹${repayAmount.toLocaleString('en-IN')} initiated.`,
  };
};

// ── CONFIRM REPAYMENT (webhook from payment processor) ────────
const confirmRepayment = async (repaymentRef, utr, amount) => {
  // Find repayment
  const repayRes = await query(
    "SELECT * FROM repayments WHERE payment_ref = $1 AND status = 'PENDING'",
    [repaymentRef]
  );

  if (!repayRes.rows.length) {
    logger.warn('Repayment confirmation for unknown ref', { repaymentRef });
    return { success: false, message: 'Repayment not found' };
  }

  const repayment = repayRes.rows[0];

  // Update repayment status
  await query(`
    UPDATE repayments SET
      status       = 'SUCCESS',
      payment_ref  = $2,
      confirmed_at = NOW()
    WHERE repayment_id = $1
  `, [repayment.repayment_id, utr]);

  // Reduce outstanding on credit account
  await query(`
    UPDATE credit_accounts SET
      outstanding      = GREATEST(0, outstanding - $2),
      available_credit = LEAST(credit_limit, available_credit + $2),
      updated_at       = NOW()
    WHERE account_id = $1
  `, [repayment.account_id, repayment.amount]);

  // Update statement if linked
  if (repayment.statement_id) {
    await query(`
      UPDATE statements SET
        total_repayments = total_repayments + $2,
        status           = CASE
          WHEN total_due - $2 <= 0 THEN 'PAID'
          ELSE status
        END,
        paid_at          = CASE
          WHEN total_due - $2 <= 0 THEN NOW()
          ELSE paid_at
        END,
        updated_at = NOW()
      WHERE statement_id = $1
    `, [repayment.statement_id, repayment.amount]);
  }

  // Send SMS confirmation
  await sendSMS(repayment.user_id, 'REPAYMENT_SUCCESS', {
    amount: `₹${parseFloat(repayment.amount).toLocaleString('en-IN')}`,
    utr,
  }).catch(() => {});

  audit('REPAYMENT_CONFIRMED', repayment.user_id, {
    repayment_id: repayment.repayment_id,
    amount:       repayment.amount,
    utr,
  });

  return {
    success:      true,
    repayment_id: repayment.repayment_id,
    amount:       repayment.amount,
    utr,
    status:       'SUCCESS',
  };
};

// ── MOCK REPAYMENT (dev only) ─────────────────────────────────
const mockRepayment = async (userId, amount) => {
  const result = await initiateRepayment(userId, amount, 'MOCK');
  const utr    = `REPAY_UTR_${Date.now()}`;

  await confirmRepayment(result.payment_ref, utr, amount);

  return {
    repayment_id: result.repayment_id,
    amount,
    utr,
    status: 'SUCCESS',
    message: `Mock repayment of ₹${amount} confirmed`,
  };
};

// ── NACH AUTO-DEBIT SETUP ─────────────────────────────────────
const setupNACHMandate = async (userId, accountNumber, ifsc, bankName) => {
  const accountRes = await query(
    'SELECT * FROM credit_accounts WHERE user_id = $1',
    [userId]
  );

  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No credit account found.' };
  }

  const account = accountRes.rows[0];
  const mode    = process.env.NACH_MODE || 'mock';

  let mandateId;

  if (mode === 'real') {
    const r = await axios.post(
      `${process.env.NACH_API_URL}/mandate/create`,
      {
        customer_id:     userId,
        account_number:  accountNumber,
        ifsc,
        bank_name:       bankName,
        max_amount:      parseFloat(account.credit_limit),
        frequency:       'MONTHLY',
        purpose:         'CREDIT_CARD_PAYMENT',
        start_date:      new Date().toISOString().split('T')[0],
      },
      { headers: { Authorization: `Bearer ${process.env.NACH_API_KEY}` } }
    );
    mandateId = r.data.mandate_id;
  } else {
    mandateId = `NACH_MOCK_${Date.now()}`;
    logger.info('🏦 [NACH MOCK] Mandate created', { mandate_id: mandateId });
  }

  // Store mandate on account
  await query(`
    UPDATE credit_accounts SET
      nach_mandate_id     = $2,
      nach_mandate_status = 'ACTIVE',
      nach_bank_account   = $3,
      nach_ifsc           = $4,
      updated_at          = NOW()
    WHERE account_id = $1
  `, [account.account_id, mandateId, accountNumber, ifsc]);

  audit('NACH_MANDATE_CREATED', userId, { mandate_id: mandateId });

  return {
    mandate_id:    mandateId,
    status:        'ACTIVE',
    max_amount:    account.credit_limit,
    frequency:     'MONTHLY',
    message:       'NACH mandate set up. We will auto-debit minimum due on your due date.',
  };
};

// ── PAYMENT INSTRUCTIONS ──────────────────────────────────────
const getPaymentInstructions = (paymentMode, amount, repayRef, account) => {
  const nbfcVPA = process.env.NBFC_REPAYMENT_VPA || 'lienpay.repay@yesbank';

  switch (paymentMode) {
    case 'UPI':
      return {
        vpa:     nbfcVPA,
        amount,
        note:    repayRef,
        qr_data: `upi://pay?pa=${nbfcVPA}&am=${amount}&tn=${repayRef}&cu=INR`,
      };
    case 'NEFT':
    case 'IMPS':
      return {
        account_number: process.env.NBFC_COLLECTION_ACCOUNT || '1234567890',
        ifsc:           process.env.NBFC_IFSC || 'YESB0000001',
        name:           process.env.NBFC_NAME || 'FinServNBFC Ltd.',
        amount,
        reference:      repayRef,
      };
    default:
      return { amount, reference: repayRef };
  }
};

// ── GET REPAYMENT HISTORY ─────────────────────────────────────
const getRepaymentHistory = async (userId) => {
  const result = await query(`
    SELECT repayment_id, amount, payment_method,
           payment_ref, utr, status,
           initiated_at, confirmed_at
    FROM repayments
    WHERE user_id = $1
    ORDER BY initiated_at DESC
    LIMIT 20
  `, [userId]);

  return result.rows;
};

module.exports = {
  initiateRepayment,
  confirmRepayment,
  mockRepayment,
  setupNACHMandate,
  getRepaymentHistory,
};
