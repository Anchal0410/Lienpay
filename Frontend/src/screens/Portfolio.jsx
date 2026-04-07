import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPortfolioSummary, getLTVHealth, getPledgeStatus, initiatePledge, confirmPledgeOTP, notifyNBFC } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}
const formatLtv = (raw) => {
  if (!raw) return '—'
  if (typeof raw === 'string' && raw.includes('%')) return raw
  const num = parseFloat(raw)
  return num > 1 ? `${num.toFixed(0)}%` : `${(num * 100).toFixed(0)}%`
}
const SCHEME_COLORS = {
  EQUITY_LARGE_CAP: 'var(--jade)', EQUITY_MID_CAP: '#C9A449',
  EQUITY_LARGE_MID_CAP: '#8B7BD4', EQUITY_SMALL_CAP: '#EF4444',
  EQUITY_FLEXI_CAP: '#8B7BD4', DEBT_SHORT_DUR: '#3B82F6',
  DEBT_LIQUID: '#06B6D4', HYBRID_BALANCED: '#F59E0B',
}

export default function Portfolio() {
  const { portfolio, setPortfolio, ltvHealth, setLTVHealth, creditAccount } = useStore()
  const [loading, setLoading]             = useState(!portfolio)
  const [pledges, setPledges]             = useState([])
  const [showPledgeMore, setShowPledgeMore] = useState(false)
  const [pledging, setPledging]           = useState(false)
  const [hideValues, setHideValues]       = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [portfolioRes, ltvRes, pledgeRes] = await Promise.all([
          getPortfolioSummary(),
          getLTVHealth().catch(() => ({ data: null })),
          getPledgeStatus().catch(() => ({ data: { pledges: [] } })),
        ])
        setPortfolio(portfolioRes.data)
        if (ltvRes.data) setLTVHealth(ltvRes.data)
        setPledges(pledgeRes.data?.pledges || [])
      } catch (err) {
        // portfolio may not be linked yet
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const holdings    = portfolio?.holdings || []
  const ltv         = ltvHealth
  const ltvRatio    = parseFloat(ltv?.ltv_ratio ?? ltv?.ltv ?? 0)
  const outstanding = parseFloat(creditAccount?.outstanding || 0)
  const availableCredit = parseFloat(creditAccount?.available_credit || 0)
  const creditLimit = parseFloat(creditAccount?.credit_limit || 0)

  const pledgeMap = {}
  pledges.forEach(p => { pledgeMap[p.folio_number] = p })
  const isPledged = (folio) => pledgeMap[folio]?.status === 'ACTIVE'

  const pledgedHoldings   = holdings.filter(h => isPledged(h.folio_number))
  const unpledgedEligible = holdings.filter(h => !isPledged(h.folio_number) && h.is_eligible)

  const pledgedValue = pledgedHoldings.reduce((s, h) => s + parseFloat(h.value_at_fetch || 0), 0)
  const totalValue   = parseFloat(portfolio?.summary?.total_value || 0)

  // LTV display
  const displayLtvRatio = ltvRatio > 0 ? ltvRatio
    : (creditLimit > 0 && outstanding > 0 ? (outstanding / creditLimit) * 100 : 0)
  const ltvStatus = displayLtvRatio >= 95 ? 'CRITICAL' : displayLtvRatio >= 90 ? 'ACTION' : displayLtvRatio >= 80 ? 'WATCH' : 'HEALTHY'
  const ltvColor  = ltvStatus === 'CRITICAL' ? '#EF4444' : ltvStatus === 'ACTION' ? '#F97316' : ltvStatus === 'WATCH' ? '#F59E0B' : 'var(--jade)'

  // Handle pledging from modal
  const handlePledgeMore = async (holding) => {
    setPledging(true)
    try {
      const res = await initiatePledge([{ folio_number: holding.folio_number }])
      const pledge = res.data.pledges?.[0]
      if (pledge) {
        await confirmPledgeOTP(pledge.pledge_id, pledge.rta === 'CAMS' ? '123456' : '654321')
        await notifyNBFC([pledge.pledge_id])
        toast.success(`${holding.scheme_name?.split(' - ')[0]} pledged!`)
        const pledgeRes = await getPledgeStatus()
        setPledges(pledgeRes.data?.pledges || [])
        // If no more unpledged, close modal
        if (unpledgedEligible.length <= 1) setShowPledgeMore(false)
      }
    } catch (err) {
      toast.error(err.message || 'Failed to pledge fund')
    } finally {
      setPledging(false)
    }
  }

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 0' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
              style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, marginBottom: 2 }}>Portfolio</motion.h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Collateral health</p>
          </div>
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileTap={{ scale: 0.88 }}
            onClick={() => setHideValues(h => !h)}
            style={{ width: 38, height: 38, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4, cursor: 'pointer' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={hideValues ? 'var(--jade)' : 'var(--text-muted)'} strokeWidth="2">
              {hideValues
                ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></>
                : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
              }
            </svg>
          </motion.button>
        </div>

        {/* Summary card */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '20px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.5px' }}>PLEDGED VALUE</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 28 }}>
                {hideValues ? '₹ ••••' : fmtL(pledgedValue > 0 ? pledgedValue : totalValue)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.5px' }}>AVAILABLE CREDIT</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--jade)' }}>
                {hideValues ? '₹ ••••' : fmtL(availableCredit)}
              </p>
            </div>
          </div>

          {/* LTV Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>LTV RATIO</p>
              <p style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: ltvColor }}>
                {outstanding <= 0 ? '0.0%' : `${displayLtvRatio.toFixed(1)}%`}
              </p>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden', position: 'relative', marginBottom: 6 }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(245,158,11,0.4)' }} />
              <div style={{ position: 'absolute', left: '80%', top: 0, bottom: 0, width: 1, background: 'rgba(239,68,68,0.5)' }} />
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(outstanding > 0 ? displayLtvRatio : 0, 100)}%` }} transition={{ duration: 1.2, ease: 'easeOut' }}
                style={{ height: '100%', background: ltvStatus === 'CRITICAL' || ltvStatus === 'ACTION' ? 'linear-gradient(90deg, #EF4444, #DC2626)' : ltvStatus === 'WATCH' ? 'linear-gradient(90deg, var(--jade), #F59E0B)' : 'linear-gradient(90deg, var(--jade), #00A878)', borderRadius: 3 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)' }}>0%</p>
              <p style={{ fontSize: 9, color: '#F59E0B' }}>50% Govt limit</p>
              <p style={{ fontSize: 9, color: '#EF4444' }}>80% UPI freeze</p>
            </div>
          </div>
        </motion.div>

        {/* Collateral status */}
        {(ltvStatus === 'HEALTHY' || outstanding <= 0) ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,212,161,0.06)', border: '1px solid rgba(0,212,161,0.12)', borderRadius: 14, padding: '12px 16px', marginBottom: 16 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>Collateral stable — Your pledged holdings are supporting the account comfortably.</p>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ background: ltvColor === '#EF4444' ? 'var(--red-dim)' : 'var(--amber-dim)', border: `1px solid ${ltvColor === '#EF4444' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)'}`, borderRadius: 14, padding: '12px 16px', marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: ltvColor, marginBottom: 2 }}>
              {ltvStatus === 'CRITICAL' ? '🔴 Critical — Action Required' : ltvStatus === 'ACTION' ? '🟠 Action Required' : '🟡 Watch — Portfolio Pressure'}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ltv?.message || 'Consider adding collateral or repaying to restore health.'}</p>
          </motion.div>
        )}

        {/* ── PLEDGED FUNDS — only these shown ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '1.5px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
            PLEDGED FUNDS ({pledgedHoldings.length})
          </p>
          {unpledgedEligible.length > 0 && (
            <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {unpledgedEligible.length} more eligible
            </p>
          )}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1, 2, 3].map(i => <div key={i} className="shimmer" style={{ height: 80, borderRadius: 14 }} />)}
          </div>
        ) : pledgedHoldings.length === 0 ? (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '32px 24px', textAlign: 'center', marginBottom: 16 }}>
            <p style={{ fontSize: 32, marginBottom: 10 }}>🔒</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No pledged funds</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Complete onboarding to pledge your mutual funds</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {pledgedHoldings.map((holding, i) => {
              const pct        = pledgedValue > 0 ? ((parseFloat(holding.value_at_fetch || 0) / pledgedValue) * 100).toFixed(1) : null
              const schemeColor = SCHEME_COLORS[holding.scheme_type] || 'var(--text-secondary)'

              return (
                <motion.div key={holding.folio_number}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  style={{ background: 'var(--bg-surface)', border: '1px solid rgba(0,212,161,0.18)', borderRadius: 16, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--jade)', borderRadius: '3px 0 0 3px' }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingLeft: 8 }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 5, lineHeight: 1.3 }}>{holding.scheme_name}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 9, color: '#000', background: schemeColor, padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                          {holding.scheme_type?.replace(/_/g, ' ') || 'FUND'}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--jade)', background: 'rgba(0,212,161,0.1)', border: '1px solid rgba(0,212,161,0.3)', padding: '1px 7px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>PLEDGED</span>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{holding.rta === 'CAMS' ? 'MF CENTRAL' : 'KFINTECH'}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                        {hideValues ? '••••' : fmtL(holding.value_at_fetch || 0)}
                      </p>
                      {pct && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <div style={{ width: 50, height: 2, background: 'var(--bg-elevated)', borderRadius: 1, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(parseFloat(pct), 100)}%`, height: '100%', background: 'var(--jade)' }} />
                          </div>
                          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{pct}%</p>
                        </div>
                      )}
                      <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>LTV {formatLtv(holding.ltv_cap)}</p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* ── Pledge More Funds button ── */}
        {unpledgedEligible.length > 0 && (
          <motion.button initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            whileTap={{ scale: 0.97 }} onClick={() => setShowPledgeMore(true)}
            style={{ width: '100%', height: 52, borderRadius: 16, background: 'rgba(0,212,161,0.08)', border: '1.5px solid rgba(0,212,161,0.25)', color: 'var(--jade)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>+</span>
            Pledge More Funds ({unpledgedEligible.length} available)
          </motion.button>
        )}

        <div style={{ height: 8 }} />
      </div>

      {/* ── Pledge More modal (bottom sheet) ── */}
      <AnimatePresence>
        {showPledgeMore && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200 }}
            onClick={() => setShowPledgeMore(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--bg-elevated)', borderRadius: '24px 24px 0 0', padding: '20px 20px 44px', maxHeight: '80vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>PLEDGE MORE FUNDS</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{unpledgedEligible.length} eligible mutual funds</p>
                </div>
                <motion.button whileTap={{ scale: 0.88 }} onClick={() => setShowPledgeMore(false)}
                  style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-muted)', cursor: 'pointer' }}>×</motion.button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unpledgedEligible.map((h, i) => {
                  const ltv     = parseFloat(h.ltv_cap > 1 ? h.ltv_cap / 100 : h.ltv_cap || 0.40)
                  const value   = parseFloat(h.value_at_fetch || 0)
                  const eligible = Math.round(value * ltv)
                  const color   = SCHEME_COLORS[h.scheme_type] || 'var(--jade)'

                  return (
                    <motion.div key={h.folio_number}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{h.scheme_name}</p>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <span style={{ fontSize: 9, color: '#000', background: color, padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{h.scheme_type?.replace(/_/g, ' ')}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{h.rta === 'CAMS' ? 'MF CENTRAL' : 'KFINTECH'}</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{fmtL(value)}</p>
                          <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)' }}>{(ltv * 100).toFixed(0)}% LTV → {fmtL(eligible)}</p>
                        </div>
                      </div>

                      <motion.button whileTap={{ scale: 0.97 }} disabled={pledging}
                        onClick={() => handlePledgeMore(h)}
                        style={{ width: '100%', height: 40, borderRadius: 12, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer' }}>
                        {pledging ? 'Pledging…' : `Pledge This Fund → ${fmtL(eligible)} credit`}
                      </motion.button>
                    </motion.div>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
