import { useEffect, useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getCreditStatus, getLTVHealth, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import { CreditRing, LiquidBlob, ScrollReveal, useScrollY } from '../components/LiquidUI'

// ── FIX: fmtL includes ₹ — do NOT prefix again ──────────────
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
// RISK SIMULATOR
// ─────────────────────────────────────────────────────────────
function RiskSimulator({ creditAccount, ltvHealth, onClose }) {
  const [tab, setTab]         = useState('used')
  const [dropPct, setDropPct] = useState(0)

  const creditLimit     = parseFloat(creditAccount?.credit_limit   || 0)
  const outstanding     = parseFloat(creditAccount?.outstanding     || 0)
  const availableCredit = parseFloat(creditAccount?.available_credit || 0)
  const pledgeValue     = parseFloat(ltvHealth?.current_pledge_value || creditLimit / 0.40 || 0)
  const maxEligible     = parseFloat(ltvHealth?.max_eligible         || pledgeValue * 0.40 || 0)
  const weightedLtvCap  = maxEligible > 0 && pledgeValue > 0 ? maxEligible / pledgeValue : 0.40

  const [sliderVal, setSliderVal] = useState(tab === 'used' ? outstanding : availableCredit)
  useEffect(() => { setSliderVal(tab === 'used' ? outstanding : availableCredit) }, [tab, outstanding, availableCredit])

  const usedAmount = tab === 'used' ? sliderVal : creditLimit - sliderVal

  const calcLTV = (used, drop) => {
    if (maxEligible <= 0 || used <= 0) return 0
    const adj = maxEligible * (1 - drop / 100)
    return adj <= 0 ? 999 : (used / adj) * 100
  }

  const currentLTV   = calcLTV(usedAmount, 0)
  const afterDropLTV = calcLTV(usedAmount, dropPct)
  const afterDropVal = pledgeValue * (1 - dropPct / 100)

  const getLtvStatus = (ltv) => {
    if (ltv >= 95) return { label: 'Critical', color: '#EF4444' }
    if (ltv >= 90) return { label: 'Action',   color: '#F97316' }
    if (ltv >= 80) return { label: 'Watch',     color: '#F59E0B' }
    return               { label: 'Healthy',    color: '#00D4A1' }
  }
  const status      = getLtvStatus(currentLTV)
  const afterStatus = getLtvStatus(afterDropLTV)

  const QUICK = tab === 'used'
    ? [{ l: '0', v: 0 }, { l: '25%', v: creditLimit * 0.25 }, { l: '50%', v: creditLimit * 0.5 }, { l: '75%', v: creditLimit * 0.75 }, { l: 'MAX', v: creditLimit }]
    : [{ l: 'MAX', v: creditLimit }, { l: '75%', v: creditLimit * 0.75 }, { l: '50%', v: creditLimit * 0.5 }, { l: '25%', v: creditLimit * 0.25 }, { l: '0', v: 0 }]

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 280, damping: 32 }}
        style={{ background: 'var(--bg-elevated)', borderRadius: '28px 28px 0 0', padding: '24px 20px 44px', width: '100%', maxHeight: '92vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>RISK SIMULATOR</p>
          <motion.button whileTap={{ scale: 0.88 }} onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-muted)', cursor: 'pointer' }}>×</motion.button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: status.color }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: status.color }}>{status.label}</span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginLeft: 4 }}>LTV {currentLTV.toFixed(1)}%  Cap {(weightedLtvCap * 100).toFixed(0)}%</span>
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '12px 14px', marginBottom: 16 }}>
          {[{ label: 'Healthy', range: '< 80%', color: '#00D4A1' }, { label: 'Watch', range: '80–89%', color: '#F59E0B' }, { label: 'Action', range: '90–94%', color: '#F97316' }, { label: 'Critical', range: '≥ 95%', color: '#EF4444' }].map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: i < 3 ? 8 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{s.label}</span>
              </div>
              <span style={{ fontSize: 11, color: s.color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s.range}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'var(--bg-surface)', borderRadius: 14, padding: 4, marginBottom: 16 }}>
          {['used', 'available'].map(t => (
            <motion.button key={t} whileTap={{ scale: 0.96 }} onClick={() => setTab(t)}
              style={{ height: 40, borderRadius: 11, fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', background: tab === t ? (t === 'used' ? '#C9A449' : 'var(--jade)') : 'transparent', color: tab === t ? '#000' : 'var(--text-muted)', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </motion.button>
          ))}
        </div>

        <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>{tab === 'used' ? 'USED AMOUNT' : 'AVAILABLE CREDIT'}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <motion.button whileTap={{ scale: 0.88 }} onClick={() => setSliderVal(v => Math.max(0, v - 10000))}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 20, color: 'var(--text-secondary)', flexShrink: 0, cursor: 'pointer' }}>−</motion.button>
          <p style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 32, color: tab === 'used' ? (sliderVal > 0 ? '#C9A449' : 'var(--text-secondary)') : 'var(--jade)' }}>{fmtL(sliderVal)}</p>
          <motion.button whileTap={{ scale: 0.88 }} onClick={() => setSliderVal(v => Math.min(creditLimit, v + 10000))}
            style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 20, color: 'var(--text-secondary)', flexShrink: 0, cursor: 'pointer' }}>+</motion.button>
        </div>
        <input type="range" min={0} max={creditLimit || 1000000} step={5000} value={sliderVal} onChange={e => setSliderVal(parseFloat(e.target.value))}
          style={{ width: '100%', marginBottom: 10, accentColor: tab === 'used' ? '#C9A449' : 'var(--jade)' }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
          {QUICK.map(q => (
            <motion.button key={q.l} whileTap={{ scale: 0.9 }} onClick={() => setSliderVal(q.v)}
              style={{ flex: 1, height: 30, borderRadius: 8, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, border: '1px solid var(--border)', background: Math.abs(sliderVal - q.v) < 1 ? 'var(--jade)' : 'var(--bg-surface)', color: Math.abs(sliderVal - q.v) < 1 ? '#000' : 'var(--text-muted)', cursor: 'pointer' }}>
              {q.l}
            </motion.button>
          ))}
        </div>

        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '14px', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 14 }}>📉</span>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>PORTFOLIO DROP</p>
          </div>
          <input type="range" min={0} max={30} step={5} value={dropPct} onChange={e => setDropPct(parseFloat(e.target.value))}
            style={{ width: '100%', marginBottom: 10, accentColor: '#EF4444' }} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {[0, -5, -10, -15, -20, -30].map(d => (
              <motion.button key={d} whileTap={{ scale: 0.9 }} onClick={() => setDropPct(Math.abs(d))}
                style={{ flex: 1, height: 28, borderRadius: 7, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, border: '1px solid var(--border)', background: dropPct === Math.abs(d) ? (Math.abs(d) >= 20 ? '#EF4444' : 'var(--bg-overlay)') : 'var(--bg-elevated)', color: dropPct === Math.abs(d) ? (Math.abs(d) >= 20 ? '#fff' : 'var(--text-primary)') : 'var(--text-muted)', cursor: 'pointer' }}>
                {d === 0 ? '0' : `${d}%`}
              </motion.button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: 'ORIGINAL', value: fmtL(pledgeValue), color: 'var(--text-primary)' },
              { label: 'AFTER DROP', value: fmtL(afterDropVal), color: dropPct > 0 ? '#EF4444' : 'var(--text-primary)' },
              { label: 'LTV', value: `${(dropPct > 0 ? afterDropLTV : currentLTV).toFixed(1)}%`, color: afterStatus.color },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 10px' }}>
                <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, fontFamily: 'var(--font-mono)' }}>{s.label}</p>
                <p style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
        {dropPct > 0 && afterDropLTV >= 80 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: afterDropLTV >= 90 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${afterDropLTV >= 90 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 12, padding: '10px 12px', marginBottom: 10 }}>
            <p style={{ fontSize: 12, color: afterDropLTV >= 90 ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>
              {afterDropLTV >= 95 ? '🔴 Critical — margin call triggered' : afterDropLTV >= 90 ? '🟠 Action required' : '🟡 Watch zone'}
            </p>
          </motion.div>
        )}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>Outstanding pushes LTV up. Portfolio drop squeezes the same line automatically.</p>
      </motion.div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────
