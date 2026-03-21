const axios = require('axios');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// ACCOUNT AGGREGATOR SERVICE
// Mode: AA_MODE=mock | real
// Real: Sahamati network (Onemoney / Finvu / CAMSfinserv)
// Role: LienPay is FIU (Financial Information User)
// FIPs: CAMS and KFintech (they hold the MF data)
// ─────────────────────────────────────────────────────────────

// ── MOCK: Create AA Consent ───────────────────────────────────
const mockCreateConsent = async (userId, mobile) => {
  await new Promise(r => setTimeout(r, 400));

  const consentHandle = `MOCK_AA_CONSENT_${userId}_${Date.now()}`;
  const consentId     = `CONSENT_${Math.random().toString(36).slice(2).toUpperCase()}`;

  logger.info('🔗 [AA MOCK] Consent artifact created', { consent_handle: consentHandle });

  return {
    success:        true,
    consent_id:     consentId,
    consent_handle: consentHandle,
    redirect_url:   `https://mock-aa.lienpay.app/consent?handle=${consentHandle}`,
    expires_at:     new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
    mock:           true,
  };
};

// ── REAL: Create AA Consent via Sahamati ──────────────────────
const realCreateConsent = async (userId, mobile) => {
  try {
    const consentDetail = {
      consentStart:   new Date().toISOString(),
      consentExpiry:  new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      consentMode:    'VIEW',
      fetchType:      'ONE_TIME',
      consentTypes:   ['PROFILE', 'SUMMARY', 'TRANSACTIONS'],
      fiTypes:        ['MUTUAL_FUNDS'],
      DataConsumer:   { id: process.env.AA_FIU_ID },
      Customer:       { id: `${mobile}@onemoney` },
      FIPDetails: [
        { fipID: 'CAMS-FIP',     fiTypes: ['MUTUAL_FUNDS'] },
        { fipID: 'KFINTECH-FIP', fiTypes: ['MUTUAL_FUNDS'] },
      ],
      DataLife:       { unit: 'MONTH', value: 12 },
      Frequency:      { unit: 'MONTH', value: 1 },
      DataFilter:     [{ type: 'TRANSACTIONAMOUNT', operator: '>=', value: '0' }],
      Purpose: {
        code:    '101',
        refUri:  'https://api.rebit.org.in/aa/purpose/101.xml',
        text:    'Credit underwriting for Loan Against Mutual Funds',
        Category: { type: 'Purpose Category as defined in the Standards' },
      },
    };

    const response = await axios.post(
      `${process.env.AA_API_URL}/Consent`,
      { ver: '2.0.0', timestamp: new Date().toISOString(), txnid: userId, ConsentDetail: consentDetail },
      {
        headers: {
          'x-jws-signature': 'placeholder',
          'client_api_key':  process.env.AA_CLIENT_SECRET,
          'Content-Type':    'application/json',
        },
        timeout: 15000,
      }
    );

    return {
      success:        true,
      consent_id:     response.data.ConsentHandle,
      consent_handle: response.data.ConsentHandle,
      redirect_url:   response.data.redirectUrl || `https://onemoney.in/consent?handle=${response.data.ConsentHandle}`,
      expires_at:     consentDetail.consentExpiry,
    };
  } catch (err) {
    logger.error('AA consent creation failed:', err.message);
    throw new Error(`AA consent failed: ${err.message}`);
  }
};

