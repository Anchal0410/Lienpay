// ─────────────────────────────────────────────────────────────
// FUND CLASSIFIER
// Maps scheme names to fund categories and returns LTV caps.
//
// LTV RATES — confirmed from fund universe reference doc:
//   Large Cap        → 40%
//   Large & Mid Cap  → 35%
//   Mid Cap          → 40%
//   Small Cap        → 25%
//   Flexi Cap        → 35%
//   Index Funds      → 40%
// ─────────────────────────────────────────────────────────────

// ── LTV CAPS ──────────────────────────────────────────────────
const LTV_CAPS = {
  // ── EQUITY (from fund universe reference doc) ──────────────
  EQUITY_LARGE_CAP:     0.40,  // Large Cap
  EQUITY_LARGE_MID_CAP: 0.35,  // Large & Mid Cap
  EQUITY_MID_CAP:       0.40,  // Mid Cap   ← was 0.30, corrected to 0.40
  EQUITY_SMALL_CAP:     0.25,  // Small Cap
  EQUITY_FLEXI_CAP:     0.35,  // Flexi Cap
  EQUITY_ELSS:          0.40,  // Tax saver — treated as large cap heavy
  INDEX_FUND:           0.40,  // Index / ETF
  ETF:                  0.40,

  // ── DEBT ──────────────────────────────────────────────────
  DEBT_LIQUID:          0.80,
  DEBT_OVERNIGHT:       0.80,
  DEBT_SHORT_DUR:       0.80,
  DEBT_MEDIUM_DUR:      0.80,
  DEBT_LONG_DUR:        0.80,
  DEBT_CORPORATE:       0.80,
  DEBT_GILT:            0.80,
  DEBT_CREDIT_RISK:     0.65,  // Higher risk debt — lower LTV

  // ── HYBRID ────────────────────────────────────────────────
  HYBRID_AGGRESSIVE:    0.35,  // Equity heavy
  HYBRID_BALANCED:      0.60,
  HYBRID_CONSERVATIVE:  0.70,  // Debt heavy

  // ── OTHERS ────────────────────────────────────────────────
  FOF_DOMESTIC:         0.35,
  FOF_INTERNATIONAL:    0.00,  // Not eligible — foreign securities
  SECTORAL:             0.25,  // High concentration risk
  THEMATIC:             0.25,
};

// ── INELIGIBLE FUND TYPES ─────────────────────────────────────
const INELIGIBLE_TYPES = [
  'FOF_INTERNATIONAL',
];

