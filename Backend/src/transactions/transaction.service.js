const { v4: uuidv4 } = require('uuid');
const { query }  = require('../../config/database');
const { sendSMS }    = require('../utils/sms.service');
const { logger, audit } = require('../../config/logger');
const { transitionState, isUTRProcessed } = require('./state.machine');
const { generateIdempotencyKey, checkIdempotency, storeIdempotencyResult, checkUTRUniqueness } = require('./idempotency');
const { routePayment, initiateReversal } = require('./upi.router');

// ─────────────────────────────────────────────────────────────
// TRANSACTION SERVICE — WORLD 1 MODEL
// Closed-loop credit line payments via LienPay only.
// NPCI-audit-ready with full state machine, idempotency,
// reconciliation, and immutable audit trail.
// ─────────────────────────────────────────────────────────────

// ── MCC BLOCKLIST ─────────────────────────────────────────────
const BLOCKED_MCC_CODES = new Set([
  '6010', '6011', '7995', '6540', '6051',
  '6050', '9754', '4829', '6012',
]);

const MCC_DESCRIPTIONS = {
  '6010': 'ATM Cash Advance', '6011': 'ATM/Cash',
  '7995': 'Gambling/Betting', '6540': 'Wallet Load',
  '6051': 'Cryptocurrency',   '6050': 'Quasi-Cash',
};

// ── DECODE UPI QR ─────────────────────────────────────────────
const decodeUPIQR = (qrString) => {
  try {
    const url    = new URL(qrString);
    const params = url.searchParams;
    return {
      merchant_vpa:  params.get('pa'),
      merchant_name: params.get('pn') || 'Unknown Merchant',
      amount:        parseFloat(params.get('am')) || null,
      mcc:           params.get('mcc') || null,
      txn_note:      params.get('tn')  || null,
      currency:      params.get('cu')  || 'INR',
      is_valid:      !!params.get('pa'),
    };
  } catch {
    if (qrString?.includes('@')) {
      return { merchant_vpa: qrString.trim(), merchant_name: 'Unknown', amount: null, mcc: null, is_valid: true };
    }
    return { is_valid: false, error: 'Invalid QR code' };
  }
};

// ── VALIDATE TRANSACTION ──────────────────────────────────────
const validateTransaction = async (userId, merchantVPA, amount, mcc) => {
  const accountRes = await query(
    "SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'",
    [userId]
  );

  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No active LienPay credit line found.' };
  }
  const account = accountRes.rows[0];

  if (!account.upi_active) {
    throw { statusCode: 400, message: 'UPI PIN not yet set. Please set your UPI PIN first.' };
  }

  if (mcc && BLOCKED_MCC_CODES.has(mcc)) {
    throw {
      statusCode: 400,
      message:    `${MCC_DESCRIPTIONS[mcc] || mcc} is not allowed on LienPay credit line.`,
      reason:     'BLOCKED_MCC',
    };
  }

  if (!amount || amount <= 0) throw { statusCode: 400, message: 'Invalid amount.' };

  if (amount > parseFloat(account.available_credit)) {
    throw {
      statusCode: 400,
      message:    `Insufficient credit. Available: ₹${Math.round(account.available_credit).toLocaleString('en-IN')}`,
      reason:     'INSUFFICIENT_CREDIT',
    };
  }

  if (amount > 200000) {
    throw { statusCode: 400, message: 'Maximum ₹2,00,000 per transaction.', reason: 'EXCEEDS_TXN_LIMIT' };
  }

  return { account, valid: true };
};

