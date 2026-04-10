const { query }    = require('../../config/database');
const { encrypt, hash } = require('../utils/encryption');
const { verifyPAN, calculateNameMatchScore } = require('./pan.service');
const { screenAML } = require('./bureau.service');
const { logConsent, CONSENT_TYPES, CONSENT_ACTIONS } = require('./consent.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// KYC ORCHESTRATION SERVICE  (LienPay LSP Role)
//
// RBI Digital Lending Directions + SEBI LAMF Framework:
//
//  WHAT LIENPAY DOES (LSP):
//    Step 1: Collect name, PAN, mobile from user — store it
//    Step 2: Verify PAN format + run AML screen
//    Step 3: Pass data to NBFC for Aadhaar OTP, CKYC, bureau
//    Step 4: NBFC performs Aadhaar OTP (via their own UIDAI credentials)
//    Step 5: NBFC performs CKYC (via their CERSAI membership)
//    Step 6: Bureau NOT required — LAMF is collateral-backed lending
//
//  WHAT LIENPAY DOES NOT DO:
//    ❌ Aadhaar OTP independently (NBFC's obligation and credential)
//    ❌ CKYC independently (NBFC's membership)
//    ❌ Bureau pull (not needed for collateral-backed loan)
//    ❌ Make credit decisions (NBFC does this)
//
//  FLOW IN PRACTICE (mock mode = everything runs through LienPay for testing):
//    In mock: LienPay calls mock Aadhaar + CKYC APIs directly
//    In real: LienPay UI collects data, NBFC's system calls UIDAI/CERSAI
//    The `/api/kyc/aadhaar` and `/api/kyc/ckyc` endpoints remain
//    but are gated by NBFC in production (NBFC_MODE=real)
//
//  BUREAU NOTE:
//    For LAMF specifically, bureau check is NOT required because:
//    - The loan is 100% collateral-backed by pledged MF units
//    - If the user defaults, the NBFC invokes the pledge to recover
//    - Bureau is used for unsecured lending risk assessment
//    - The /api/kyc/bureau endpoint is kept for legacy compatibility
//    but simply marks KYC complete without rejecting on score
// ─────────────────────────────────────────────────────────────

// ── STEP 1+2: Collect profile + verify PAN + AML ──────────────
// LienPay collects: name, PAN, mobile, DOB
// Verifies PAN format + AML (sanctions/PEP screening)
// Sends data package to NBFC after this step
const submitProfile = async ({ userId, pan, fullName, dob, email, ipHash, deviceId }) => {

  // 1. Duplicate PAN check
  const existing = await query(
    'SELECT user_id FROM users WHERE pan_last4 = $1 AND user_id != $2 AND account_status != \'REJECTED\'',
    [pan.slice(-4), userId]
  );
  if (existing.rows.length > 0) {
    throw { statusCode: 409, message: 'This PAN is already registered with another account.' };
  }

  // 2. PAN format validation + mock verification
  const panResult = await verifyPAN(pan, fullName, dob, userId);
  if (panResult.status !== 'ACTIVE') {
    throw { statusCode: 400, message: `PAN is ${panResult.status}. Please use an active PAN.` };
  }
  if (!panResult.name_match) {
    throw {
      statusCode: 400,
      message: `Name does not match PAN records (match: ${panResult.match_score}%). Please check your name.`,
    };
  }

  // 3. AML screening — run by LienPay using ComplyAdvantage/IDfy
  // (AML is LienPay's LSP obligation — we must screen our own users)
  const amlResult = await screenAML(pan, fullName, dob, userId);
  if (amlResult.result === 'FAIL') {
    audit('KYC_AML_REJECTED', userId, { pan_last4: pan.slice(-4) });
    throw { statusCode: 400, message: 'We are unable to proceed with your application at this time.' };
  }

  // 4. Save AML result
  await query(`
    INSERT INTO aml_checks
      (user_id, check_type, risk_score, pep_flag, sanctions_flag, adverse_media_flag, flags, result, provider_ref)
    VALUES ($1, 'ONBOARDING', $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT DO NOTHING
  `, [
    userId, amlResult.risk_score, amlResult.pep_flag,
    amlResult.sanctions_flag, amlResult.adverse_media_flag,
    JSON.stringify(amlResult.flags), amlResult.result, amlResult.provider_ref,
  ]).catch(() => {});

  // 5. Store user profile (name, PAN encrypted, DOB)
  const panEncrypted = encrypt(pan);
  await query(`
    UPDATE users SET
      full_name       = $2,
      pan_last4       = $3,
      pan_encrypted   = $4,
      pan_verified    = true,
      pan_status      = $5,
      date_of_birth   = $6,
      email           = $7,
      onboarding_step = 'KYC_AADHAAR',
      updated_at      = NOW()
    WHERE user_id = $1
  `, [userId, fullName, pan.slice(-4), panEncrypted, panResult.status, dob, email || null]);

  // 6. Package the data for NBFC handover
  // In production: this data is sent to NBFC for them to do Aadhaar/CKYC
  const nbfcHandoverData = {
    full_name: fullName,
    pan_last4: pan.slice(-4),
    date_of_birth: dob,
    mobile: null, // fetched from users table by NBFC
    aml_cleared: true,
    timestamp: new Date().toISOString(),
  };

  // In production (NBFC_MODE=real), fire webhook to NBFC with user data
  if (process.env.NBFC_MODE === 'real' && process.env.NBFC_KYC_WEBHOOK_URL) {
    try {
      await fetch(process.env.NBFC_KYC_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LienPay-Event': 'kyc.profile_submitted',
          'X-Api-Key': process.env.NBFC_API_KEY || '',
        },
        body: JSON.stringify({ user_id: userId, ...nbfcHandoverData }),
      });
    } catch (_) {
      // Non-blocking — don't fail the user flow if webhook fails
      logger.warn('NBFC KYC webhook failed (non-blocking)');
    }
  }

  return {
    pan_verified: true,
    pan_status:   panResult.status,
    name_match:   panResult.name_match,
    match_score:  panResult.match_score,
    aml_result:   amlResult.result,
    next_step:    'AADHAAR_KYC',
    note:         'Data forwarded to NBFC partner for Aadhaar and CKYC verification.',
  };
};

