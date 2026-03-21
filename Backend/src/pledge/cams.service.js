const axios = require('axios');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CAMS PLEDGE SERVICE
// Mode: CAMS_MODE=mock | real
// Real: CAMS Technology Services API
// Apply: techpartnerships@camsonline.com (6-8 weeks)
// ─────────────────────────────────────────────────────────────

// ── MOCK: Initiate Pledge ─────────────────────────────────────
const mockInitiatePledge = async (pledgeData) => {
  await new Promise(r => setTimeout(r, 600));

  const pledgeReqId = `CAMS_REQ_${Date.now()}_${Math.random().toString(36).slice(2).toUpperCase()}`;

  console.log('\n' + '─'.repeat(50));
  console.log(`📋 CAMS MOCK: Pledge initiated`);
  console.log(`   Folio: ${pledgeData.folio_number}`);
  console.log(`   Units: ${pledgeData.units_to_pledge}`);
  console.log(`   Pledgee: ${pledgeData.pledgee_name}`);
  console.log(`   Request ID: ${pledgeReqId}`);
  console.log('─'.repeat(50) + '\n');

  return {
    success:        true,
    pledge_req_id:  pledgeReqId,
    status:         'OTP_PENDING',
    message:        'OTP sent to unit holder registered mobile',
    mock:           true,
  };
};

// ── MOCK: Confirm Pledge ──────────────────────────────────────
const mockConfirmPledge = async (pledgeReqId, otp) => {
  await new Promise(r => setTimeout(r, 500));

  // Mock OTP for CAMS is always 123456
  if (otp !== '123456') {
    throw { statusCode: 400, message: 'Invalid CAMS OTP. Please try again.' };
  }

  const pledgeRef = `CAMS-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return {
    success:           true,
    pledge_ref_number: pledgeRef,
    status:            'ACTIVE',
    registration_date: new Date().toISOString(),
    mock:              true,
  };
};

// ── REAL: Initiate CAMS Pledge ────────────────────────────────
const realInitiatePledge = async (pledgeData) => {
  try {
    const response = await axios.post(
      `${process.env.CAMS_API_URL}/pledge/initiate`,
      {
        folio_number:  pledgeData.folio_number,
        isin:          pledgeData.isin,
        units:         pledgeData.units_to_pledge,
        pledgee_name:  pledgeData.pledgee_name,
        pledgee_pan:   pledgeData.pledgee_pan,
        lsp_ref:       pledgeData.lsp_pledge_id,
        purpose:       'CREDIT_LINE',
      },
      {
        headers: {
          'x-api-key':    process.env.CAMS_API_KEY,
          'x-client-id':  process.env.CAMS_CLIENT_ID,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      success:       true,
      pledge_req_id: response.data.pledge_request_id,
      status:        'OTP_PENDING',
      message:       'OTP sent to unit holder registered mobile',
    };
  } catch (err) {
    logger.error('CAMS pledge initiation failed:', err.message);
    throw new Error(`CAMS pledge failed: ${err.message}`);
  }
};

// ── REAL: Confirm CAMS Pledge ─────────────────────────────────
const realConfirmPledge = async (pledgeReqId, otp) => {
  try {
    const response = await axios.post(
      `${process.env.CAMS_API_URL}/pledge/confirm`,
      { pledge_request_id: pledgeReqId, otp },
      {
        headers: {
          'x-api-key':   process.env.CAMS_API_KEY,
          'x-client-id': process.env.CAMS_CLIENT_ID,
        },
        timeout: 15000,
      }
    );

    return {
      success:           true,
      pledge_ref_number: response.data.pledge_ref_number,
      status:            'ACTIVE',
      registration_date: response.data.registration_date,
    };
  } catch (err) {
    if (err.response?.status === 400) {
      throw { statusCode: 400, message: 'Invalid CAMS OTP.' };
    }
    logger.error('CAMS pledge confirm failed:', err.message);
    throw new Error(`CAMS pledge confirmation failed: ${err.message}`);
  }
};

// ── REAL: Release CAMS Pledge ─────────────────────────────────
const realReleasePledge = async (pledgeRefNumber) => {
  try {
    const response = await axios.post(
      `${process.env.CAMS_API_URL}/pledge/release`,
      { pledge_ref_number: pledgeRefNumber },
      {
        headers: { 'x-api-key': process.env.CAMS_API_KEY },
        timeout: 15000,
      }
    );
    return { success: true, release_ref: response.data.release_ref };
  } catch (err) {
    logger.error('CAMS pledge release failed:', err.message);
    throw new Error(`CAMS pledge release failed: ${err.message}`);
  }
};

// ── REAL: Invoke CAMS Pledge (on default) ────────────────────
const realInvokePledge = async (pledgeRefNumber, unitsToRedeem, collectionAccount) => {
  try {
    const response = await axios.post(
      `${process.env.CAMS_API_URL}/pledge/invoke`,
      {
        pledge_ref_number:  pledgeRefNumber,
        units_to_redeem:    unitsToRedeem,
        collection_account: collectionAccount,
        reason:             'DEFAULT_RECOVERY',
      },
      {
        headers: { 'x-api-key': process.env.CAMS_API_KEY },
        timeout: 15000,
      }
    );
    return { success: true, redemption_ref: response.data.redemption_ref };
  } catch (err) {
    logger.error('CAMS pledge invocation failed:', err.message);
    throw new Error(`CAMS pledge invocation failed: ${err.message}`);
  }
};

// ── PUBLIC FUNCTIONS ──────────────────────────────────────────
const initiatePledge = async (pledgeData) => {
  const mode = process.env.CAMS_MODE || 'mock';
  audit('CAMS_PLEDGE_INITIATED', pledgeData.userId, {
    folio: pledgeData.folio_number,
    units: pledgeData.units_to_pledge,
    mode,
  });
  return mode === 'real'
    ? await realInitiatePledge(pledgeData)
    : await mockInitiatePledge(pledgeData);
};

const confirmPledge = async (pledgeReqId, otp, userId) => {
  const mode = process.env.CAMS_MODE || 'mock';
  const result = mode === 'real'
    ? await realConfirmPledge(pledgeReqId, otp)
    : await mockConfirmPledge(pledgeReqId, otp);

  audit('CAMS_PLEDGE_CONFIRMED', userId, {
    pledge_ref: result.pledge_ref_number,
    mode,
  });
  return result;
};

const releasePledge = async (pledgeRefNumber, userId) => {
  const mode = process.env.CAMS_MODE || 'mock';
  if (mode === 'mock') {
    return { success: true, release_ref: `CAMS_REL_${Date.now()}` };
  }
  return await realReleasePledge(pledgeRefNumber);
};

const invokePledge = async (pledgeRefNumber, unitsToRedeem, collectionAccount, userId) => {
  const mode = process.env.CAMS_MODE || 'mock';
  audit('CAMS_PLEDGE_INVOKED', userId, { pledge_ref: pledgeRefNumber });
  if (mode === 'mock') {
    return { success: true, redemption_ref: `CAMS_REDEEM_${Date.now()}` };
  }
  return await realInvokePledge(pledgeRefNumber, unitsToRedeem, collectionAccount);
};

module.exports = { initiatePledge, confirmPledge, releasePledge, invokePledge };
