const axios  = require('axios');
const { query }  = require('../../config/database');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// MF CENTRAL SERVICE
//
// MF Central is the Government of India's official mutual fund
// repository (mfcentral.com) — a joint initiative by CAMS and
// KFintech under SEBI regulations.
//
// It provides a single API for:
//   - Portfolio fetch (all folios, regardless of RTA)
//   - ISIN data (already embedded — no separate lookup needed)
//   - Pledge creation and management
//   - NAV data feed
//   - Notorious / watchlist fund flagging
//
// WHY MF CENTRAL INSTEAD OF CAMS/KFINTECH DIRECTLY:
//   - Single integration instead of two
//   - Officially endorsed by SEBI and government
//   - ISIN comes embedded in every response
//   - Pledge lien actions are handled via NBFC's MF Central credentials
//
// IMPORTANT RBI/LSP RULE:
//   LienPay as LSP only FETCHES portfolio data via MF Central.
//   All pledge creation, invocation, and release are done by the NBFC
//   using their own MF Central credentials.
//   LienPay provides the interface; NBFC executes.
//
// Mode: MF_CENTRAL_MODE=mock | real
// ─────────────────────────────────────────────────────────────

const BASE_URL = process.env.MF_CENTRAL_API_URL || 'https://api.mfcentral.com/v1';
const API_KEY  = process.env.MF_CENTRAL_API_KEY  || '';
const MODE     = () => process.env.MF_CENTRAL_MODE || 'mock';

// ── HTTP CLIENT ───────────────────────────────────────────────
const mfcClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key':    API_KEY,
    'X-Source':     'LienPay-LSP',
  },
  timeout: 15000,
});

// ── FETCH PORTFOLIO ───────────────────────────────────────────
/**
 * Fetch all mutual fund holdings for a user.
 * Returns full portfolio including ISIN (embedded in MF Central data).
 *
 * LienPay role: FETCH ONLY — pass data to NBFC, show to user.
 * No pledge or invocation actions here.
 *
 * @param {string} pan    - User's PAN (last 4 only for mock; full for real)
 * @param {string} mobile - User's mobile number
 * @returns {Array}       - Array of holding objects with ISIN included
 */
const fetchPortfolio = async (pan, mobile) => {
  if (MODE() === 'real') {
    try {
      const response = await mfcClient.post('/portfolio/fetch', {
        pan,
        mobile,
        consent: 'Y',
        fetch_type: 'FULL',
      });

      return normalizeMFCPortfolio(response.data.holdings || []);
    } catch (err) {
      logger.error('MF Central portfolio fetch failed:', err.message);
      throw new Error(`MF Central fetch failed: ${err.response?.data?.message || err.message}`);
    }
  }

  // MOCK — returns realistic test data with ISIN embedded
  return mockPortfolio(pan);
};

// ── FETCH NAVs ────────────────────────────────────────────────
/**
 * Fetch latest NAVs from MF Central for a list of ISINs.
 * Used by the daily cron job (nav.monitor.js).
 *
 * @param {Array} isins - Array of ISIN strings
 * @returns {Object}    - Map of { isin → navData }
 */
const fetchNAVsByISIN = async (isins) => {
  if (MODE() === 'real') {
    try {
      const response = await mfcClient.post('/nav/bulk', { isins });
      return (response.data.navs || []).reduce((map, item) => {
        map[item.isin] = {
          isin:       item.isin,
          nav:        parseFloat(item.nav),
          nav_date:   item.nav_date,
          scheme_name: item.scheme_name,
        };
        return map;
      }, {});
    } catch (err) {
      logger.error('MF Central NAV fetch failed:', err.message);
      // Fall back to AMFI public feed on error
      const { fetchAMFINavs } = require('./nav.service');
      return fetchAMFINavs();
    }
  }

  // Mock: return from AMFI public feed (which is free and real even in mock mode)
  const { fetchAMFINavs } = require('./nav.service');
  return fetchAMFINavs();
};

// ── FUND UNIVERSE VALIDATION ──────────────────────────────────
/**
 * Validate whether an ISIN is in LienPay's curated fund universe.
 * MF Central provides scheme categorization — we filter on that.
 *
 * @param {string} isin
 * @returns {Object|null} - Fund universe entry or null
 */
const validateFundEligibility = async (isin) => {
  const result = await query(
    'SELECT * FROM fund_universe WHERE isin = $1 AND is_eligible = true',
    [isin]
  ).catch(() => ({ rows: [] }));
  return result.rows[0] || null;
};