// ── INITIATE TRANSACTION ──────────────────────────────────────
const initiateTransaction = async ({ userId, merchantVPA, merchantName, amount, mcc, qrData }) => {
  // 1. Idempotency check — prevent double-charge on rapid retries
  const idempotencyKey = generateIdempotencyKey(userId, merchantVPA, amount);
  const { isDuplicate, cachedResult } = await checkIdempotency(idempotencyKey);
  if (isDuplicate) {
    logger.warn('Duplicate transaction prevented', { userId, merchantVPA, amount });
    return { ...cachedResult, duplicate_prevented: true };
  }

  // 2. Validate
  const { account } = await validateTransaction(userId, merchantVPA, amount, mcc);

  // 3. Generate unique LSP reference
  const lspTxnRef = `LP_${Date.now()}_${uuidv4().slice(0, 8).toUpperCase()}`;

  // 4. Pre-auth with NBFC
  const preAuthId = await preAuthoriseWithNBFC({
    userId, amount, merchantVPA, mcc, lspTxnRef,
    accountId: account.account_id,
    nbfcAccountId: account.nbfc_account_id,
  });

  // 5. Create transaction record in INITIATED state
  const isInFreePeriod = parseFloat(account.outstanding) === 0;
  const txnRes = await query(`
    INSERT INTO transactions (
      user_id, account_id, lsp_txn_ref, nbfc_pre_auth_id,
      merchant_vpa, merchant_name, mcc, payer_vpa,
      amount, status, billing_cycle_start, is_in_free_period,
      initiated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'INITIATED',$10,$11,NOW())
    RETURNING txn_id
  `, [
    userId, account.account_id, lspTxnRef, preAuthId,
    merchantVPA, merchantName || 'Unknown Merchant', mcc, account.upi_vpa,
    amount, account.current_cycle_start, isInFreePeriod,
  ]);

  const txnId = txnRes.rows[0].txn_id;

  // 6. Transition to PRE_AUTHORISED
  await transitionState(txnId, 'PRE_AUTHORISED', { pre_auth_id: preAuthId });

  // 7. Hold amount on credit line
  await query(`
    UPDATE credit_accounts SET
      available_credit = available_credit - $2,
      updated_at       = NOW()
    WHERE account_id = $1
  `, [account.account_id, amount]);

  const result = {
    txn_id:        txnId,
    lsp_txn_ref:   lspTxnRef,
    pre_auth_id:   preAuthId,
    amount,
    merchant_vpa:  merchantVPA,
    merchant_name: merchantName,
    payer_vpa:     account.upi_vpa,
    status:        'PRE_AUTHORISED',
    free_period:   isInFreePeriod,
    routing_model: 'WORLD1',
    message:       'Pre-authorised. Enter UPI PIN to complete.',
  };

  // 8. Cache for idempotency
  await storeIdempotencyResult(idempotencyKey, result);

  audit('TXN_INITIATED', userId, { txn_id: txnId, amount, merchant_vpa: merchantVPA });

  // Visible in Railway logs
  console.log('\n' + '═'.repeat(60));
  console.log(`💳 PAYMENT INITIATED`);
  console.log(`   Txn ID:    ${txnId}`);
  console.log(`   Amount:    ₹${amount}`);
  console.log(`   Merchant:  ${merchantName} (${merchantVPA})`);
  console.log(`   Payer VPA: ${account.upi_vpa}`);
  console.log(`   Free Period: ${isInFreePeriod ? 'YES — 30 days 0%' : 'NO — interest applies'}`);
  console.log(`   Status:    PRE_AUTHORISED → awaiting PIN`);
  console.log(`   Routing:   WORLD 1 (CLOU)`);
  console.log('═'.repeat(60) + '\n');

  return result;
};

// ── COMPLETE PAYMENT AFTER PIN ────────────────────────────────
// Called after user enters UPI PIN via PSP SDK
const completePaymentAfterPIN = async (txnId, userId, pinVerified) => {
  return await routePayment(txnId, pinVerified);
};

