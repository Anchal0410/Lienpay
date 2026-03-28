const { query }    = require('../../config/database');
const { encrypt, hash, maskPAN } = require('../utils/encryption');
const { verifyPAN, calculateNameMatchScore } = require('./pan.service');
const { sendAadhaarOTP, verifyAadhaarOTP } = require('./aadhaar.service');
const { searchCKYC, createCKYC } = require('./ckyc.service');
const { pullBureau, screenAML }  = require('./bureau.service');
const { logConsent, CONSENT_TYPES, CONSENT_ACTIONS } = require('./consent.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// KYC ORCHESTRATION SERVICE
// ─────────────────────────────────────────────────────────────

// ── STEP 1+2: Save profile + verify PAN + AML ─────────────────
const submitProfile = async ({ userId, pan, fullName, dob, email, ipHash, deviceId }) => {

  const existing = await query(
    'SELECT user_id FROM users WHERE pan_encrypted IS NOT NULL AND pan_last4 = $1 AND user_id != $2',
    [pan.slice(-4), userId]
  );
  if (existing.rows.length > 0) {
    throw { statusCode: 409, message: 'This PAN is already registered with another account.' };
  }

  const panResult = await verifyPAN(pan, fullName, dob, userId);
  if (panResult.status !== 'ACTIVE') {
    throw { statusCode: 400, message: `PAN is ${panResult.status}. Please use an active PAN.` };
  }
  if (!panResult.name_match) {
    throw { statusCode: 400, message: `Name does not match PAN records. Please check your name (Match score: ${panResult.match_score}%).` };
  }

  const amlResult = await screenAML(pan, fullName, dob, userId);
  if (amlResult.result === 'FAIL') {
    audit('KYC_AML_REJECTED', userId, { pan_last4: pan.slice(-4) });
    throw { statusCode: 400, message: 'We are unable to proceed with your application at this time.' };
  }

  await query(`
    INSERT INTO aml_checks
      (user_id, check_type, risk_score, pep_flag, sanctions_flag, adverse_media_flag, flags, result, provider_ref)
    VALUES ($1, 'ONBOARDING', $2, $3, $4, $5, $6, $7, $8)
  `, [
    userId, amlResult.risk_score, amlResult.pep_flag, amlResult.sanctions_flag,
    amlResult.adverse_media_flag, JSON.stringify(amlResult.flags),
    amlResult.result, amlResult.provider_ref,
  ]);

  const panEncrypted = encrypt(pan);
  await query(`
    UPDATE users SET
      full_name       = $2, pan_last4    = $3, pan_encrypted = $4,
      pan_verified    = $5, pan_status   = $6, date_of_birth = $7,
      email           = $8, onboarding_step = 'KYC_METHOD', updated_at = NOW()
    WHERE user_id = $1
  `, [userId, fullName, pan.slice(-4), panEncrypted, true, panResult.status, dob, email || null]);

  return {
    pan_verified: true, pan_status: panResult.status,
    name_match: panResult.name_match, match_score: panResult.match_score,
    aml_result: amlResult.result, next_step: 'AADHAAR_KYC',
  };
};

// ── STEP 3: Send Aadhaar OTP ──────────────────────────────────
const initiateAadhaarKYC = async ({ userId, aadhaarLast4, ipHash }) => {
  await logConsent({
    userId,
    consentType: CONSENT_TYPES.AADHAAR_KYC,
    action:      CONSENT_ACTIONS.GRANTED,
    ipHash,
    metadata:    { aadhaar_last4: aadhaarLast4 },
  });

  const result = await sendAadhaarOTP(aadhaarLast4, userId);

  await query(`
    INSERT INTO kyc_records (user_id, aadhaar_last4, kyc_method, status)
    VALUES ($1, $2, 'AADHAAR_OTP', 'AADHAAR_OTP_PENDING')
    ON CONFLICT (user_id) DO UPDATE SET
      aadhaar_last4 = $2, kyc_method = 'AADHAAR_OTP',
      status = 'AADHAAR_OTP_PENDING', updated_at = NOW()
  `, [userId, aadhaarLast4]);

  return {
    txn_id:  result.txn_id,
    message: result.message,
    // Pass dev_otp through so frontend can auto-fill in mock mode.
    // result.dev_otp is undefined when AADHAAR_MODE=real — safe no-op.
    ...(result.dev_otp ? { dev_otp: result.dev_otp } : {}),
  };
};

// ── STEP 4: Verify Aadhaar OTP + parse eKYC ──────────────────
const verifyAadhaarKYC = async ({ userId, txnId, otp, ipHash }) => {
  const result = await verifyAadhaarOTP(txnId, otp, userId);

  if (!result.success) {
    throw { statusCode: 400, message: 'Aadhaar OTP verification failed.' };
  }

  const kycData  = result.kyc_data;
  const user     = await query('SELECT full_name FROM users WHERE user_id = $1', [userId]);
  const panName  = user.rows[0]?.full_name || '';
  const matchScore = calculateNameMatchScore(panName, kycData.name);

  await query(`
    UPDATE kyc_records SET
      aadhaar_txn_ref = $2, name_from_aadhaar = $3, dob_from_aadhaar = $4,
      gender_from_aadhaar = $5, address_from_aadhaar = $6, photo_hash = $7,
      aadhaar_last4 = $8, name_match_score = $9, name_match_pass = $10,
      status = 'AADHAAR_OTP_VERIFIED', updated_at = NOW()
    WHERE user_id = $1
  `, [
    userId, txnId, kycData.name, kycData.dob, kycData.gender,
    JSON.stringify(kycData.address), kycData.photo_hash, kycData.aadhaar_last4,
    matchScore, matchScore >= 75,
  ]);

  await query(`
    UPDATE users SET address_city=$2, address_state=$3, address_pincode=$4, gender=$5, updated_at=NOW()
    WHERE user_id=$1
  `, [userId, kycData.address?.city, kycData.address?.state, kycData.address?.pincode, kycData.gender]);

  return { verified: true, name_match: matchScore >= 75, match_score: matchScore, next_step: 'CKYC' };
};

// ── STEP 5: CKYC search + create ─────────────────────────────
const processCKYC = async ({ userId }) => {
  const user = await query('SELECT pan_last4, pan_encrypted, date_of_birth FROM users WHERE user_id=$1', [userId]);
  if (!user.rows.length) throw { statusCode: 404, message: 'User not found.' };

  const { date_of_birth } = user.rows[0];
  const kycRecord = await query('SELECT * FROM kyc_records WHERE user_id=$1', [userId]);
  const kycData   = kycRecord.rows[0];
  const pan       = user.rows[0].pan_last4;

  const searchResult = await searchCKYC(pan, date_of_birth, userId);
  let ckycId, ckycAction;

  if (searchResult.found) {
    ckycId = searchResult.ckyc_id; ckycAction = 'FETCHED';
  } else {
    const createResult = await createCKYC({
      pan, name: kycData?.name_from_aadhaar, dob: date_of_birth,
      gender: kycData?.gender_from_aadhaar, address: kycData?.address_from_aadhaar,
      kyc_type: 'AADHAAR_OTP', kyc_ref: kycData?.aadhaar_txn_ref,
    }, userId);
    ckycId = createResult.ckyc_id; ckycAction = 'CREATED';
  }

  await query(`
    UPDATE kyc_records SET ckyc_id=$2, ckyc_action=$3, ckyc_verified_at=NOW(), status='CKYC_DONE', updated_at=NOW()
    WHERE user_id=$1
  `, [userId, ckycId, ckycAction]);

  await query(`UPDATE users SET ckyc_id=$2, ckyc_verified_at=NOW(), updated_at=NOW() WHERE user_id=$1`, [userId, ckycId]);

  return { ckyc_id: ckycId, action: ckycAction, next_step: 'BUREAU' };
};

// ── STEP 6: Bureau pull (negative filter) ────────────────────
const processBureau = async ({ userId, consentId, ipHash }) => {
  // Log bureau consent first
  const consent = await logConsent({
    userId,
    consentType: CONSENT_TYPES.BUREAU_PULL,
    action:      CONSENT_ACTIONS.GRANTED,
    ipHash,
    metadata:    { bureau: 'CIBIL', pull_type: 'SOFT' },
  });

  const user = await query(
    'SELECT pan_last4, full_name, date_of_birth FROM users WHERE user_id=$1',
    [userId]
  );
  const { pan_last4, full_name, date_of_birth } = user.rows[0];

  // CORRECT: pass pan_last4 (string), full_name, date_of_birth as separate args.
  // pullBureau signature: pullBureau(pan, name, dob, userId, consentId)
  // Bug was: previously passed user.rows[0] object as pan → pan.slice() crashed.
  const bureauResult = await pullBureau(pan_last4, full_name, date_of_birth, userId, consent.consent_id);

  await query(`
    INSERT INTO bureau_results
      (user_id, bureau_name, pull_type, consent_id, provider_ref, score_band, score_value,
       dpd_90_plus, written_off, active_loans_count, settled_loans_count, enquiries_6m,
       recommendation, rejection_reason)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    userId, 'CIBIL', 'SOFT', consent.consent_id, bureauResult.bureau_ref,
    bureauResult.score_band, bureauResult.score_value, bureauResult.dpd_90_plus,
    bureauResult.written_off, bureauResult.active_loans, bureauResult.settled_loans,
    bureauResult.enquiries_6m, bureauResult.recommendation, bureauResult.rejection_reason,
  ]);

  if (bureauResult.recommendation === 'REJECT') {
    await query(`UPDATE users SET account_status='REJECTED', updated_at=NOW() WHERE user_id=$1`, [userId]);
    throw { statusCode: 400, message: 'We cannot offer credit at this time.', rejection_reason: bureauResult.rejection_reason };
  }

  await query(`UPDATE kyc_records SET status='COMPLETE', completed_at=NOW() WHERE user_id=$1`, [userId]);
  await query(`
    UPDATE users SET
      kyc_status='VERIFIED', kyc_type='AADHAAR_OTP', kyc_completed_at=NOW(),
      account_status='KYC_DONE', onboarding_step='PORTFOLIO_LINK', updated_at=NOW()
    WHERE user_id=$1
  `, [userId]);

  audit('KYC_COMPLETE', userId, { kyc_type: 'AADHAAR_OTP', bureau_band: bureauResult.score_band });

  return {
    kyc_complete: true, score_band: bureauResult.score_band,
    next_step: 'PORTFOLIO_LINK', message: 'KYC verified successfully. Proceed to link your mutual fund portfolio.',
  };
};

module.exports = { submitProfile, initiateAadhaarKYC, verifyAadhaarKYC, processCKYC, processBureau };
