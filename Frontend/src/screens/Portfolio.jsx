import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPortfolioSummary, getLTVHealth, getPledgeStatus, initiatePledge, confirmPledgeOTP, notifyNBFC } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const fmtL = (n) => { const v = parseFloat(n || 0); return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` }
const formatLtv = (raw) => { if (!raw) return '—'; if (typeof raw === 'string' && raw.includes('%')) return raw; const num = parseFloat(raw); return num > 1 ? `${num.toFixed(0)}%` : `${(num * 100).toFixed(0)}%` }

// ── Always show "MF Central" regardless of RTA value ──────────
const rtaLabel = (rta) => {
  // CAMS operates the MF Central platform
  // KFintech is KFintech
  if (!rta) return 'MF Central'
  const r = rta.toString().toUpperCase()
  if (r === 'CAMS') return 'MF Central'
  if (r.includes('KFIN')) return 'KFintech'
  return 'MF Central'
}

// Fund category colors — all distinct, NO red (red = alarm signal, not appropriate for fund types)
// Palette: jade (green), teal, sky-blue, royal-blue, lavender, purple, gold, amber
const SCHEME_COLORS = {
  EQUITY_LARGE_CAP:     '#00D4A1',   // jade — large cap is the "flagship" category
  EQUITY_LARGE_MID_CAP: '#06B6D4',   // teal — between large and mid
  EQUITY_MID_CAP:       '#C9A449',   // gold — moderate growth
  EQUITY_SMALL_CAP:     '#F97316',   // orange — higher volatility, amber warning (not red)
  EQUITY_FLEXI_CAP:     '#8B7BD4',   // purple — flexible mandate
  DEBT_SHORT_DUR:       '#3B82F6',   // royal blue — short duration debt
  DEBT_LIQUID:          '#60A5FA',   // sky blue — liquid/overnight (safest)
  HYBRID_BALANCED:      '#A78BFA',   // lavender — balanced/hybrid
}

export default function Portfolio() {
  const { portfolio, setPortfolio, ltvHealth, setLTVHealth, creditAccount } = useStore()
  const [loading, setLoading]           = useState(!portfolio)
  const [pledges, setPledges]           = useState([])
  const [showPledgeMore, setShowPledgeMore] = useState(false)
  // ── FIX: per-fund loading state — tracks which folio is actively pledging ──
  const [pledgingFolio, setPledgingFolio] = useState(null)
  const [hideValues, setHideValues]     = useState(false)

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
      } catch (err) {} finally { setLoading(false) }
    }
    load()
  }, [])

  const holdings   = portfolio?.holdings || []
  const ltv        = ltvHealth
  const ltvRatio   = parseFloat(ltv?.ltv_ratio ?? ltv?.ltv ?? 0)
  const outstanding = parseFloat(creditAccount?.outstanding || 0)
  const creditLimit = parseFloat(creditAccount?.credit_limit || 0)
  const availableCredit = parseFloat(creditAccount?.available_credit || 0)

  const pledgeMap = {}; pledges.forEach(p => { pledgeMap[p.folio_number] = p })
  const isPledged = (folio) => pledgeMap[folio]?.status === 'ACTIVE'

  const pledgedHoldings   = holdings.filter(h => isPledged(h.folio_number))
  const unpledgedEligible = holdings.filter(h => !isPledged(h.folio_number) && h.is_eligible)
  const pledgedValue      = pledgedHoldings.reduce((s, h) => s + parseFloat(h.value_at_fetch || 0), 0)

  const displayLtvRatio = ltvRatio > 0 ? ltvRatio : (creditLimit > 0 && outstanding > 0 ? (outstanding / creditLimit) * 100 : 0)
  const ltvStatus = displayLtvRatio >= 95 ? 'CRITICAL' : displayLtvRatio >= 90 ? 'ACTION' : displayLtvRatio >= 80 ? 'WATCH' : 'HEALTHY'
  const ltvColor  = ltvStatus === 'CRITICAL' ? '#EF4444' : ltvStatus === 'ACTION' ? '#F97316' : ltvStatus === 'WATCH' ? '#F59E0B' : 'var(--jade)'

  const weightedLtvCap = pledgedHoldings.length > 0 ? (() => {
    const tot = pledgedHoldings.reduce((s, h) => s + parseFloat(h.value_at_fetch || 0), 0)
    if (tot === 0) return 0
    return pledgedHoldings.reduce((s, h) => {
      const raw = h.ltv_cap; const n = typeof raw === 'string' && raw.includes('%') ? parseFloat(raw) / 100 : (parseFloat(raw) > 1 ? parseFloat(raw) / 100 : parseFloat(raw || 0))
      return s + (n * parseFloat(h.value_at_fetch || 0))
    }, 0) / tot * 100
  })() : 0

  // ── FIX: pledge single fund — only that fund shows loading ──
  const handlePledgeMore = async (holding) => {
    if (pledgingFolio) return  // already pledging one
    setPledgingFolio(holding.folio_number)
    try {
      const res = await initiatePledge([{ folio_number: holding.folio_number }])
      const pledge = res.data.pledges?.[0]
      if (pledge) {
        await confirmPledgeOTP(pledge.pledge_id, pledge.rta === 'CAMS' ? '123456' : '654321')
        await notifyNBFC([pledge.pledge_id])
        toast.success(`${holding.scheme_name?.split(' - ')[0]} pledged!`)
        const pledgeRes = await getPledgeStatus(); setPledges(pledgeRes.data?.pledges || [])
        // Close modal only if all eligible are now pledged
        const stillUnpledged = holdings.filter(h => !isPledged(h.folio_number) && h.is_eligible && h.folio_number !== holding.folio_number)
        if (stillUnpledged.length === 0) setShowPledgeMore(false)
      }
    } catch (err) { toast.error(err.message || 'Failed to pledge') }
    finally { setPledgingFolio(null) }
  }

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 0' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <motion.h1 initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, marginBottom: 2 }}>Portfolio</motion.h1>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Collateral health</p>
          </div>
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} whileTap={{ scale: 0.88 }}
            onClick={() => setHideValues(h => !h)}
            style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4, cursor: 'pointer' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={hideValues ? 'var(--jade)' : 'var(--text-muted)'} strokeWidth="2">
              {hideValues ? <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></> : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}
            </svg>
          </motion.button>
        </div>

        {/* Summary card — Lovable style */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '18px 18px 14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>PLEDGED VALUE</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 26 }}>{hideValues ? '₹ ••••' : fmtL(pledgedValue > 0 ? pledgedValue : parseFloat(portfolio?.summary?.total_value || 0))}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 3 }}>AVAILABLE CREDIT</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--jade)' }}>{hideValues ? '₹ ••••' : fmtL(availableCredit)}</p>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>LTV RATIO</p>
              <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: ltvColor }}>{outstanding <= 0 ? '0.0%' : `${displayLtvRatio.toFixed(1)}%`}</p>
            </div>
            <div style={{ height: 5, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden', position: 'relative', marginBottom: 4 }}>
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(245,158,11,0.4)' }} />
              <div style={{ position: 'absolute', left: '80%', top: 0, bottom: 0, width: 1, background: 'rgba(239,68,68,0.5)' }} />
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(outstanding > 0 ? displayLtvRatio : 0, 100)}%` }} transition={{ duration: 1.2, ease: 'easeOut' }}
                style={{ height: '100%', background: ltvStatus === 'CRITICAL' || ltvStatus === 'ACTION' ? 'linear-gradient(90deg, #EF4444, #DC2626)' : ltvStatus === 'WATCH' ? 'linear-gradient(90deg, var(--jade), #F59E0B)' : 'linear-gradient(90deg, var(--jade), #00A878)', borderRadius: 3 }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 8, color: 'var(--text-muted)' }}>0%</p>
              <p style={{ fontSize: 8, color: '#F59E0B' }}>50% Watch zone</p>
              <p style={{ fontSize: 8, color: '#EF4444' }}>80% Margin call</p>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            {weightedLtvCap > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(0,212,161,0.07)', border: '1px solid rgba(0,212,161,0.14)', borderRadius: 7, padding: '3px 8px' }}>
                <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--jade)' }} />
                <span style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>LTV Cap: {weightedLtvCap.toFixed(0)}%</span>
              </div>
            )}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(0,212,161,0.06)', border: '1px solid rgba(0,212,161,0.12)', borderRadius: 7, padding: '3px 8px' }}>
              <span style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{pledgedHoldings.length} pledged</span>
            </div>
          </div>
        </motion.div>

        {/* Collateral status */}
        {ltvStatus === 'HEALTHY' || outstanding <= 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,212,161,0.05)', border: '1px solid rgba(0,212,161,0.1)', borderRadius: 13, padding: '10px 14px', marginBottom: 16 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>Collateral stable — portfolio supporting the account comfortably.</p>
          </div>
        ) : (
          <div style={{ background: ltvColor === '#EF4444' ? 'var(--red-dim)' : 'var(--amber-dim)', border: `1px solid ${ltvColor === '#EF4444' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)'}`, borderRadius: 13, padding: '10px 14px', marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: ltvColor, marginBottom: 1 }}>{ltvStatus === 'CRITICAL' ? 'Critical — Action Required' : ltvStatus === 'ACTION' ? 'Action Required' : 'Watch — Pressure Rising'}</p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ltv?.message || 'Consider adding collateral or repaying.'}</p>
          </div>
        )}

        {/* Pledged funds */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '1.5px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>PLEDGED FUNDS ({pledgedHoldings.length})</p>
          {unpledgedEligible.length > 0 && <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{unpledgedEligible.length} more eligible</p>}
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => <div key={i} className="shimmer" style={{ height: 80, borderRadius: 14 }} />)}
          </div>
        ) : pledgedHoldings.length === 0 ? (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '32px 24px', textAlign: 'center', marginBottom: 16 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No pledged funds</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Complete onboarding to pledge mutual funds</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {pledgedHoldings.map((holding, i) => {
              const pct = pledgedValue > 0 ? ((parseFloat(holding.value_at_fetch || 0) / pledgedValue) * 100).toFixed(1) : null
              const schemeColor = SCHEME_COLORS[holding.scheme_type] || 'var(--text-secondary)'
              return (
                <motion.div key={holding.folio_number} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                  style={{ background: 'var(--bg-surface)', border: '1px solid rgba(0,212,161,0.16)', borderRadius: 16, padding: '13px 15px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'var(--jade)', borderRadius: '3px 0 0 3px' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingLeft: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, lineHeight: 1.3 }}>{holding.scheme_name}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 8, color: '#000', background: schemeColor, padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{holding.scheme_type?.replace(/_/g, ' ')}</span>
                        <span style={{ fontSize: 8, color: 'var(--jade)', background: 'rgba(0,212,161,0.1)', border: '1px solid rgba(0,212,161,0.25)', padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>PLEDGED</span>
                        {/* ── FIX: use rtaLabel() helper ── */}
                        <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{rtaLabel(holding.rta)}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 10 }}>
                      <p style={{ fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{hideValues ? '••••' : fmtL(holding.value_at_fetch || 0)}</p>
                      {pct && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
                          <div style={{ width: 44, height: 2, background: 'var(--bg-elevated)', borderRadius: 1, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(parseFloat(pct), 100)}%`, height: '100%', background: 'var(--jade)' }} />
                          </div>
                          <p style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{pct}%</p>
                        </div>
                      )}
                      <p style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>LTV {formatLtv(holding.ltv_cap)}</p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* Pledge More button */}
        {unpledgedEligible.length > 0 && (
          <motion.button initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            whileTap={{ scale: 0.97 }} onClick={() => setShowPledgeMore(true)}
            style={{ width: '100%', height: 50, borderRadius: 16, background: 'rgba(0,212,161,0.07)', border: '1.5px solid rgba(0,212,161,0.22)', color: 'var(--jade)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Pledge More Funds ({unpledgedEligible.length} available)
          </motion.button>
        )}
        <div style={{ height: 8 }} />
      </div>

      {/* Pledge More modal */}
      <AnimatePresence>
        {showPledgeMore && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200 }}
            onClick={() => !pledgingFolio && setShowPledgeMore(false)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'var(--bg-elevated)', borderRadius: '24px 24px 0 0', padding: '20px 20px 44px', maxHeight: '78vh', overflowY: 'auto' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>PLEDGE MORE FUNDS</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{unpledgedEligible.length} eligible mutual funds</p>
                </div>
                <motion.button whileTap={{ scale: 0.88 }} onClick={() => { if (!pledgingFolio) setShowPledgeMore(false) }}
                  style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--bg-overlay)', border: '1px solid var(--border)', fontSize: 16, color: 'var(--text-muted)', cursor: 'pointer' }}>×</motion.button>
              </div>

              {/* Info banner */}
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '10px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600 }}>Tap any fund to pledge it individually — one at a time</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {unpledgedEligible.map((h, i) => {
                  const ltv = parseFloat(h.ltv_cap > 1 ? h.ltv_cap / 100 : h.ltv_cap || 0.40)
                  const value = parseFloat(h.value_at_fetch || 0)
                  const eligible = Math.round(value * ltv)
                  const color = SCHEME_COLORS[h.scheme_type] || 'var(--jade)'
                  // ── FIX: this specific fund is pledging ──
                  const isThisPledging = pledgingFolio === h.folio_number
                  const otherPledging  = pledgingFolio && pledgingFolio !== h.folio_number

                  return (
                    <motion.div key={h.folio_number} initial={{ opacity: 0, y: 5 }} animate={{ opacity: otherPledging ? 0.45 : 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      style={{ background: 'var(--bg-surface)', border: `1px solid ${isThisPledging ? 'var(--jade-border)' : 'var(--border)'}`, borderRadius: 15, padding: '13px 14px', transition: 'opacity 0.2s' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{h.scheme_name}</p>
                          <div style={{ display: 'flex', gap: 5 }}>
                            <span style={{ fontSize: 8, color: '#000', background: color, padding: '1px 5px', borderRadius: 3, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{h.scheme_type?.replace(/_/g, ' ')}</span>
                            {/* ── FIX: use rtaLabel() ── */}
                            <span style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{rtaLabel(h.rta)}</span>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 10 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 1 }}>{fmtL(value)}</p>
                          <p style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)' }}>{(ltv * 100).toFixed(0)}% → {fmtL(eligible)}</p>
                        </div>
                      </div>
                      <motion.button
                        whileTap={!isThisPledging && !otherPledging ? { scale: 0.97 } : {}}
                        disabled={!!pledgingFolio}
                        onClick={() => handlePledgeMore(h)}
                        style={{
                          width: '100%', height: 38, borderRadius: 11,
                          background: isThisPledging ? 'rgba(0,212,161,0.15)' : (otherPledging ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)'),
                          border: isThisPledging ? '1px solid var(--jade-border)' : 'none',
                          color: isThisPledging ? 'var(--jade)' : (otherPledging ? 'var(--text-muted)' : '#000'),
                          fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)',
                          cursor: pledgingFolio ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        }}>
                        {isThisPledging ? (
                          <>
                            <motion.span animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>⟳</motion.span>
                            Pledging…
                          </>
                        ) : otherPledging ? 'Waiting…' : `Pledge → ${fmtL(eligible)} credit`}
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
