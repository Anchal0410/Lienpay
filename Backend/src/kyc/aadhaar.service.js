const axios = require('axios');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// AADHAAR eKYC SERVICE
// Mode: AADHAAR_MODE=mock | real
// Real vendor: Digio / Signzy (via UIDAI AUA/KUA)
// CRITICAL: Full Aadhaar number NEVER stored per UIDAI mandate
// ─────────────────────────────────────────────────────────────

// ── MOCK: Send Aadhaar OTP ────────────────────────────────────
const mockSendAadhaarOTP = async (aadhaarLast4, userId) => {
  await new Promise(r => setTimeout(r, 500));

  const txnId = `MOCK_UIDAI_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  logger.info('🔐 [AADHAAR MOCK] OTP sent', {
    aadhaar_last4: aadhaarLast4,
    txn_id: txnId,
  });

  // In mock mode, print OTP to console so you can test
  console.log('\n' + '─'.repeat(50));
  console.log(`🔐 AADHAAR OTP (MOCK): 421980`);
  console.log(`   Transaction ID: ${txnId}`);
  console.log('─'.repeat(50) + '\n');

  return {
    success:  true,
    txn_id:   txnId,
    message:  'OTP sent to Aadhaar-linked mobile number',
    mock:     true,
  };
};

// ── REAL: Send Aadhaar OTP via Digio ─────────────────────────
const realSendAadhaarOTP = async (aadhaarEncrypted, userId) => {
  try {
    const response = await axios.post(
      `${process.env.DIGIO_API_URL}/v2/client/kyc/okyc/initiate`,
      { aadhaar_number: aadhaarEncrypted },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${process.env.DIGIO_CLIENT_ID}:${process.env.DIGIO_CLIENT_SECRET}`
          ).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      success: true,
      txn_id:  response.data?.id || response.data?.txn_id,
      message: 'OTP sent to Aadhaar-linked mobile number',
    };
  } catch (err) {
    logger.error('Digio Aadhaar OTP failed:', err.message);
    throw new Error(`Aadhaar OTP failed: ${err.message}`);
  }
};

// ── MOCK: Verify Aadhaar OTP + Return eKYC Data ───────────────
const mockVerifyAadhaarOTP = async (txnId, otp, userId) => {
  await new Promise(r => setTimeout(r, 600));

  // Mock OTP is always 421980 in dev
  if (otp !== '421980') {
    throw { statusCode: 400, message: 'Invalid Aadhaar OTP. Please try again.' };
  }

  // Return realistic eKYC data structure
  return {
    success: true,
    kyc_data: {
      name:         'Rahul Sharma',
      dob:          '1992-08-12',
      gender:       'MALE',
      address: {
        house:    '42',
        street:   'MG Road',
        landmark: 'Near Metro Station',
        locality: 'Koramangala',
        city:     'Bengaluru',
        state:    'Karnataka',
        pincode:  '560034',
        country:  'India',
      },
      photo_hash: 'sha256_mock_photo_hash_never_store_actual_photo',
      // NEVER return or store full Aadhaar number
      aadhaar_last4: '3421',
      mobile_last4:  '3210',
    },
    txn_ref: txnId,
    verified_at: new Date().toISOString(),
    mock: true,
  };
};

// ── REAL: Verify Aadhaar OTP via Digio ───────────────────────
const realVerifyAadhaarOTP = async (txnId, otp, userId) => {
  try {
    const response = await axios.post(
      `${process.env.DIGIO_API_URL}/v2/client/kyc/okyc/verify`,
      { request_id: txnId, otp },
      {
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${process.env.DIGIO_CLIENT_ID}:${process.env.DIGIO_CLIENT_SECRET}`
          ).toString('base64')}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const d = response.data;
    return {
      success: true,
      kyc_data: {
        name:          d.name,
        dob:           d.dob,
        gender:        d.gender,
        address:       d.address || {},
        photo_hash:    d.photo ? require('crypto').createHash('sha256').update(d.photo).digest('hex') : null,
        aadhaar_last4: d.masked_aadhaar?.slice(-4),
        mobile_last4:  d.mobile?.slice(-4),
      },
      txn_ref:     txnId,
      verified_at: new Date().toISOString(),
    };
  } catch (err) {
    if (err.response?.status === 400) {
      throw { statusCode: 400, message: 'Invalid Aadhaar OTP. Please try again.' };
    }
    logger.error('Digio Aadhaar verify failed:', err.message);
    throw new Error(`Aadhaar verification failed: ${err.message}`);
  }
};

// ── PUBLIC FUNCTIONS ──────────────────────────────────────────
const sendAadhaarOTP = async (aadhaarLast4, userId) => {
  const mode = process.env.AADHAAR_MODE || 'mock';

  audit('AADHAAR_OTP_REQUESTED', userId, {
    aadhaar_last4: aadhaarLast4,
    mode,
  });

  return mode === 'real'
    ? await realSendAadhaarOTP(aadhaarLast4, userId)
    : await mockSendAadhaarOTP(aadhaarLast4, userId);
};

const verifyAadhaarOTP = async (txnId, otp, userId) => {
  const mode = process.env.AADHAAR_MODE || 'mock';
  const result = mode === 'real'
    ? await realVerifyAadhaarOTP(txnId, otp, userId)
    : await mockVerifyAadhaarOTP(txnId, otp, userId);

  audit('AADHAAR_OTP_VERIFIED', userId, {
    txn_ref: txnId,
    mode,
  });

  return result;
};

module.exports = { sendAadhaarOTP, verifyAadhaarOTP };
