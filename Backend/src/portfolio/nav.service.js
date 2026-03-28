const axios = require('axios');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// NAV SERVICE
//
// Two NAV sources:
//
// 1. AMFI bulk file (primary — production path)
//    URL: https://www.amfiindia.com/spages/NAVAll.txt
//    Keyed by ISIN. Updated daily after 11pm.
//    Used when real ISINs come from AA in production.
//
// 2. mfapi.in per-scheme-code (fallback)
//    URL: https://api.mfapi.in/mf/{scheme_code}
//    Used when ISIN not found in AMFI bulk file.
//    This covers mock mode (mock ISINs ≠ AMFI ISINs)
//    and any edge cases (new funds, direct plans, etc.)
//    Always returns live NAVs.
//
// Production switch: just set AA_MODE=real.
// The NAV lookup chain works identically for both modes.
// ─────────────────────────────────────────────────────────────

// ── FETCH ALL NAVs FROM AMFI BULK FILE ───────────────────────
const fetchAMFINavs = async () => {
  try {
    logger.info('📊 Fetching NAVs from AMFI...');
    const response = await axios.get(
      process.env.AMFI_NAV_URL || 'https://www.amfiindia.com/spages/NAVAll.txt',
      { timeout: 30000, responseType: 'text' }
    );
    const navMap = parseAMFIData(response.data);
    logger.info(`✅ AMFI NAV fetch complete. ${Object.keys(navMap).length} schemes loaded.`);
    return navMap;
  } catch (err) {
    logger.error('AMFI NAV fetch failed:', err.message);
    throw new Error(`AMFI NAV fetch failed: ${err.message}`);
  }
};

// ── PARSE AMFI TEXT FORMAT ────────────────────────────────────
// Format: SchemeCode;ISIN Growth;ISIN DivReinvest;SchemeName;NAV;Date
const parseAMFIData = (rawText) => {
  const navMap = {};
  const lines  = rawText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Scheme Code') ||
        trimmed.startsWith('Open Ended') || trimmed.startsWith('Close Ended')) continue;

    const parts = trimmed.split(';');
    if (parts.length < 6) continue;

    const schemeCode  = parts[0]?.trim();
    const isinGrowth  = parts[1]?.trim();
    const isinDivRein = parts[2]?.trim();
    const schemeName  = parts[3]?.trim();
    const nav         = parseFloat(parts[4]?.trim());
    const navDate     = parts[5]?.trim();

    if (!schemeCode || isNaN(nav) || nav <= 0) continue;

    if (isinGrowth && isinGrowth !== 'N.A.' && isinGrowth.length === 12) {
      navMap[isinGrowth] = { nav, scheme_name: schemeName, nav_date: navDate, scheme_code: schemeCode };
    }
    if (isinDivRein && isinDivRein !== 'N.A.' && isinDivRein.length === 12) {
      navMap[isinDivRein] = { nav, scheme_name: schemeName, nav_date: navDate, scheme_code: schemeCode };
    }
  }
  return navMap;
};

// ── FETCH NAVs FROM MFAPI.IN BY SCHEME CODES ─────────────────
// Fallback when AMFI ISIN lookup misses (mock mode, new funds, etc.)
// Fetches in parallel — typically ~200ms per request, all done concurrently.
const getNavsBySchemeCode = async (schemeCodes) => {
  if (!schemeCodes?.length) return {};

  const today   = new Date().toISOString().split('T')[0];
  const navMap  = {}; // scheme_code → nav

  // Check DB cache first
  const cached = await query(
    `SELECT scheme_code_ref, nav_value FROM nav_history
     WHERE scheme_code_ref = ANY($1) AND nav_date = $2`,
    [schemeCodes.map(String), today]
  ).catch(() => ({ rows: [] }));

  cached.rows.forEach(row => {
    navMap[row.scheme_code_ref] = parseFloat(row.nav_value);
  });

  const uncached = schemeCodes.filter(sc => !navMap[sc]);

  if (uncached.length > 0) {
    logger.info(`📡 Fetching ${uncached.length} NAVs from mfapi.in by scheme code...`);

    const results = await Promise.allSettled(
      uncached.map(sc =>
        axios.get(`https://api.mfapi.in/mf/${sc}`, { timeout: 8000 })
          .then(r => {
            const nav = parseFloat(r.data?.data?.[0]?.nav || 0);
            return nav > 0 ? { sc, nav, name: r.data?.meta?.scheme_name } : null;
          })
          .catch(() => null)
      )
    );

    // Build map and cache
    for (let i = 0; i < uncached.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled' && result.value) {
        const { sc, nav, name } = result.value;
        navMap[sc] = nav;
        // Cache in DB
        query(
          `INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value, scheme_code_ref)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $4`,
          [`MFAPI_${sc}`, name || `Scheme ${sc}`, today, nav, String(sc)]
        ).catch(() => {}); // cache failures are non-fatal
      }
    }

    const fetched = uncached.filter(sc => navMap[sc]).length;
    logger.info(`✅ mfapi.in: ${fetched}/${uncached.length} NAVs fetched`);
  }

  return navMap;
};

