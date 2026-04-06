import { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { getCreditStatus } from '../api/client'

// ─────────────────────────────────────────────────────────────
// RISK STATE CONTEXT
//
// Single source of truth for all risk-related state:
//   - Credit line data (from backend on load)
//   - Outstanding / available (updated as user spends/repays)
//   - Market drop simulation (for secret debug panel)
//   - LTV ratio (derived from outstanding + effective portfolio value)
//   - Risk state (derived from LTV thresholds)
//
// THRESHOLDS:
//   < 80%  → healthy   (green, UPI active)
//   80–89% → watch     (amber, UPI frozen by LienPay)
//   90–94% → action    (orange, margin call territory)
//   ≥ 95%  → critical  (red, NPA risk)
//
// Note: UPI freeze at 80% is a LienPay product rule (not credit decision)
// ─────────────────────────────────────────────────────────────

const RiskStateContext = createContext(null)

// ── RISK STATE DERIVATION ─────────────────────────────────────
function computeRiskState(ltvRatio) {
  if (ltvRatio >= 95) return 'critical'
  if (ltvRatio >= 90) return 'action'
  if (ltvRatio >= 80) return 'watch'    // UPI freeze threshold
  return 'healthy'
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

export function RiskStateProvider({ children }) {
  // ── Backend-sourced state ────────────────────────────────────
  const [creditAccount, setCreditAccount] = useState(null)
  const [loading, setLoading] = useState(true)

  // ── Source of truth for spending ────────────────────────────
  const [usedAmount, setUsedAmount] = useState(0)

  // ── Market simulation (secret panel) ─────────────────────────
  const [marketDrop, setMarketDrop] = useState(0)

  // ── Derived: core values ─────────────────────────────────────
  const totalLimit     = useMemo(() => parseFloat(creditAccount?.credit_limit || 0), [creditAccount])
  const portfolioValue = useMemo(() => parseFloat(creditAccount?.portfolio_value || 0), [creditAccount])

  const outstanding    = useMemo(() => clamp(usedAmount, 0, totalLimit), [usedAmount, totalLimit])
  const availableLimit = useMemo(() => clamp(totalLimit - outstanding, 0, totalLimit), [totalLimit, outstanding])

  // Effective portfolio value adjusts with simulated market drop
  const effectivePortfolioValue = useMemo(() => {
    return Math.max(Math.round(portfolioValue * (1 - marketDrop / 100)), 0)
  }, [portfolioValue, marketDrop])

  // LTV = outstanding / effective portfolio value
  // (outstanding stays same; if market drops, LTV rises automatically)
  const ltvRatio = useMemo(() => {
    if (!effectivePortfolioValue || effectivePortfolioValue <= 0) return 0
    // Use max eligible credit (portfolio value × 40% LTV cap) as denominator
    const maxEligible = effectivePortfolioValue * 0.40
    if (maxEligible <= 0) return 0
    return parseFloat(((outstanding / maxEligible) * 100).toFixed(1))
  }, [outstanding, effectivePortfolioValue])

  const riskState = useMemo(() => computeRiskState(ltvRatio), [ltvRatio])

  // ── UPI status (driven by LTV) ───────────────────────────────
  const upiActive = useMemo(() => {
    // UPI frozen at 80% LTV by LienPay (product rule)
    // Also frozen if backend says so (notorious fund freeze etc)
    if (riskState !== 'healthy') return false
    return creditAccount?.upi_active ?? true
  }, [riskState, creditAccount])

  // ── Load from backend on mount ───────────────────────────────
  useEffect(() => {
    getCreditStatus()
      .then(res => {
        const account = res?.data || res
        if (account) {
          setCreditAccount(account)
          setUsedAmount(parseFloat(account.outstanding || 0))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // ── Actions ──────────────────────────────────────────────────
  const spendFromLimit = (amount) => {
    setUsedAmount(prev => clamp(prev + amount, 0, totalLimit))
  }

  const repayToLimit = (amount) => {
    setUsedAmount(prev => clamp(prev - amount, 0, totalLimit))
  }

  const setOutstanding = (value) => {
    setUsedAmount(clamp(value, 0, totalLimit))
  }

  const setAvailableLimit = (value) => {
    setUsedAmount(clamp(totalLimit - value, 0, totalLimit))
  }

  const refreshAccount = () => {
    getCreditStatus()
      .then(res => {
        const account = res?.data || res
        if (account) {
          setCreditAccount(account)
          setUsedAmount(parseFloat(account.outstanding || 0))
        }
      })
      .catch(() => {})
  }

  const value = {
    // State
    creditAccount,
    loading,
    riskState,
    upiActive,

    // Credit values
    totalLimit,
    outstanding,
    availableLimit,
    portfolioValue,
    effectivePortfolioValue,
    ltvRatio,
    ltvCap: 40,

    // APR info
    apr:        parseFloat(creditAccount?.apr || 12),
    aprProduct: creditAccount?.apr_product || 'STANDARD',

    // Actions
    spendFromLimit,
    repayToLimit,
    setOutstanding,
    setAvailableLimit,
    refreshAccount,

    // Market simulation
    marketDrop,
    setMarketDrop,
  }

  return (
    <RiskStateContext.Provider value={value}>
      {children}
    </RiskStateContext.Provider>
  )
}

export function useRiskState() {
  const ctx = useContext(RiskStateContext)
  if (!ctx) throw new Error('useRiskState must be used inside RiskStateProvider')
  return ctx
}

export default RiskStateContext