// ── CLASSIFY FUND FROM SCHEME NAME ───────────────────────────
// Used when AA doesn't return scheme_type.
// Order matters — check more specific patterns before generic ones.
const classifyFromSchemeName = (schemeName) => {
  if (!schemeName) return 'EQUITY_LARGE_CAP';
  const name = schemeName.toUpperCase();

  // ── DEBT ────────────────────────────────────────────────────
  if (name.includes('LIQUID'))                                                         return 'DEBT_LIQUID';
  if (name.includes('OVERNIGHT'))                                                      return 'DEBT_OVERNIGHT';
  if (name.includes('ULTRA SHORT') || name.includes('ULTRASHORT'))                    return 'DEBT_SHORT_DUR';
  if (name.includes('SHORT TERM') || name.includes('SHORT DURATION'))                 return 'DEBT_SHORT_DUR';
  if (name.includes('MEDIUM TERM') || name.includes('MEDIUM DURATION'))               return 'DEBT_MEDIUM_DUR';
  if (name.includes('LONG TERM') || name.includes('LONG DURATION'))                   return 'DEBT_LONG_DUR';
  if (name.includes('GILT'))                                                           return 'DEBT_GILT';
  if (name.includes('CORPORATE BOND'))                                                 return 'DEBT_CORPORATE';
  if (name.includes('CREDIT RISK'))                                                    return 'DEBT_CREDIT_RISK';
  if (name.includes('BANKING & PSU') || name.includes('BANKING AND PSU'))             return 'DEBT_CORPORATE';
  if (name.includes('MONEY MARKET'))                                                   return 'DEBT_SHORT_DUR';
  if (name.includes('FLOATING RATE'))                                                  return 'DEBT_SHORT_DUR';

  // ── HYBRID ──────────────────────────────────────────────────
  if (name.includes('AGGRESSIVE HYBRID') || name.includes('EQUITY SAVINGS'))          return 'HYBRID_AGGRESSIVE';
  if (name.includes('BALANCED ADVANTAGE') || name.includes('DYNAMIC ASSET'))          return 'HYBRID_BALANCED';
  if (name.includes('BALANCED HYBRID'))                                                return 'HYBRID_BALANCED';
  if (name.includes('CONSERVATIVE HYBRID'))                                            return 'HYBRID_CONSERVATIVE';
  if (name.includes('MULTI ASSET'))                                                    return 'HYBRID_BALANCED';
  if (name.includes('ARBITRAGE'))                                                      return 'HYBRID_CONSERVATIVE';

  // ── INDEX / ETF ─────────────────────────────────────────────
  if (name.includes(' ETF') || name.startsWith('ETF'))                                return 'ETF';
  if (name.includes('INDEX') || name.includes('NIFTY') || name.includes('SENSEX') ||
      name.includes('NIFTY50') || name.includes('NIFTY 50'))                          return 'INDEX_FUND';

  // ── ELSS ────────────────────────────────────────────────────
  if (name.includes('ELSS') || name.includes('TAX SAVER') || name.includes('TAXSAVER')) return 'EQUITY_ELSS';

  // ── SECTORAL / THEMATIC ─────────────────────────────────────
  if (name.includes('PHARMA') || name.includes('TECHNOLOGY') || name.includes('IT FUND') ||
      name.includes('BANKING FUND') || name.includes('INFRA') ||
      name.includes('CONSUMPTION') || name.includes('ENERGY'))                        return 'SECTORAL';
  if (name.includes('THEMATIC') || name.includes('ESG') || name.includes('MOMENTUM')) return 'THEMATIC';

  // ── INTERNATIONAL / FOF ─────────────────────────────────────
  if (name.includes('INTERNATIONAL') || name.includes('GLOBAL') ||
      name.includes('OVERSEAS') || name.includes('NASDAQ') ||
      name.includes('S&P 500') || name.includes('US EQUITY'))                         return 'FOF_INTERNATIONAL';
  if (name.includes('FUND OF FUND') || name.includes('FOF'))                          return 'FOF_DOMESTIC';

  // ── EQUITY — ordered from most specific to least ─────────────
  // LARGE & MID must come BEFORE LARGE CAP and MID CAP checks
  if (name.includes('LARGE & MID') || name.includes('LARGE AND MID') ||
      name.includes('LARGE & MIDCAP') || name.includes('LARGE AND MIDCAP'))           return 'EQUITY_LARGE_MID_CAP';

  if (name.includes('SMALL CAP') || name.includes('SMALLCAP'))                        return 'EQUITY_SMALL_CAP';
  if (name.includes('MID CAP') || name.includes('MIDCAP') ||
      name.includes('MID-CAP'))                                                        return 'EQUITY_MID_CAP';
  if (name.includes('LARGE CAP') || name.includes('LARGECAP') ||
      name.includes('LARGE-CAP') || name.includes('BLUECHIP'))                        return 'EQUITY_LARGE_CAP';
  if (name.includes('FLEXI CAP') || name.includes('FLEXICAP') ||
      name.includes('MULTI CAP') || name.includes('MULTICAP') ||
      name.includes('FOCUSED'))                                                        return 'EQUITY_FLEXI_CAP';

  // Default — treat as large cap equity (safest/most conservative)
  return 'EQUITY_LARGE_CAP';
};

// ── GET LTV FOR FUND ──────────────────────────────────────────
const getLTVForFund = (schemeType) => {
  return LTV_CAPS[schemeType] !== undefined
    ? LTV_CAPS[schemeType]
    : LTV_CAPS['EQUITY_LARGE_CAP'];
};

// ── CHECK IF FUND IS ELIGIBLE ─────────────────────────────────
const isFundEligible = (schemeType, lockInDate) => {
  if (INELIGIBLE_TYPES.includes(schemeType)) {
    return { eligible: false, reason: 'INTERNATIONAL_FUND_NOT_ELIGIBLE' };
  }
  if (schemeType === 'EQUITY_ELSS' && lockInDate) {
    if (new Date(lockInDate) > new Date()) {
      return { eligible: false, reason: 'ELSS_LOCK_IN_ACTIVE' };
    }
  }
  return { eligible: true, reason: null };
};

// ── ASSET CLASS FROM SCHEME TYPE ──────────────────────────────
const getAssetClass = (schemeType) => {
  if (schemeType?.startsWith('DEBT_'))         return 'DEBT';
  if (schemeType?.startsWith('HYBRID_'))       return 'HYBRID';
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