// ── MOCK: Fetch FI Data ───────────────────────────────────────
const mockFetchFIData = async (consentId, userId) => {
  await new Promise(r => setTimeout(r, 800));

  // Return realistic mock MF portfolio
  return {
    success: true,
    holdings: [
      {
        fip:          'CAMS-FIP',
        folio_number: 'CAMS123456789',
        isin:         'INF200K01RO2',
        scheme_name:  'Axis Bluechip Fund - Direct Growth',
        amc_name:     'Axis Mutual Fund',
        rta:          'CAMS',
        scheme_type:  'EQUITY_LARGE_CAP',
        units_held:   2456.78,
        nav:          52.34,
        lock_in_date: null,
        is_joint:     false,
      },
      {
        fip:          'CAMS-FIP',
        folio_number: 'CAMS987654321',
        isin:         'INF200K01RM6',
        scheme_name:  'Mirae Asset Emerging Bluechip - Direct Growth',
        amc_name:     'Mirae Asset',
        rta:          'CAMS',
        scheme_type:  'EQUITY_MID_CAP',
        units_held:   1894.32,
        nav:          98.76,
        lock_in_date: null,
        is_joint:     false,
      },
      {
        fip:          'KFINTECH-FIP',
        folio_number: 'KFT456789123',
        isin:         'INF200K01RN4',
        scheme_name:  'HDFC Short Term Debt Fund - Direct Growth',
        amc_name:     'HDFC Mutual Fund',
        rta:          'KFINTECH',
        scheme_type:  'DEBT_SHORT_DUR',
        units_held:   5128.91,
        nav:          24.56,
        lock_in_date: null,
        is_joint:     false,
      },
      {
        fip:          'KFINTECH-FIP',
        folio_number: 'KFT789123456',
        isin:         'INF200K01RP9',
        scheme_name:  'Parag Parikh Flexi Cap Fund - Direct Growth',
        amc_name:     'PPFAS Mutual Fund',
        rta:          'KFINTECH',
        scheme_type:  'EQUITY_FLEXI_CAP',
        units_held:   1562.34,
        nav:          67.89,
        lock_in_date: null,
        is_joint:     false,
      },
    ],
    fetched_at:  new Date().toISOString(),
    consent_id:  consentId,
    mock:        true,
  };
};

// ── REAL: Fetch FI Data from AA ───────────────────────────────
const realFetchFIData = async (consentId, userId) => {
  try {
    // Step 1: Create FI request
    const fiRequest = await axios.post(
      `${process.env.AA_API_URL}/FI/request`,
      {
        ver:       '2.0.0',
        timestamp: new Date().toISOString(),
        txnid:     userId,
        Consent: {
          id:              consentId,
          digitalSignature: 'placeholder',
        },
        FIDataRange: {
          from: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
          to:   new Date().toISOString(),
        },
        KeyMaterial: { cryptoAlg: 'ECDH', curve: 'Curve25519', params: 'placeholder' },
      },
      {
        headers: { 'client_api_key': process.env.AA_CLIENT_SECRET },
        timeout: 15000,
      }
    );

    const sessionId = fiRequest.data.sessionId;

    // Step 2: Poll for data (retry up to 5 times)
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const fiData = await axios.get(
        `${process.env.AA_API_URL}/FI/fetch/${sessionId}`,
        { headers: { 'client_api_key': process.env.AA_CLIENT_SECRET } }
      );

      if (fiData.data.status === 'READY') {
        return { success: true, raw_data: fiData.data, consent_id: consentId };
      }
    }

    throw new Error('FI data fetch timed out');
  } catch (err) {
    logger.error('AA FI fetch failed:', err.message);
    throw new Error(`AA data fetch failed: ${err.message}`);
  }
};

// ── PUBLIC FUNCTIONS ──────────────────────────────────────────
const createAAConsent = async (userId, mobile) => {
  const mode = process.env.AA_MODE || 'mock';
  const result = mode === 'real'
    ? await realCreateConsent(userId, mobile)
    : await mockCreateConsent(userId, mobile);

  audit('AA_CONSENT_CREATED', userId, { consent_id: result.consent_id, mode });
  return result;
};

const fetchPortfolioData = async (consentId, userId) => {
  const mode = process.env.AA_MODE || 'mock';
  const result = mode === 'real'
    ? await realFetchFIData(consentId, userId)
    : await mockFetchFIData(consentId, userId);

  audit('AA_DATA_FETCHED', userId, { consent_id: consentId, mode });
  return result;
};

module.exports = { createAAConsent, fetchPortfolioData };