// ── STEP 3: Aadhaar OTP send ──────────────────────────────────
// Facilitated by LienPay's UI, but in production this goes through NBFC
// Mock mode: LienPay calls Aadhaar API directly for testing
const initiateAadhaarKYC = async ({ userId, aadhaarLast4, ipHash }) => {
  // Consent MUST be logged before any Aadhaar API call (UIDAI requirement)
  await logConsent({
    userId,
    consentType: CONSENT_TYPES.AADHAAR_KYC,
    action:      CONSENT_ACTIONS.GRANTED,
    ipHash,
    metadata:    { aadhaar_last4: aadhaarLast4 },
  });

  // In production: NBFC performs this step using their own UIDAI credentials
  // In mock: LienPay calls mock Aadhaar service for testing
  const nbfcMode = process.env.NBFC_MODE || 'mock';

  let txnId, devOtp;

  if (nbfcMode === 'real') {
    // Production: route through NBFC's Aadhaar OTP API
    // LienPay passes the request to NBFC; NBFC calls UIDAI
    const nbfcRes = await fetch(`${process.env.NBFC_API_URL}/kyc/aadhaar/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.NBFC_API_KEY}`,
      },
      body: JSON.stringify({ user_id: userId, aadhaar_last4: aadhaarLast4 }),
    });
    const nbfcData = await nbfcRes.json();
    txnId = nbfcData.txn_id;
  } else {
    // Mock mode for development testing
    const { sendAadhaarOTP: mockOTP } = require('./aadhaar.service');
    const result = await mockOTP(aadhaarLast4, userId);
    txnId  = result.txn_id;
    devOtp = result.dev_otp;
  }

  await query(`
    INSERT INTO kyc_records (user_id, aadhaar_last4, kyc_method, status)
    VALUES ($1, $2, 'AADHAAR_OTP', 'AADHAAR_OTP_PENDING')
    ON CONFLICT (user_id) DO UPDATE SET
      aadhaar_last4 = $2, kyc_method = 'AADHAAR_OTP',
      status = 'AADHAAR_OTP_PENDING', updated_at = NOW()
  `, [userId, aadhaarLast4]);

  return { txn_id: txnId, ...(devOtp ? { dev_otp: devOtp } : {}), message: 'OTP sent to Aadhaar-linked mobile.' };
};

