// ─────────────────────────────────────────────────────────────
// FUND CLASSIFIER
// Maps ISIN/scheme names to fund categories
// and returns the confirmed LTV caps
// ─────────────────────────────────────────────────────────────

// ── LTV CAPS (confirmed by founder) ──────────────────────────
const LTV_CAPS = {
  // Equity funds
  EQUITY_LARGE_CAP:    0.40,
  EQUITY_MID_CAP:      0.30,
  EQUITY_SMALL_CAP:    0.25,
  EQUITY_FLEXI_CAP:    0.35,
  EQUITY_ELSS:         0.40, // same as large cap (usually large cap heavy)
  INDEX_FUND:          0.40, // tracks large cap index
  ETF:                 0.40, // usually index-based

  // Debt funds
  DEBT_LIQUID:         0.80,
  DEBT_OVERNIGHT:      0.80,
  DEBT_SHORT_DUR:      0.80,
  DEBT_MEDIUM_DUR:     0.80,
  DEBT_LONG_DUR:       0.80,
  DEBT_CORPORATE:      0.80,
  DEBT_GILT:           0.80,
  DEBT_CREDIT_RISK:    0.65, // higher risk debt — lower LTV

  // Hybrid
  HYBRID_AGGRESSIVE:   0.35, // equity heavy
  HYBRID_BALANCED:     0.60,
  HYBRID_CONSERVATIVE: 0.70, // debt heavy

  // Others
  FOF_DOMESTIC:        0.35,
  FOF_INTERNATIONAL:   0.00, // not eligible (foreign securities)
  SECTORAL:            0.25, // same as small cap — high concentration risk
  THEMATIC:            0.25,
};

// ── INELIGIBLE FUND TYPES ─────────────────────────────────────
const INELIGIBLE_TYPES = [
  'FOF_INTERNATIONAL', // RBI restriction on foreign securities
];

// ── CLASSIFY FUND FROM SCHEME NAME ───────────────────────────
// Used as fallback when AA doesn't return scheme_type
const classifyFromSchemeName = (schemeName) => {
  const name = schemeName.toUpperCase();

  // Debt funds (check first — higher LTV, want to catch these)
  if (name.includes('LIQUID'))        return 'DEBT_LIQUID';
  if (name.includes('OVERNIGHT'))     return 'DEBT_OVERNIGHT';
  if (name.includes('ULTRA SHORT'))   return 'DEBT_SHORT_DUR';
  if (name.includes('SHORT TERM') || name.includes('SHORT DURATION')) return 'DEBT_SHORT_DUR';
  if (name.includes('MEDIUM TERM') || name.includes('MEDIUM DURATION')) return 'DEBT_MEDIUM_DUR';
  if (name.includes('LONG TERM') || name.includes('LONG DURATION')) return 'DEBT_LONG_DUR';
  if (name.includes('GILT'))          return 'DEBT_GILT';
  if (name.includes('CORPORATE BOND')) return 'DEBT_CORPORATE';
  if (name.includes('CREDIT RISK'))   return 'DEBT_CREDIT_RISK';
  if (name.includes('BANKING & PSU') || name.includes('BANKING AND PSU')) return 'DEBT_CORPORATE';
  if (name.includes('MONEY MARKET'))  return 'DEBT_SHORT_DUR';
  if (name.includes('FLOATING RATE')) return 'DEBT_SHORT_DUR';

  // Hybrid funds
  if (name.includes('AGGRESSIVE HYBRID') || name.includes('EQUITY SAVINGS')) return 'HYBRID_AGGRESSIVE';
  if (name.includes('BALANCED HYBRID') || name.includes('BALANCED ADVANTAGE')) return 'HYBRID_BALANCED';
  if (name.includes('CONSERVATIVE HYBRID')) return 'HYBRID_CONSERVATIVE';
  if (name.includes('MULTI ASSET'))   return 'HYBRID_BALANCED';
  if (name.includes('ARBITRAGE'))     return 'HYBRID_CONSERVATIVE';

  // Index / ETF
  if (name.includes('INDEX') || name.includes('NIFTY') || name.includes('SENSEX')) return 'INDEX_FUND';
  if (name.includes('ETF'))           return 'ETF';

  // ELSS
  if (name.includes('ELSS') || name.includes('TAX SAVER') || name.includes('TAXSAVER')) return 'EQUITY_ELSS';

  // Sectoral / Thematic
  if (name.includes('PHARMA') || name.includes('TECHNOLOGY') || name.includes('BANKING') ||
      name.includes('INFRA') || name.includes('CONSUMPTION') || name.includes('ENERGY')) return 'SECTORAL';

  // International
  if (name.includes('INTERNATIONAL') || name.includes('GLOBAL') || name.includes('OVERSEAS') ||
      name.includes('US ') || name.includes('NASDAQ') || name.includes('S&P 500')) return 'FOF_INTERNATIONAL';

  // FOF
  if (name.includes('FUND OF FUND') || name.includes('FOF')) return 'FOF_DOMESTIC';

  // Equity (check last)
  if (name.includes('SMALL CAP') || name.includes('SMALLCAP')) return 'EQUITY_SMALL_CAP';
  if (name.includes('MID CAP') || name.includes('MIDCAP') || name.includes('EMERGING')) return 'EQUITY_MID_CAP';
  if (name.includes('LARGE CAP') || name.includes('LARGECAP') || name.includes('BLUECHIP') ||
      name.includes('LARGE & MID')) return 'EQUITY_LARGE_CAP';
  if (name.includes('FLEXI') || name.includes('MULTI CAP') || name.includes('MULTICAP')) return 'EQUITY_FLEXI_CAP';
  if (name.includes('FOCUSED'))       return 'EQUITY_FLEXI_CAP';

  // Default: treat as large cap equity (safest default)
  return 'EQUITY_LARGE_CAP';
};

// ── GET LTV FOR FUND ──────────────────────────────────────────
const getLTVForFund = (schemeType) => {
  return LTV_CAPS[schemeType] || LTV_CAPS['EQUITY_LARGE_CAP'];
};

// ── CHECK IF FUND IS ELIGIBLE ─────────────────────────────────
const isFundEligible = (schemeType, lockInDate) => {
  // International funds not eligible
  if (INELIGIBLE_TYPES.includes(schemeType)) {
    return { eligible: false, reason: 'INTERNATIONAL_FUND_NOT_ELIGIBLE' };
  }

  // ELSS lock-in check
  if (schemeType === 'EQUITY_ELSS' && lockInDate) {
    const lockIn = new Date(lockInDate);
    if (lockIn > new Date()) {
      return { eligible: false, reason: 'ELSS_LOCK_IN_ACTIVE' };
    }
  }

  return { eligible: true, reason: null };
};

// ── ASSET CLASS FROM SCHEME TYPE ──────────────────────────────
const getAssetClass = (schemeType) => {
  if (schemeType.startsWith('DEBT_'))   return 'DEBT';
  if (schemeType.startsWith('HYBRID_')) return 'HYBRID';
  if (schemeType === 'INDEX_FUND' || schemeType === 'ETF') return 'EQUITY';
  return 'EQUITY';
};

module.exports = {
  LTV_CAPS,
  classifyFromSchemeName,
  getLTVForFund,
  isFundEligible,
  getAssetClass,
  INELIGIBLE_TYPES,
};
