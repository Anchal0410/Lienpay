const axios = require('axios');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CKYC REGISTRY SERVICE (CERSAI)
// Mode: CKYC_MODE=mock | real
// Real access: Via lending partner's CERSAI membership
// ─────────────────────────────────────────────────────────────

// ── MOCK: Search CKYC ─────────────────────────────────────────
const mockSearchCKYC = async (pan, dob) => {
  await new Promise(r => setTimeout(r, 500));

  // Simulate: most users have existing CKYC
  const hasCKYC = pan.slice(-1) !== 'Z'; // PANs ending in Z = new user (for testing)

  if (hasCKYC) {
    return {
      found:    true,
      ckyc_id:  `52847${Math.floor(Math.random() * 100000000).toString().padStart(9, '0')}`,
      name:     'Rahul Sharma',
      dob:      dob,
      status:   'VERIFIED',
      kyc_date: '2021-03-15',
    };
  }

  return { found: false, ckyc_id: null };
};

// ── MOCK: Create CKYC ─────────────────────────────────────────
const mockCreateCKYC = async (kycData) => {
  await new Promise(r => setTimeout(r, 800));

  const ckycId = `52847${Math.floor(Math.random() * 100000000).toString().padStart(9, '0')}`;

  logger.info('📋 [CKYC MOCK] New record created', { ckyc_id: ckycId });

  return {
    success:  true,
    ckyc_id:  ckycId,
    action:   'CREATED',
    message:  'CKYC record successfully created',
  };
};

// ── REAL: Search CKYC via lending partner API ─────────────────
const realSearchCKYC = async (pan, dob) => {
  try {
    const response = await axios.post(
      `${process.env.CKYC_API_URL}/search`,
      { pan, dob },
      {
        headers: {
          Authorization: `Bearer ${process.env.CKYC_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const data = response.data;
    return {
      found:    data.found || false,
      ckyc_id:  data.ckyc_number || null,
      name:     data.name || null,
      dob:      data.dob || null,
      status:   data.status || null,
      kyc_date: data.kyc_date || null,
    };
  } catch (err) {
    logger.error('CKYC search failed:', err.message);
    throw new Error(`CKYC search failed: ${err.message}`);
  }
};

// ── REAL: Create CKYC ─────────────────────────────────────────
const realCreateCKYC = async (kycData) => {
  try {
    const response = await axios.post(
      `${process.env.CKYC_API_URL}/create`,
      {
        pan:          kycData.pan,
        name:         kycData.name,
        dob:          kycData.dob,
        gender:       kycData.gender,
        address:      kycData.address,
        kyc_type:     kycData.kyc_type,
        kyc_ref:      kycData.kyc_ref,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CKYC_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      success:  true,
      ckyc_id:  response.data.ckyc_number,
      action:   'CREATED',
    };
  } catch (err) {
    logger.error('CKYC create failed:', err.message);
    throw new Error(`CKYC creation failed: ${err.message}`);
  }
};

// ── PUBLIC FUNCTIONS ──────────────────────────────────────────
const searchCKYC = async (pan, dob, userId) => {
  const mode = process.env.CKYC_MODE || 'mock';

  const result = mode === 'real'
    ? await realSearchCKYC(pan, dob)
    : await mockSearchCKYC(pan, dob);

  audit('CKYC_SEARCHED', userId, {
    pan_last4: pan.slice(-4),
    found:     result.found,
    mode,
  });

  return result;
};

const createCKYC = async (kycData, userId) => {
  const mode = process.env.CKYC_MODE || 'mock';

  const result = mode === 'real'
    ? await realCreateCKYC(kycData)
    : await mockCreateCKYC(kycData);

  audit('CKYC_CREATED', userId, {
    ckyc_id: result.ckyc_id,
    mode,
  });

  return result;
};

module.exports = { searchCKYC, createCKYC };
