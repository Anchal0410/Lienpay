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
    expires_at:     new Date(Date.now() + 30 * 60 * 1000).toISOString(),
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
// Holdings represent the full LienPay fund universe (38 funds).
// ISINs are mock — in production these come from actual CAMS/KFintech data.
// NAVs are indicative — portfolio.service.js fetches live NAVs from AMFI
// using the scheme_code field and overwrites these values.
// Units are representative demo values for MVP presentation.
// scheme_type is pre-classified so fund.classifier.js LTV rates apply correctly.
const mockFetchFIData = async (consentId, userId) => {
  await new Promise(r => setTimeout(r, 800));

  const holdings = [

    // ── LARGE CAP (LTV: 40%) ────────────────────────────────────
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS106235001', scheme_code: 106235,
      isin: 'INF204K01EY0', scheme_name: 'Nippon India Large Cap Fund - Direct Growth',
      amc_name: 'Nippon India Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_CAP', units_held: 950, nav: 95.42, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS120586001', scheme_code: 120586,
      isin: 'INF109K01Z22', scheme_name: 'ICICI Prudential Large Cap Fund - Direct Growth',
      amc_name: 'ICICI Prudential Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_CAP', units_held: 720, nav: 116.80, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS119598001', scheme_code: 119598,
      isin: 'INF200K01RO2', scheme_name: 'SBI Blue Chip Fund - Direct Growth',
      amc_name: 'SBI Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_CAP', units_held: 580, nav: 88.54, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS119018001', scheme_code: 119018,
      isin: 'INF179K01WP0', scheme_name: 'HDFC Large Cap Fund - Direct Growth',
      amc_name: 'HDFC Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_CAP', units_held: 440, nav: 130.27, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS120465001', scheme_code: 120465,
      isin: 'INF846K01EW4', scheme_name: 'Axis Large Cap Fund - Direct Growth',
      amc_name: 'Axis Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_CAP', units_held: 830, nav: 52.34, lock_in_date: null, is_joint: false,
    },

    // ── LARGE & MID CAP (LTV: 35%) ──────────────────────────────
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS119721001', scheme_code: 119721,
      isin: 'INF200K01RM6', scheme_name: 'SBI Large & Midcap Fund - Direct Growth',
      amc_name: 'SBI Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 510, nav: 74.12, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT120665001', scheme_code: 120665,
      isin: 'INF789FC16P8', scheme_name: 'UTI Large & Mid Cap Fund - Direct Growth',
      amc_name: 'UTI Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 340, nav: 83.45, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT112932001', scheme_code: 112932,
      isin: 'INF769K01EK6', scheme_name: 'Mirae Asset Large & Midcap Fund - Regular Growth',
      amc_name: 'Mirae Asset Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 620, nav: 98.76, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT102920001', scheme_code: 102920,
      isin: 'INF760K01EL3', scheme_name: 'Canara Robeco Large and Mid Cap Fund - Regular Growth',
      amc_name: 'Canara Robeco Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 270, nav: 67.23, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT118834001', scheme_code: 118834,
      isin: 'INF769K01EM2', scheme_name: 'Mirae Asset Large & Midcap Fund - Direct Growth',
      amc_name: 'Mirae Asset Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 480, nav: 105.91, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT120158001', scheme_code: 120158,
      isin: 'INF174K01BZ7', scheme_name: 'Kotak Large & Midcap Fund - Direct Growth',
      amc_name: 'Kotak Mahindra Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 390, nav: 78.54, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS103024001', scheme_code: 103024,
      isin: 'INF200K01RN4', scheme_name: 'SBI Large & Midcap Fund - Regular Growth',
      amc_name: 'SBI Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 290, nav: 62.18, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS103819001', scheme_code: 103819,
      isin: 'INF740K01QJ5', scheme_name: 'DSP Large & Mid Cap Fund - Regular Growth',
      amc_name: 'DSP Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 360, nav: 55.67, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS130498001', scheme_code: 130498,
      isin: 'INF179K01WQ8', scheme_name: 'HDFC Large and Mid Cap Fund - Direct Growth',
      amc_name: 'HDFC Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 410, nav: 89.33, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS120357001', scheme_code: 120357,
      isin: 'INF205K01GH3', scheme_name: 'Invesco India Large & Mid Cap Fund - Direct Growth',
      amc_name: 'Invesco Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 210, nav: 71.45, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT152225001', scheme_code: 152225,
      isin: 'INF903J01PQ1', scheme_name: 'Whiteoak Capital Large & Mid Cap Fund - Regular Growth',
      amc_name: 'Whiteoak Capital Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_LARGE_MID_CAP', units_held: 180, nav: 18.72, lock_in_date: null, is_joint: false,
    },

    // ── MID CAP (LTV: 40%) ──────────────────────────────────────
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS118989001', scheme_code: 118989,
      isin: 'INF179K01VR9', scheme_name: 'HDFC Mid-Cap Opportunities Fund - Direct Growth',
      amc_name: 'HDFC Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_MID_CAP', units_held: 680, nav: 148.22, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS118666001', scheme_code: 118666,
      isin: 'INF204K01EZ7', scheme_name: 'Nippon India Growth Fund - Direct Growth',
      amc_name: 'Nippon India Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_MID_CAP', units_held: 390, nav: 163.45, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT147479001', scheme_code: 147479,
      isin: 'INF769K01FK3', scheme_name: 'Mirae Asset Midcap Fund - Regular Growth',
      amc_name: 'Mirae Asset Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_MID_CAP', units_held: 850, nav: 28.94, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT127042001', scheme_code: 127042,
      isin: 'INF247L01717', scheme_name: 'Motilal Oswal Midcap Fund - Direct Growth',
      amc_name: 'Motilal Oswal Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_MID_CAP', units_held: 460, nav: 92.17, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT120841001', scheme_code: 120841,
      isin: 'INF966L01FO5', scheme_name: 'Quant Mid Cap Fund - Direct Growth',
      amc_name: 'Quant Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_MID_CAP', units_held: 320, nav: 213.68, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS120505001', scheme_code: 120505,
      isin: 'INF846K01EX2', scheme_name: 'Axis Midcap Fund - Direct Growth',
      amc_name: 'Axis Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_MID_CAP', units_held: 540, nav: 87.43, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS125305001', scheme_code: 125305,
      isin: 'INF663L01FA8', scheme_name: 'PGIM India Midcap Opportunities Fund - Regular Growth',
      amc_name: 'PGIM India Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_MID_CAP', units_held: 240, nav: 54.32, lock_in_date: null, is_joint: false,
    },

    // ── SMALL CAP (LTV: 25%) ────────────────────────────────────
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS147946001', scheme_code: 147946,
      isin: 'INF194KB1LJ3', scheme_name: 'Bandhan Small Cap Fund - Direct Growth',
      amc_name: 'Bandhan Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 920, nav: 38.17, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS125497001', scheme_code: 125497,
      isin: 'INF200K01RQ0', scheme_name: 'SBI Small Cap Fund - Direct Growth',
      amc_name: 'SBI Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 310, nav: 183.54, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS125354001', scheme_code: 125354,
      isin: 'INF846K01FJ1', scheme_name: 'Axis Small Cap Fund - Direct Growth',
      amc_name: 'Axis Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 440, nav: 97.28, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS118778001', scheme_code: 118778,
      isin: 'INF204K01FA6', scheme_name: 'Nippon India Small Cap Fund - Direct Growth',
      amc_name: 'Nippon India Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 560, nav: 148.92, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS145206001', scheme_code: 145206,
      isin: 'INF277K01Y16', scheme_name: 'Tata Small Cap Fund - Direct Growth',
      amc_name: 'Tata Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 380, nav: 34.56, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS130503001', scheme_code: 130503,
      isin: 'INF179K01WR6', scheme_name: 'HDFC Small Cap Fund - Direct Growth',
      amc_name: 'HDFC Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 290, nav: 112.45, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT152232001', scheme_code: 152232,
      isin: 'INF247L01816', scheme_name: 'Motilal Oswal Small Cap Fund - Regular Growth',
      amc_name: 'Motilal Oswal Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 510, nav: 22.34, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS151130001', scheme_code: 151130,
      isin: 'INF336L01TO5', scheme_name: 'HSBC Small Cap Fund - Direct Growth',
      amc_name: 'HSBC Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 270, nav: 67.89, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS106823001', scheme_code: 106823,
      isin: 'INF109K01AY9', scheme_name: 'ICICI Prudential Smallcap Fund - Growth',
      amc_name: 'ICICI Prudential Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_SMALL_CAP', units_held: 430, nav: 78.23, lock_in_date: null, is_joint: false,
    },

    // ── FLEXI CAP (LTV: 35%) ────────────────────────────────────
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS122639001', scheme_code: 122639,
      isin: 'INF879O01027', scheme_name: 'Parag Parikh Flexi Cap Fund - Direct Growth',
      amc_name: 'PPFAS Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_FLEXI_CAP', units_held: 780, nav: 74.12, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT100520001', scheme_code: 100520,
      isin: 'INF090I01239', scheme_name: 'Franklin India Flexi Cap Fund - Growth',
      amc_name: 'Franklin Templeton Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_FLEXI_CAP', units_held: 350, nav: 1243.56, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT120662001', scheme_code: 120662,
      isin: 'INF789FC16P9', scheme_name: 'UTI Flexi Cap Fund - Direct Growth',
      amc_name: 'UTI Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'EQUITY_FLEXI_CAP', units_held: 490, nav: 342.17, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS118955001', scheme_code: 118955,
      isin: 'INF179K01VS7', scheme_name: 'HDFC Flexi Cap Fund - Direct Growth',
      amc_name: 'HDFC Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_FLEXI_CAP', units_held: 620, nav: 186.43, lock_in_date: null, is_joint: false,
    },
    {
      fip: 'CAMS-FIP', folio_number: 'CAMS148989001', scheme_code: 148989,
      isin: 'INF109K01AZ6', scheme_name: 'ICICI Prudential Flexicap Fund - Growth',
      amc_name: 'ICICI Prudential Mutual Fund', rta: 'CAMS',
      scheme_type: 'EQUITY_FLEXI_CAP', units_held: 280, nav: 18.94, lock_in_date: null, is_joint: false,
    },

    // ── INDEX FUNDS (LTV: 40%) ──────────────────────────────────
    {
      fip: 'KFINTECH-FIP', folio_number: 'KFT151649001', scheme_code: 151649,
      isin: 'INF174K01CZ2', scheme_name: 'Kotak Nifty Smallcap 50 Index Fund - Direct Growth',
      amc_name: 'Kotak Mahindra Mutual Fund', rta: 'KFINTECH',
      scheme_type: 'INDEX_FUND', units_held: 1200, nav: 18.43, lock_in_date: null, is_joint: false,
    },
  ];

  logger.info(`📊 [AA MOCK] Portfolio fetched — ${holdings.length} holdings`, { consent_id: consentId });

  return {
    success:     true,
    holdings,
    fetched_at:  new Date().toISOString(),
    consent_id:  consentId,
    mock:        true,
  };
};

// ── REAL: Fetch FI Data from AA ───────────────────────────────
const realFetchFIData = async (consentId, userId) => {
  try {
    const fiRequest = await axios.post(
      `${process.env.AA_API_URL}/FI/request`,
      {
        ver:       '2.0.0',
        timestamp: new Date().toISOString(),
        txnid:     userId,
        Consent: {
          id:               consentId,
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
  const mode   = process.env.AA_MODE || 'mock';
  const result = mode === 'real'
    ? await realCreateConsent(userId, mobile)
    : await mockCreateConsent(userId, mobile);

  audit('AA_CONSENT_CREATED', userId, { consent_id: result.consent_id, mode });
  return result;
};

const fetchPortfolioData = async (consentId, userId) => {
  const mode   = process.env.AA_MODE || 'mock';
  const result = mode === 'real'
    ? await realFetchFIData(consentId, userId)
    : await mockFetchFIData(consentId, userId);

  audit('AA_DATA_FETCHED', userId, { consent_id: consentId, mode });
  return result;
};

module.exports = { createAAConsent, fetchPortfolioData };
