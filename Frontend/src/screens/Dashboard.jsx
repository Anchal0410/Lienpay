import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getCreditStatus, getLTVHealth, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import { CreditRing, LiquidBlob, ScrollReveal, useScrollY } from '../components/LiquidUI'

const fmt  = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtL = (n) => { const v = parseFloat(n || 0); return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${fmt(v)}` }

const getGreeting = () => {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 21) return 'Good evening'
  return 'Good night'
}

// ─────────────────────────────────────────────────────────────
// RISK SIMULATOR MODAL
// ─────────────────────────────────────────────────────────────
function RiskSimulator({ creditAccount, ltvHealth, onClose }) {
  const [tab, setTab]         = useState('used')    // 'used' | 'available'
  const [dropPct, setDropPct] = useState(0)         // portfolio drop scenario

  const creditLimit   = parseFloat(creditAccount?.credit_limit   || 0)
  const outstanding   = parseFloat(creditAccount?.outstanding     || 0)
  const availableCredit = parseFloat(creditAccount?.available_credit || 0)

  // Pledge value from ltvHealth, or fallback to credit_limit / 0.4 (rough estimate)
  const pledgeValue   = parseFloat(ltvHealth?.current_pledge_value || creditLimit / 0.40 || 0)
  const maxEligible   = parseFloat(ltvHealth?.max_eligible         || pledgeValue * 0.40 || 0)
  const weightedLtvCap = maxEligible > 0 && pledgeValue > 0 ? maxEligible / pledgeValue : 0.40

  // Slider value
  const [sliderVal, setSliderVal] = useState(tab === 'used' ? outstanding : availableCredit)

  useEffect(() => {
    setSliderVal(tab === 'used' ? outstanding : availableCredit)
  }, [tab, outstanding, availableCredit])

  // Derived used amount
  const usedAmount = tab === 'used'
    ? sliderVal
    : creditLimit - sliderVal

  // LTV calculation with portfolio drop
  const calcLTV = (used, dropPercent) => {
    if (maxEligible <= 0 || used <= 0) return 0
    const adjustedMax = maxEligible * (1 - dropPercent / 100)
    if (adjustedMax <= 0) return 999
    return (used / adjustedMax) * 100
  }

  const currentLTV    = calcLTV(usedAmount, 0)
  const afterDropLTV  = calcLTV(usedAmount, dropPct)
  const afterDropPledgeValue = pledgeValue * (1 - dropPct / 100)
  const afterDropMaxEligible = maxEligible * (1 - dropPct / 100)

  const getLtvStatus = (ltv) => {
    if (ltv >= 95) return { label: 'Critical', color: '#EF4444', bg: 'rgba(239,68,68,0.1)', dot: '#EF4444' }
    if (ltv >= 90) return { label: 'Action',   color: '#F97316', bg: 'rgba(249,115,22,0.1)', dot: '#F97316' }
    if (ltv >= 80) return { label: 'Watch',    color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', dot: '#F59E0B' }
    return                 { label: 'Healthy', color: '#00D4A1', bg: 'rgba(0,212,161,0.08)', dot: '#00D4A1' }
  }

  const status       = getLtvStatus(currentLTV)
  const afterStatus  = getLtvStatus(afterDropLTV)

  const DROP_OPTIONS = [0, -5, -10, -15, -20, -30]
  const QUICK_PCTS   = tab === 'used'
    ? [{ l: '0',   v: 0 }, { l: '25%', v: creditLimit * 0.25 }, { l: '50%', v: creditLimit * 0.5 }, { l: '75%', v: creditLimit * 0.75 }, { l: 'MAX', v: creditLimit }]
    : [{ l: 'MAX', v: creditLimit }, { l: '75%', v: creditLimit * 0.75 }, { l: '50%', v: creditLimit * 0.5 }, { l: '25%', v: creditLimit * 0.25 }, { l: '0', v: 0 }]

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 280, damping: 32 }}
        style={{ background: 'var(--bg-elevated)', borderRadius: '28px 28px 0 0', padding: '24px 20px 44px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 2 }}>RISK SIMULATOR</p>
          </div>
          <motion.button whileTap={{ scale: 0.88 }} onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-muted)' }}>
            ×
          </motion.button>
        </div>

        {/* LTV status pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: status.dot, boxShadow: `0 0 6px ${status.dot}` }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: status.color }}>{status.label}</span>
          <div style={{ display: 'flex', gap: 8, marginLeft: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>LTV</span>
            <span style={{ fontSize: 11, color: status.color, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{currentLTV.toFixed(1)}%</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Cap</span>
            <span style={{ fontSize: 11, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{(weightedLtvCap * 100).toFixed(0)}%</span>
          </div>
        </div>

        {/* LTV scale legend */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
          {[
            { label: 'Healthy', range: '< 80%', color: '#00D4A1' },
            { label: 'Watch',   range: '80–89%', color: '#F59E0B' },
            { label: 'Action',  range: '90–94%', color: '#F97316' },
            { label: 'Critical',range: '≥ 95%',  color: '#EF4444' },
          ].map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: i < 3 ? 8 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.label}</span>
              </div>
              <span style={{ fontSize: 11, color: s.color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.range}</span>
            </div>
          ))}
        </div>

        {/* Used / Available toggle */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'var(--bg-surface)', borderRadius: 14, padding: 4, marginBottom: 20 }}>
          {['used', 'available'].map(t => (
            <motion.button key={t} whileTap={{ scale: 0.96 }}
              onClick={() => setTab(t)}
              style={{
                height: 40, borderRadius: 11, fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)',
                background: tab === t ? (t === 'used' ? '#C9A449' : 'var(--jade)') : 'transparent',
                color: tab === t ? (t === 'used' ? '#000' : '#000') : 'var(--text-muted)',
                border: 'none',
                transition: 'all 0.2s',
              }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </motion.button>
          ))}
        </div>

        {/* Amount display */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
            {tab === 'used' ? 'USED AMOUNT' : 'AVAILABLE CREDIT'}
          </p>

          {/* Stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <motion.button whileTap={{ scale: 0.88 }}
              onClick={() => setSliderVal(v => Math.max(0, v - 10000))}
              style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 20, color: 'var(--text-secondary)', flexShrink: 0 }}>
              −
            </motion.button>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <p style={{
                fontFamily: 'var(--font-display)', fontSize: 34,
                color: tab === 'used' ? (sliderVal > 0 ? '#C9A449' : 'var(--text-secondary)') : 'var(--jade)',
              }}>
                {fmtL(sliderVal)}
              </p>
            </div>
            <motion.button whileTap={{ scale: 0.88 }}
              onClick={() => setSliderVal(v => Math.min(creditLimit, v + 10000))}
              style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 20, color: 'var(--text-secondary)', flexShrink: 0 }}>
              +
            </motion.button>
          </div>

          {/* Slider */}
          <input
            type="range"
            min={0} max={creditLimit || 1000000}
            step={5000}
            value={sliderVal}
            onChange={e => setSliderVal(parseFloat(e.target.value))}
            style={{ width: '100%', marginBottom: 10, accentColor: tab === 'used' ? '#C9A449' : 'var(--jade)' }}
          />

          {/* Quick buttons */}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
            {QUICK_PCTS.map(q => (
              <motion.button key={q.l} whileTap={{ scale: 0.9 }}
                onClick={() => setSliderVal(q.v)}
                style={{ flex: 1, height: 30, borderRadius: 8, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, border: '1px solid var(--border)', background: Math.abs(sliderVal - q.v) < 1 ? 'var(--jade)' : 'var(--bg-surface)', color: Math.abs(sliderVal - q.v) < 1 ? '#000' : 'var(--text-muted)' }}>
                {q.l}
              </motion.button>
            ))}
          </div>
        </div>

        {/* Portfolio Drop */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 14 }}>📉</span>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>PORTFOLIO DROP</p>
          </div>

          {/* Drop slider */}
          <input
            type="range"
            min={0} max={30}
            step={5}
            value={dropPct}
            onChange={e => setDropPct(parseFloat(e.target.value))}
            style={{ width: '100%', marginBottom: 10, accentColor: '#EF4444' }}
          />

          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {DROP_OPTIONS.map(d => (
              <motion.button key={d} whileTap={{ scale: 0.9 }}
                onClick={() => setDropPct(Math.abs(d))}
                style={{
                  flex: 1, height: 30, borderRadius: 8, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
                  border: '1px solid var(--border)',
                  background: dropPct === Math.abs(d) ? (d <= -20 ? '#EF4444' : 'var(--bg-overlay)') : 'var(--bg-elevated)',
                  color: dropPct === Math.abs(d) ? (d <= -20 ? '#fff' : 'var(--text-primary)') : 'var(--text-muted)',
                }}>
                {d === 0 ? '0' : `${d}%`}
              </motion.button>
            ))}
          </div>

          {/* Results grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: '10px 12px' }}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>ORIGINAL</p>
              <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmtL(pledgeValue)}</p>
            </div>
            <div style={{ background: dropPct > 0 ? 'rgba(239,68,68,0.08)' : 'var(--bg-elevated)', borderRadius: 12, padding: '10px 12px' }}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>AFTER DROP</p>
              <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: dropPct > 0 ? '#EF4444' : 'var(--text-primary)' }}>{fmtL(afterDropPledgeValue)}</p>
            </div>
            <div style={{ background: afterDropLTV >= 80 ? (afterDropLTV >= 90 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)') : 'var(--jade-dim)', borderRadius: 12, padding: '10px 12px' }}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>LTV</p>
              <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: afterStatus.color }}>
                {dropPct > 0 ? `${afterDropLTV.toFixed(1)}%` : `${currentLTV.toFixed(1)}%`}
              </p>
            </div>
          </div>
        </div>

        {/* Warning if crossing threshold */}
        {dropPct > 0 && afterDropLTV > currentLTV && afterDropLTV >= 80 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: afterDropLTV >= 90 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${afterDropLTV >= 90 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: afterDropLTV >= 90 ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>
              {afterDropLTV >= 95 ? '🔴 Critical zone — margin call triggered'
                : afterDropLTV >= 90 ? '🟠 Action required — add collateral or repay'
                : '🟡 Watch zone — monitor closely'}
            </p>
          </motion.div>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Outstanding pushes LTV up. Portfolio drop squeezes the same line automatically.
        </p>
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
export default function Dashboard({ onPay }) {
  const { creditAccount, setCreditAccount, ltvHealth, setLTVHealth, setTransactions, transactions, activeTab, setActiveTab } = useStore()
  const [loading, setLoading]     = useState(!creditAccount)
  const [showAllTxns, setShowAllTxns] = useState(false)
  const [showSimulator, setShowSimulator] = useState(false)
  const scrollRef = useRef(null)
  const scrollY   = useScrollY(scrollRef)

  const handleViewAll = async () => {
    if (showAllTxns) { setShowAllTxns(false); return }
    try {
      const r = await getTxnHistory({ limit: 100 })
      setTransactions(r.data?.transactions || [])
    } catch(e) {}
    setShowAllTxns(true)
  }

  useEffect(() => {
    const load = async () => {
      try { const r = await getCreditStatus(); setCreditAccount(r.data) } catch(e) {}
      try { const r = await getLTVHealth();    setLTVHealth(r.data) }    catch(e) {}
      try { const r = await getTxnHistory({ limit: 10 }); setTransactions(r.data?.transactions || []) } catch(e) {}
      setLoading(false)
    }
    load()
  }, [activeTab])

  const account     = creditAccount
  const available   = parseFloat(account?.available_credit || 0)
  const creditLimit = parseFloat(account?.credit_limit     || 0)
  const outstanding = parseFloat(account?.outstanding      || 0)

  // ── FIX: read ltv_ratio OR ltv ──────────────────────────────
  const ltv      = ltvHealth
  const ltvRatio = parseFloat(ltv?.ltv_ratio ?? ltv?.ltv ?? 0)
  const ltvColor = ltv?.status === 'RED' || ltvRatio >= 90 ? 'var(--red)'
    : ltv?.status === 'AMBER' || ltvRatio >= 80 ? 'var(--amber)'
    : 'var(--jade)'

  const displayedTxns = showAllTxns ? transactions : transactions.slice(0, 5)

  const txnIcon = (name) => {
    const n = (name || '').toLowerCase()
    if (n.includes('zomato') || n.includes('swiggy') || n.includes('food')) return '🍕'
    if (n.includes('uber') || n.includes('ola') || n.includes('rapido')) return '🚗'
    if (n.includes('amazon') || n.includes('flipkart')) return '📦'
    if (n.includes('netflix') || n.includes('spotify')) return '🎬'
    return '💳'
  }

  return (
    <div className="screen" ref={scrollRef}>

      {/* Background blobs */}
      <LiquidBlob size={320} color="var(--jade)" top="-100px" right="-80px" />
      <LiquidBlob size={220} color="var(--jade)" bottom="200px" left="-60px" delay={3} />

      {/* Risk Simulator floating button */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setShowSimulator(true)}
        style={{
          position: 'fixed', right: 16, bottom: 100, zIndex: 150,
          width: 46, height: 46, borderRadius: 15,
          background: 'linear-gradient(135deg, #1A2520, #0E1C18)',
          border: '1px solid var(--jade-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
          boxShadow: '0 4px 16px rgba(0,212,161,0.15)',
        }}
      >
        ⚡
      </motion.button>

      <div style={{ padding: '0 20px' }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ paddingTop: 28, marginBottom: 24 }}
        >
          <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '2px', marginBottom: 4 }}>LIENPAY</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 300, lineHeight: 1.1 }}>
            {getGreeting()},
          </h1>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, lineHeight: 1.1 }}>
            {account?.full_name?.split(' ')[0] || 'there'}
          </h1>
        </motion.div>

        {/* Credit ring */}
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1, duration: 0.6 }}
          style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <CreditRing
            available={available}
            creditLimit={creditLimit}
            outstanding={outstanding}
          />
        </motion.div>

        {/* CLOU badge */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--jade)', animation: 'breathe 3s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--jade)', letterSpacing: '1.5px' }}>CLOU ACTIVE</span>
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Closed credit line · Only inside LienPay</p>
        </div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.5 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
            {[
              { l: 'OUTSTANDING', v: `₹${fmtL(outstanding)}`, c: outstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' },
              { l: 'LTV RATIO',   v: `${ltvRatio.toFixed(1)}%`, c: ltvColor },
              { l: 'APR',         v: `${account?.apr || '12'}%`, c: 'var(--text-secondary)' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 6 }}>{s.l}</p>
                <p style={{ fontSize: 16, fontWeight: 600, color: s.c, fontFamily: 'var(--font-mono)' }}>{s.v}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* LTV alert */}
        <AnimatePresence>
          {ltv && (ltv.status === 'RED' || ltv.status === 'AMBER' || ltvRatio >= 80) && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: 0.2 }}
              style={{ background: ltvColor === 'var(--red)' ? 'var(--red-dim)' : 'var(--amber-dim)', border: `1px solid ${ltvColor === 'var(--red)' ? 'rgba(224,82,82,0.25)' : 'rgba(224,160,48,0.25)'}`, borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: ltvColor, marginBottom: 4 }}>
                {ltvRatio >= 90 ? '⚠️ Margin Call — Action Required' : '⚡ Portfolio Alert'}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>{ltv.message}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => setActiveTab('billing')}
                  style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', background: ltvColor, color: 'var(--bg-void)' }}>
                  Repay Now
                </motion.button>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => setActiveTab('portfolio')}
                  style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}>
                  Add Collateral
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pay CTA */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.5 }}>
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 16px 48px rgba(0,212,161,0.35)' }}
            whileTap={{ scale: 0.96 }}
            onClick={onPay}
            style={{
              width: '100%', height: 62, borderRadius: 16,
              background: available > 0 ? 'linear-gradient(135deg, var(--jade), #00A878)' : 'var(--bg-elevated)',
              color: available > 0 ? 'var(--bg-void)' : 'var(--text-muted)',
              fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-sans)',
              border: available <= 0 ? '1px solid var(--border)' : 'none',
              marginBottom: 24,
              letterSpacing: '-0.3px',
            }}>
            {available > 0 ? `Scan & Pay · ${fmtL(available)} available` : 'No credit available — repay first'}
          </motion.button>
        </motion.div>

        {/* Transactions */}
        {transactions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>TRANSACTIONS</p>
              <motion.button whileTap={{ scale: 0.96 }} onClick={handleViewAll}
                style={{ fontSize: 11, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {showAllTxns ? 'Show less' : 'View all'}
              </motion.button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayedTxns.map((txn, i) => (
                <ScrollReveal key={txn.txn_id || i}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                      {txnIcon(txn.merchant_name)}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{txn.merchant_name}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {txn.initiated_at ? new Date(txn.initiated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                        ₹{fmt(txn.amount)}
                      </p>
                      <p style={{ fontSize: 9, color: txn.status === 'SETTLED' ? 'var(--jade)' : 'var(--text-muted)', letterSpacing: '0.5px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {txn.status}
                      </p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </motion.div>
        )}

        {/* Portfolio health peek */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.5 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(0,212,161,0.08), rgba(0,212,161,0.03))', border: '1px solid var(--jade-border)', borderRadius: 18, padding: '18px', marginBottom: 24, marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>PORTFOLIO</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: ltvColor }} />
                <span style={{ fontSize: 10, color: ltvColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{ltv?.status || 'GREEN'}</span>
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400 }}>
              {fmtL(ltv?.current_pledge_value || 0)}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Pledged portfolio value</p>
          </div>
        </motion.div>

      </div>

      {/* Risk Simulator modal */}
      <AnimatePresence>
        {showSimulator && (
          <RiskSimulator
            creditAccount={creditAccount}
            ltvHealth={ltvHealth}
            onClose={() => setShowSimulator(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
