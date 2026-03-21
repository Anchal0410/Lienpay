const axios  = require('axios');
const { query }  = require('../../config/database');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// PSP SDK INTEGRATION
// World 1 model: UPI PIN is set and verified through
// the PSP bank's certified SDK, loaded inside LienPay app.
//
// This is the ecosystem lock mechanism:
// - PIN is device-bound through PSP SDK
// - PIN is bound to LienPay's app instance
// - Resetting requires going back through LienPay
// - GPay/PhonePe cannot use this PIN
//
// NPCI mandates: PIN must be set via PSP-certified SDK.
// We comply by loading the PSP bank's SDK inside our app.
// ─────────────────────────────────────────────────────────────

// ── INITIATE PIN SETUP ────────────────────────────────────────
// Called after credit line activation
// Returns: SDK session token for frontend to load PSP SDK
const initiatePINSetup = async (userId) => {
  const accountRes = await query(
    "SELECT upi_vpa, nbfc_account_id, psp_bank FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'",
    [userId]
  );

  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No active credit line found.' };
  }

  const account = accountRes.rows[0];
  const mode    = process.env.UPI_MODE || 'mock';

  if (mode === 'real') {
    // PSP bank issues a short-lived session token
    // Frontend loads PSP SDK with this token
    // PIN entry happens inside SDK — LienPay never sees the PIN
    const r = await axios.post(
      `${process.env.PSP_API_URL}/sdk/session/create`,
      {
        vpa:         account.upi_vpa,
        account_id:  account.nbfc_account_id,
        purpose:     'PIN_SET',
        mobile:      await getUserMobile(userId),
      },
      {
        headers: { Authorization: `Bearer ${process.env.PSP_API_KEY}` },
        timeout: 10000,
      }
    );

    return {
      sdk_session_token: r.data.session_token,
      sdk_url:           process.env.PSP_SDK_URL,
      vpa:               account.upi_vpa,
      expires_in:        300, // 5 min
    };
  }

  // Mock response
  const mockToken = `SDK_SESSION_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  logger.info('💳 [PSP SDK MOCK] PIN setup session created', {
    vpa:   account.upi_vpa,
    token: mockToken,
  });

  // In mock mode, PIN setup is auto-confirmed
  await confirmPINSetup(userId, mockToken, true);

  return {
    sdk_session_token: mockToken,
    sdk_url:           'mock://psp-sdk',
    vpa:               account.upi_vpa,
    expires_in:        300,
    mock_auto_confirmed: true,
    message:           'In dev mode, PIN is auto-set. In production, user sets PIN via PSP SDK.',
  };
};

// ── CONFIRM PIN SETUP ─────────────────────────────────────────
// Called by PSP SDK callback after PIN is set
const confirmPINSetup = async (userId, sessionToken, success) => {
  if (!success) {
    throw { statusCode: 400, message: 'PIN setup failed or cancelled.' };
  }

  // Mark PIN as set on credit account
  await query(`
    UPDATE credit_accounts SET
      upi_active  = true,
      updated_at  = NOW()
    WHERE user_id = $1
  `, [userId]);

  // Update user's onboarding step
  await query(`
    UPDATE users SET
      onboarding_step = 'COMPLETE',
      updated_at      = NOW()
    WHERE user_id = $1
  `, [userId]);

  audit('UPI_PIN_SET', userId, {
    method: 'PSP_SDK',
    ecosystem_lock: true,
    note: 'PIN bound to LienPay app instance via PSP SDK',
  });

  return { pin_set: true, upi_ready: true };
};

// ── VERIFY PIN FOR PAYMENT ────────────────────────────────────
// In World 1, PIN verification happens inside PSP SDK
// Frontend calls PSP SDK → SDK returns verified=true/false
// Backend receives the SDK callback
const verifyPINForPayment = async (userId, txnId, sdkCallbackToken) => {
  const mode = process.env.UPI_MODE || 'mock';

  if (mode === 'real') {
    // Verify the SDK callback token with PSP bank
    const r = await axios.post(
      `${process.env.PSP_API_URL}/sdk/pin/verify`,
      { session_token: sdkCallbackToken, txn_id: txnId },
      { headers: { Authorization: `Bearer ${process.env.PSP_API_KEY}` }, timeout: 10000 }
    );
    return { verified: r.data.verified, reason: r.data.reason };
  }

  // Mock: always verified in dev
  logger.info('💳 [PSP SDK MOCK] PIN verified for payment', { txn_id: txnId });
  return { verified: true };
};

// ── CHANGE PIN ────────────────────────────────────────────────
// Returns new SDK session for PIN change
// Can ONLY be done inside LienPay (ecosystem lock)
const initiatePINChange = async (userId) => {
  const mode = process.env.UPI_MODE || 'mock';

  if (mode === 'real') {
    const account = await query(
      'SELECT upi_vpa FROM credit_accounts WHERE user_id = $1',
      [userId]
    );

    const r = await axios.post(
      `${process.env.PSP_API_URL}/sdk/session/create`,
      {
        vpa:     account.rows[0]?.upi_vpa,
        purpose: 'PIN_CHANGE',
        mobile:  await getUserMobile(userId),
      },
      { headers: { Authorization: `Bearer ${process.env.PSP_API_KEY}` } }
    );

    return { sdk_session_token: r.data.session_token, sdk_url: process.env.PSP_SDK_URL };
  }

  return { sdk_session_token: `SDK_CHANGE_${Date.now()}`, sdk_url: 'mock://psp-sdk', mock: true };
};

// ── HELPER ────────────────────────────────────────────────────
const getUserMobile = async (userId) => {
  const res = await query('SELECT mobile FROM users WHERE user_id = $1', [userId]);
  return res.rows[0]?.mobile;
};

module.exports = {
  initiatePINSetup,
  confirmPINSetup,
  verifyPINForPayment,
  initiatePINChange,
};