// ── PRE-AUTH WITH NBFC ────────────────────────────────────────
const preAuthoriseWithNBFC = async ({ userId, amount, merchantVPA, mcc, lspTxnRef, accountId, nbfcAccountId }) => {
  const axios = require('axios');
  const mode  = process.env.NBFC_MODE || 'mock';

  if (mode === 'real') {
    const r = await axios.post(
      `${process.env.NBFC_API_URL}/upi/pre-auth`,
      {
        customer_id:     userId,
        nbfc_account_id: nbfcAccountId,
        amount, merchant_vpa: merchantVPA, mcc, lsp_txn_ref: lspTxnRef,
        routing_type:    'WORLD1_CLOSED_LOOP',
        credit_type:     'LAMF_OD',
      },
      {
        headers: {
          Authorization:       `Bearer ${process.env.NBFC_API_KEY}`,
          'X-Idempotency-Key': lspTxnRef,
        },
        timeout: 10000,
      }
    );
    return r.data.pre_auth_id;
  }

  const preAuthId = `PREAUTH_${Date.now()}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  logger.info('💳 [WORLD1 MOCK] Pre-auth created', { pre_auth_id: preAuthId, amount });
  return preAuthId;
};

// ── HANDLE NBFC SETTLEMENT WEBHOOK ───────────────────────────
const handleSettlementWebhook = async (webhookData) => {
  const { lsp_txn_ref, utr, status, amount, timestamp, failure_reason } = webhookData;

  // UTR uniqueness check (NPCI requirement)
  if (utr) {
    const { isUnique, existingTxn } = await checkUTRUniqueness(utr);
    if (!isUnique) {
      logger.warn('Duplicate UTR in webhook — ignoring', { utr, existing_txn: existingTxn?.txn_id });
      return { success: true, message: 'Duplicate UTR — already processed', txn_id: existingTxn?.txn_id };
    }
  }

  const txnRes = await query('SELECT * FROM transactions WHERE lsp_txn_ref = $1', [lsp_txn_ref]);
  if (!txnRes.rows.length) {
    logger.error('Webhook for unknown transaction', { lsp_txn_ref });
    return { success: false, error: 'Transaction not found' };
  }

  const txn = txnRes.rows[0];

  // Idempotency — already settled
  if (txn.status === 'SETTLED' || txn.status === 'FAILED') {
    return { success: true, message: 'Already processed', txn_id: txn.txn_id };
  }

  if (status === 'SUCCESS' || status === 'SETTLED') {
    await transitionState(txn.txn_id, 'SETTLED', {
      utr, timestamp: timestamp || new Date(), drawdown_id: webhookData.drawdown_id,
    });

    await query(`
      UPDATE credit_accounts SET outstanding = outstanding + $2, updated_at = NOW()
      WHERE account_id = $1
    `, [txn.account_id, txn.amount]);

    await sendSMS(txn.user_id, 'TXN_SUCCESS', {
      amount:   `₹${txn.amount.toLocaleString('en-IN')}`,
      merchant: txn.merchant_name || txn.merchant_vpa,
      available: 'Check app', utr: utr || 'N/A',
    }).catch(() => {});

    return { success: true, txn_id: txn.txn_id, status: 'SETTLED', utr };

  } else {
    await transitionState(txn.txn_id, 'FAILED', {
      reason: failure_reason || 'PAYMENT_FAILED',
    });

    await query(`
      UPDATE credit_accounts SET available_credit = available_credit + $2, updated_at = NOW()
      WHERE account_id = $1
    `, [txn.account_id, txn.amount]);

    return { success: true, txn_id: txn.txn_id, status: 'FAILED' };
  }
};

// ── MOCK SETTLE (dev only) ────────────────────────────────────
const mockPaymentSuccess = async (txnId, userId) => {
  const txnRes = await query(
    "SELECT * FROM transactions WHERE txn_id = $1 AND user_id = $2 AND status = 'PRE_AUTHORISED'",
    [txnId, userId]
  );
  if (!txnRes.rows.length) throw { statusCode: 404, message: 'Transaction not found or not in PRE_AUTHORISED state' };
  const txn = txnRes.rows[0];

  // Must follow state machine: PRE_AUTHORISED → PENDING → SETTLED
  await transitionState(txnId, 'PENDING', { timestamp: new Date(), routed_via: 'WORLD1_MOCK' });

  const utr = `UPI${Date.now()}${Math.floor(Math.random() * 100000)}`;

  // Now settle via webhook handler (PENDING → SETTLED is valid)
  await handleSettlementWebhook({ lsp_txn_ref: txn.lsp_txn_ref, utr, status: 'SUCCESS', amount: txn.amount, timestamp: new Date() });

  console.log('\n' + '═'.repeat(60));
  console.log(`✅ PAYMENT SETTLED`);
  console.log(`   Txn ID:    ${txnId}`);
  console.log(`   UTR:       ${utr}`);
  console.log(`   Amount:    ₹${txn.amount}`);
  console.log(`   Merchant:  ${txn.merchant_name} (${txn.merchant_vpa})`);
  console.log(`   Status:    SETTLED`);
  console.log('═'.repeat(60) + '\n');

  return { txn_id: txnId, utr, status: 'SETTLED', routing_model: 'WORLD1' };
};

// ── TRANSACTION HISTORY ───────────────────────────────────────
const getTransactionHistory = async (userId, limit = 20, offset = 0) => {
  const result = await query(`
    SELECT txn_id, merchant_vpa, merchant_name, mcc, amount,
           status, utr, settled_at, initiated_at, is_in_free_period,
           failure_reason
    FROM transactions
    WHERE user_id = $1
    ORDER BY initiated_at DESC
    LIMIT $2 OFFSET $3
  `, [userId, limit, offset]);

  const countRes = await query('SELECT COUNT(*) as total FROM transactions WHERE user_id = $1', [userId]);
  return { transactions: result.rows, total: parseInt(countRes.rows[0].total), limit, offset };
};

module.exports = {
  decodeUPIQR,
  validateTransaction,
  initiateTransaction,
  completePaymentAfterPIN,
  handleSettlementWebhook,
  getTransactionHistory,
  mockPaymentSuccess,
  initiateReversal,
  BLOCKED_MCC_CODES,
};