// ── BULK NAV FETCH FOR PORTFOLIO ──────────────────────────────
// Primary: AMFI by ISIN (production — works with real ISINs from AA)
// Fallback: mfapi.in by scheme_code (mock + edge cases)
// Returns: { [isin]: nav_value }
const getNavsForPortfolio = async (isins, schemeCodeMap = {}) => {
  const today  = new Date().toISOString().split('T')[0];
  const navMap = {};

  // 1. DB cache check by ISIN
  const cached = await query(
    'SELECT isin, nav_value FROM nav_history WHERE isin = ANY($1) AND nav_date = $2',
    [isins, today]
  ).catch(() => ({ rows: [] }));

  cached.rows.forEach(row => { navMap[row.isin] = parseFloat(row.nav_value); });

  const uncachedIsins = isins.filter(isin => !navMap[isin]);

  // 2. AMFI bulk file for uncached ISINs (production path)
  if (uncachedIsins.length > 0) {
    try {
      logger.info(`Fetching ${uncachedIsins.length} uncached NAVs from AMFI...`);
      const amfiData = await fetchAMFINavs();

      for (const isin of uncachedIsins) {
        if (amfiData[isin]) {
          navMap[isin] = amfiData[isin].nav;
          // Cache
          query(
            `INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $4`,
            [isin, amfiData[isin].scheme_name, today, amfiData[isin].nav]
          ).catch(() => {});
        }
      }
    } catch (err) {
      // AMFI fetch failed — will fall through to mfapi.in fallback below
      logger.warn('AMFI bulk fetch failed, will use mfapi.in fallback:', err.message);
    }
  }

  // 3. mfapi.in fallback by scheme_code for any still-missing ISINs
  // schemeCodeMap: { [isin]: scheme_code } — populated by portfolio.service.js
  const stillMissing = isins.filter(isin => !navMap[isin]);
  if (stillMissing.length > 0 && Object.keys(schemeCodeMap).length > 0) {
    logger.info(`${stillMissing.length} ISINs not in AMFI, trying mfapi.in fallback...`);

    const missingSchemes = {};
    for (const isin of stillMissing) {
      const sc = schemeCodeMap[isin];
      if (sc) missingSchemes[sc] = isin; // scheme_code → isin
    }

    if (Object.keys(missingSchemes).length > 0) {
      const scNavs = await getNavsBySchemeCode(Object.keys(missingSchemes).map(Number));
      for (const [sc, isin] of Object.entries(missingSchemes)) {
        if (scNavs[sc]) {
          navMap[isin] = scNavs[sc];
        }
      }
    }
  }

  return navMap; // { [isin]: nav_value }
};

// ── GET PEAK NAV (for drawdown calculation) ───────────────────
const getPeakNAV = async (isin, lookbackDays = 365) => {
  const result = await query(`
    SELECT MAX(nav_value) as peak_nav, MIN(nav_value) as lowest_nav
    FROM nav_history
    WHERE isin = $1 AND nav_date >= CURRENT_DATE - INTERVAL '${lookbackDays} days'
  `, [isin]);

  return {
    peak_nav:   parseFloat(result.rows[0]?.peak_nav) || null,
    lowest_nav: parseFloat(result.rows[0]?.lowest_nav) || null,
  };
};

module.exports = { fetchAMFINavs, getNavForISIN: getNavsBySchemeCode, getNavsForPortfolio, getNavsBySchemeCode, getPeakNAV };