// ── STEP 4: Aadhaar OTP verify ────────────────────────────────
const verifyAadhaarKYC = async ({ userId, txnId, otp, ipHash }) => {
  const nbfcMode = process.env.NBFC_MODE || 'mock';
  let kycData;

  if (nbfcMode === 'real') {
    const nbfcRes = await fetch(`${process.env.NBFC_API_URL}/kyc/aadhaar/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.NBFC_API_KEY}` },
      body: JSON.stringify({ user_id: userId, txn_id: txnId, otp }),
    });
    const nbfcData = await nbfcRes.json();
    if (!nbfcData.success) throw { statusCode: 400, message: 'Aadhaar OTP verification failed.' };
    kycData = nbfcData.kyc_data;
  } else {
    const { verifyAadhaarOTP: mockVerify } = require('./aadhaar.service');
    const result = await mockVerify(txnId, otp, userId);
    if (!result.success) throw { statusCode: 400, message: 'Aadhaar OTP verification failed.' };
    kycData = result.kyc_data;
  }

  const user = await query('SELECT full_name FROM users WHERE user_id = $1', [userId]);
  const panName = user.rows[0]?.full_name || '';
  const matchScore = calculateNameMatchScore(panName, kycData.name || '');

  await query(`
    UPDATE kyc_records SET
      aadhaar_txn_ref = $2, name_from_aadhaar = $3, dob_from_aadhaar = $4,
      gender_from_aadhaar = $5, address_from_aadhaar = $6, photo_hash = $7,
      aadhaar_last4 = $8, name_match_score = $9, name_match_pass = $10,
      status = 'AADHAAR_OTP_VERIFIED', updated_at = NOW()
    WHERE user_id = $1
  `, [userId, txnId, kycData.name, kycData.dob, kycData.gender,
      JSON.stringify(kycData.address), kycData.photo_hash,
      kycData.aadhaar_last4, matchScore, matchScore >= 75]);

  await query(`
    UPDATE users SET
      address_city = $2, address_state = $3, address_pincode = $4,
      gender = $5, updated_at = NOW()
    WHERE user_id = $1
  `, [userId, kycData.address?.city, kycData.address?.state, kycData.address?.pincode, kycData.gender]);

  return { verified: true, name_match: matchScore >= 75, match_score: matchScore, next_step: 'CKYC' };
};