// ── NORMALIZE MF CENTRAL RESPONSE ────────────────────────────
const normalizeMFCPortfolio = (holdings) => {
  return holdings.map(h => ({
    folio_number:   h.folio_number || h.folio,
    isin:           h.isin,                    // MF Central embeds ISIN — no separate lookup
    scheme_name:    h.scheme_name || h.fund_name,
    amc_name:       h.amc_name || h.amc,
    scheme_type:    mapSchemeCategory(h.category || h.scheme_category),
    rta:            h.rta || 'MF_CENTRAL',
    units:          parseFloat(h.units || h.balance_units || 0),
    nav:            parseFloat(h.nav || h.latest_nav || 0),
    current_value:  parseFloat(h.current_value || h.market_value || 0),
    nav_date:       h.nav_date,
  }));
};

const mapSchemeCategory = (category = '') => {
  const c = category.toLowerCase();
  if (c.includes('large cap'))         return 'EQUITY_LARGE_CAP';
  if (c.includes('mid cap'))           return 'EQUITY_MID_CAP';
  if (c.includes('small cap'))         return 'EQUITY_SMALL_CAP';
  if (c.includes('flexi'))             return 'EQUITY_FLEXI_CAP';
  if (c.includes('index') || c.includes('etf')) return 'EQUITY_INDEX';
  if (c.includes('liquid'))            return 'DEBT_LIQUID';
  if (c.includes('short duration') || c.includes('short term')) return 'DEBT_SHORT_DUR';
  if (c.includes('hybrid') || c.includes('balanced')) return 'HYBRID_BALANCED';
  return 'OTHER';
};

// ── NOTORIOUS FUND CHECK ──────────────────────────────────────
/**
 * Check if any ISIN is flagged as notorious/watchlist by SEBI or AMFI.
 * MF Central exposes a SEBI-aligned watchlist.
 *
 * LienPay checks this:
 *   1. At pledge time — warn user before accepting pledge
 *   2. Daily via cron — if a previously clean fund gets flagged,
 *      notify all users who have pledged that fund
 *
 * @param {Array} isins
 * @returns {Array} - List of notorious fund ISINs
 */
const checkNotoriousFunds = async (isins) => {
  if (MODE() === 'real') {
    try {
      const response = await mfcClient.post('/funds/watchlist-check', { isins });
      return response.data.watchlist_hits || [];
    } catch (err) {
      logger.error('MF Central watchlist check failed:', err.message);
      return []; // Fail open — don't block user on API error
    }
  }

  // Mock: check our internal notorious_funds table
  if (!isins || isins.length === 0) return [];
  const result = await query(
    `SELECT isin, scheme_name, reason, flagged_at
     FROM notorious_funds
     WHERE isin = ANY($1) AND is_active = true`,
    [isins]
  ).catch(() => ({ rows: [] }));

  return result.rows;
};

// ── MOCK DATA ─────────────────────────────────────────────────
const mockPortfolio = (pan) => {
  // PAN ending in Z = empty portfolio for testing
  if (pan?.slice(-1) === 'Z') return [];

  return [
    {
      folio_number:  '1234567890',
      isin:          'INF179K01VW3',
      scheme_name:   'HDFC Flexi Cap Fund - Growth',
      amc_name:      'HDFC Mutual Fund',
      scheme_type:   'EQUITY_FLEXI_CAP',
      rta:           'MF_CENTRAL',
      units:         1250.456,
      nav:           400.23,
      current_value: 500345,
      nav_date:      new Date().toISOString().split('T')[0],
    },
    {
      folio_number:  '9876543210',
      isin:          'INF769K01010',
      scheme_name:   'Nippon India Large Cap Fund - Growth',
      amc_name:      'Nippon India Mutual Fund',
      scheme_type:   'EQUITY_LARGE_CAP',
      rta:           'MF_CENTRAL',
      units:         800.000,
      nav:           250.00,
      current_value: 200000,
      nav_date:      new Date().toISOString().split('T')[0],
    },
    {
      folio_number:  '1122334455',
      isin:          'INF200K01RO2',
      scheme_name:   'SBI Blue Chip Fund - Growth',
      amc_name:      'SBI Mutual Fund',
      scheme_type:   'EQUITY_LARGE_CAP',
      rta:           'MF_CENTRAL',
      units:         560.234,
      nav:           110.50,
      current_value: 61909,
      nav_date:      new Date().toISOString().split('T')[0],
    },
  ];
};

module.exports = {
  fetchPortfolio,
  fetchNAVsByISIN,
  validateFundEligibility,
  checkNotoriousFunds,
  normalizeMFCPortfolio,
};