export default function Dashboard({ onPay }) {
  const { creditAccount, setCreditAccount, ltvHealth, setLTVHealth, setTransactions, transactions, activeTab, setActiveTab } = useStore()
  const [loading, setLoading]             = useState(!creditAccount)
  const [showAllTxns, setShowAllTxns]     = useState(false)
  const [showSimulator, setShowSimulator] = useState(false)
  const scrollRef = useRef(null)
  const scrollY   = useScrollY(scrollRef)

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
  const ltv         = ltvHealth
  const ltvRatio    = parseFloat(ltv?.ltv_ratio ?? ltv?.ltv ?? 0)
  const ltvColor    = ltvRatio >= 90 || ltv?.status === 'RED'   ? 'var(--red)'
    :                 ltvRatio >= 80 || ltv?.status === 'AMBER' ? 'var(--amber)' : 'var(--jade)'

  const displayedTxns = showAllTxns ? transactions : transactions.slice(0, 5)
  const txnIcon = (name) => {
    const n = (name || '').toLowerCase()
    if (n.includes('zomato') || n.includes('swiggy')) return '🍕'
    if (n.includes('uber') || n.includes('ola'))      return '🚗'
    if (n.includes('amazon') || n.includes('flipkart')) return '📦'
    if (n.includes('netflix') || n.includes('spotify')) return '🎬'
    return '💳'
  }

  const handleViewAll = async () => {
    if (showAllTxns) { setShowAllTxns(false); return }
    try { const r = await getTxnHistory({ limit: 100 }); setTransactions(r.data?.transactions || []) } catch(e) {}
    setShowAllTxns(true)
  }

  const ringScale   = Math.max(0.88, 1 - scrollY / 500)
  const ringOpacity = Math.max(0.4,  1 - scrollY / 350)
  const headerY     = Math.min(0, -scrollY * 0.12)

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)' }}>
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        style={{ width: 36, height: 36, border: '2px solid var(--bg-elevated)', borderTopColor: 'var(--jade)', borderRadius: '50%' }} />
    </div>
  )

  return (
    <div ref={scrollRef} className="screen">
      {/* Risk Simulator button */}
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowSimulator(true)}
        style={{ position: 'fixed', right: 16, bottom: 100, zIndex: 150, width: 46, height: 46, borderRadius: 15, background: 'linear-gradient(135deg, #1A2520, #0E1C18)', border: '1px solid var(--jade-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 4px 16px rgba(0,212,161,0.15)', cursor: 'pointer' }}>⚡</motion.button>

      {/* Blobs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <LiquidBlob size={320} color="var(--jade)" top={`${-100 - scrollY * 0.2}px`} right="-80px" />
        <LiquidBlob size={200} color="var(--jade)" top={`${400 - scrollY * 0.1}px`} left="-60px" delay={3} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, padding: '0 22px' }}>
        <div style={{ paddingTop: 20, paddingBottom: 16, transform: `translateY(${headerY}px)` }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '3px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>LIENPAY</p>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, marginTop: 4, letterSpacing: '-0.5px' }}>{getGreeting()}</h1>
        </div>

        {/* Credit Ring */}
        <div style={{ transform: `scale(${ringScale})`, opacity: ringOpacity, transformOrigin: 'center top', marginBottom: 8, transition: 'transform 0.05s linear, opacity 0.05s linear' }}>
          <CreditRing limit={creditLimit} available={available} />
        </div>

        {/* CLOU badge */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--jade)', animation: 'breathe 3s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--jade)', letterSpacing: '1.5px' }}>CLOU ACTIVE</span>
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Closed credit line · Only inside LienPay</p>
        </div>

        {/* Stats — FIX: fmtL already includes ₹, don't add another ₹ */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
            {[
              { l: 'OUTSTANDING', v: fmtL(outstanding),          c: outstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' },
              { l: 'LTV RATIO',   v: `${ltvRatio.toFixed(1)}%`,  c: ltvColor },
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
              style={{ background: ltvRatio >= 90 ? 'var(--red-dim)' : 'var(--amber-dim)', border: `1px solid ${ltvRatio >= 90 ? 'rgba(224,82,82,0.25)' : 'rgba(224,160,48,0.25)'}`, borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: ltvColor, marginBottom: 4 }}>
                {ltvRatio >= 90 ? '⚠️ Margin Call — Action Required' : '⚡ Portfolio Alert'}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>{ltv.message}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => setActiveTab('billing')}
                  style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', background: ltvColor, color: 'var(--bg-void)', border: 'none', cursor: 'pointer' }}>Repay Now</motion.button>
                <motion.button whileTap={{ scale: 0.96 }} onClick={() => setActiveTab('portfolio')}
                  style={{ flex: 1, height: 38, borderRadius: 10, fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', color: 'var(--text-primary)', cursor: 'pointer' }}>Add Collateral</motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pay CTA — ── FIX: just "Scan & Pay", no amount ── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 16px 48px rgba(0,212,161,0.35)' }}
            whileTap={{ scale: 0.96 }} onClick={onPay}
            style={{
              width: '100%', height: 62, borderRadius: 16, marginBottom: 24,
              background: available > 0 ? 'linear-gradient(135deg, var(--jade), #00A878)' : 'var(--bg-elevated)',
              color: available > 0 ? 'var(--bg-void)' : 'var(--text-muted)',
              fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-sans)',
              border: available <= 0 ? '1px solid var(--border)' : 'none',
              letterSpacing: '-0.2px', cursor: 'pointer',
            }}>
            {available > 0 ? 'Scan & Pay' : 'No credit available — repay first'}
          </motion.button>
        </motion.div>

        {/* Transactions */}
        {transactions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>TRANSACTIONS</p>
              <motion.button whileTap={{ scale: 0.96 }} onClick={handleViewAll}
                style={{ fontSize: 11, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>
                {showAllTxns ? 'Show less' : 'View all'}
              </motion.button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayedTxns.map((txn, i) => (
                <ScrollReveal key={txn.txn_id || i} scrollY={scrollY}>
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
                      <p style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>₹{fmt(txn.amount)}</p>
                      <p style={{ fontSize: 9, color: txn.status === 'SETTLED' ? 'var(--jade)' : 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{txn.status}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </motion.div>
        )}

        {/* Portfolio peek */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(0,212,161,0.08), rgba(0,212,161,0.03))', border: '1px solid var(--jade-border)', borderRadius: 18, padding: '18px', marginBottom: 24, marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>PORTFOLIO</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: ltvColor }} />
                <span style={{ fontSize: 10, color: ltvColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{ltv?.status || 'GREEN'}</span>
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>{fmtL(ltv?.current_pledge_value || 0)}</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Pledged portfolio value</p>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {showSimulator && <RiskSimulator creditAccount={creditAccount} ltvHealth={ltvHealth} onClose={() => setShowSimulator(false)} />}
      </AnimatePresence>
    </div>
  )
}