// ── STEP 5: CKYC ─────────────────────────────────────────────
// NBFC performs CKYC using their CERSAI credentials
// LienPay facilitates by passing collected data
const processCKYC = async ({ userId }) => {
  const user = await query(
    'SELECT pan_last4, pan_encrypted, date_of_birth FROM users WHERE user_id = $1',
    [userId]
  );
  const kyc = await query('SELECT * FROM kyc_records WHERE user_id = $1', [userId]);
  const kycData = kyc.rows[0];
  const { date_of_birth } = user.rows[0];

  const nbfcMode = process.env.NBFC_MODE || 'mock';
  let ckycId, ckycAction;

  if (nbfcMode === 'real') {
    // Production: NBFC performs CKYC using their membership credentials
    const nbfcRes = await fetch(`${process.env.NBFC_API_URL}/kyc/ckyc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.NBFC_API_KEY}` },
      body: JSON.stringify({ user_id: userId, pan_last4: user.rows[0].pan_last4, dob: date_of_birth }),
    });
    const nbfcData = await nbfcRes.json();
    ckycId     = nbfcData.ckyc_id;
    ckycAction = nbfcData.action || 'NBFC_VERIFIED';
  } else {
    // Mock: use existing CKYC service for development
    const { searchCKYC, createCKYC } = require('./ckyc.service');
    const pan = user.rows[0].pan_last4;
    const searchResult = await searchCKYC(pan, date_of_birth, userId);

    if (searchResult.found) {
      ckycId     = searchResult.ckyc_id;
      ckycAction = 'FETCHED';
    } else {
      const cr = await createCKYC({
        pan, name: kycData?.name_from_aadhaar, dob: date_of_birth,
        gender: kycData?.gender_from_aadhaar,
        address: kycData?.address_from_aadhaar, kyc_type: 'AADHAAR_OTP',
        kyc_ref: kycData?.aadhaar_txn_ref,
      }, userId);
      ckycId     = cr.ckyc_id;
      ckycAction = 'CREATED';
    }
  }

  await query(`
    UPDATE kyc_records SET
      ckyc_id = $2, ckyc_action = $3, ckyc_verified_at = NOW(),
      status = 'CKYC_DONE', updated_at = NOW()
    WHERE user_id = $1
  `, [userId, ckycId, ckycAction]);

  await query(`UPDATE users SET ckyc_id = $2, ckyc_verified_at = NOW(), updated_at = NOW() WHERE user_id = $1`, [userId, ckycId]);

  // Mark KYC complete — no bureau needed for LAMF
  await query(`UPDATE kyc_records SET status = 'COMPLETE', completed_at = NOW() WHERE user_id = $1`, [userId]);
  await query(`
    UPDATE users SET
      kyc_status = 'VERIFIED', kyc_type = 'AADHAAR_OTP',
      kyc_completed_at = NOW(), account_status = 'KYC_DONE',
      onboarding_step = 'PORTFOLIO_LINK', updated_at = NOW()
    WHERE user_id = $1
  `, [userId]);

  audit('KYC_COMPLETE', userId, { kyc_type: 'AADHAAR_OTP', ckyc_id: ckycId });

  return {
    ckyc_id:      ckycId,
    action:       ckycAction,
    kyc_complete: true,
    next_step:    'PORTFOLIO_LINK',
    message:      'KYC verified successfully.',
  };
};

// ── STEP 6: Bureau — NOT REQUIRED FOR LAMF ───────────────────
// Bureau check is for UNSECURED lending only.
// LAMF is 100% collateral-backed — the MF units cover the loan.
// This endpoint is kept for API compatibility but does NOT reject users.
const processBureau = async ({ userId, consentId, ipHash }) => {
  logger.info(`Bureau check called for ${userId} — NOT required for LAMF. Marking KYC complete.`);

  // Log that bureau was skipped (for compliance audit)
  audit('BUREAU_SKIPPED_COLLATERAL_LOAN', userId, {
    reason: 'LAMF is collateral-backed. Bureau not required per product design.',
  });

  // KYC should already be complete from CKYC step
  // If it isn't for some reason, complete it now
  await query(`
    UPDATE users SET
      kyc_status = 'VERIFIED', kyc_completed_at = NOW(),
      account_status = 'KYC_DONE', onboarding_step = 'PORTFOLIO_LINK',
      updated_at = NOW()
    WHERE user_id = $1 AND kyc_status != 'VERIFIED'
  `, [userId]).catch(() => {});

  return {
    kyc_complete: true,
    bureau_note:  'Bureau check not required for Loan Against Mutual Funds. Collateral covers risk.',
    next_step:    'PORTFOLIO_LINK',
    message:      'KYC verification complete.',
  };
};

module.exports = {
  submitProfile,
  initiateAadhaarKYC,
  verifyAadhaarKYC,
  processCKYC,
  processBureau,
};
