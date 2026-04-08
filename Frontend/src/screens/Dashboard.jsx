import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getCreditStatus, getLTVHealth, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import { CreditRing, LiquidBlob, ScrollReveal, useScrollY } from '../components/LiquidUI'

// ── Formatters ────────────────────────────────────────────────
// fmtL ALREADY includes the ₹ sign — NEVER prefix with ₹ again
const fmt  = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${fmt(v)}`
}
const getGreeting = () => {
  const h = new Date().getHours()
  if (h >= 5  && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 21) return 'Good evening'
  return 'Good night'
}
// ─────────────────────────────────────────────────────────────
// NOTIFICATION BOTTOM SHEET
// Renders as a bottom sheet — ZERO overlap with page content above
// ─────────────────────────────────────────────────────────────
function NotificationSheet({ creditAccount, ltvHealth, open, onClose }) {
  const outstanding  = parseFloat(creditAccount?.outstanding || 0)
  const ltvRatio     = parseFloat(ltvHealth?.ltv_ratio || 0)
  const dueDate      = creditAccount?.due_date
  const daysUntilDue = dueDate ? Math.max(0, Math.ceil((new Date(dueDate) - Date.now()) / 86400000)) : null

  const notifications = []

  if (ltvRatio >= 90) {
    notifications.push({
      id: 'margin', type: 'critical',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
      title: 'Margin Call Active',
      body: `LTV at ${ltvRatio.toFixed(1)}% — add collateral or repay immediately to avoid pledge invocation.`,
      color: '#EF4444', time: 'Now',
    })
  } else if (ltvRatio >= 80) {
    notifications.push({
      id: 'ltv-watch', type: 'warning',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
      title: 'LTV Watch Zone',
      body: `Portfolio at ${ltvRatio.toFixed(1)}% utilisation. Consider pledging more funds or repaying.`,
      color: '#F59E0B', time: 'Today',
    })
  }

  if (outstanding > 0 && daysUntilDue !== null && daysUntilDue <= 7) {
    notifications.push({
      id: 'due-soon', type: daysUntilDue <= 2 ? 'critical' : 'warning',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={daysUntilDue <= 2 ? '#EF4444' : '#F59E0B'} strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
      title: `Payment Due in ${daysUntilDue} day${daysUntilDue !== 1 ? 's' : ''}`,
      body: `${fmtL(outstanding)} outstanding. Pay in full before due date to maintain interest-free status.`,
      color: daysUntilDue <= 2 ? '#EF4444' : '#F59E0B', time: `${daysUntilDue}d left`,
    })
  }

  if (outstanding > 0 && ltvRatio > 0 && ltvRatio < 80) {
    notifications.push({
      id: 'healthy', type: 'info',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
      title: 'Portfolio Healthy',
      body: `LTV at ${ltvRatio.toFixed(1)}% — well within safe zone. Collateral is secure.`,
      color: 'var(--jade)', time: 'Today',
    })
  }

  if (creditAccount?.upi_vpa) {
    notifications.push({
      id: 'clou', type: 'info',
      icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
      title: 'CLOU Credit Active',
      body: `${fmtL(creditAccount?.available_credit)} available via UPI · ${creditAccount?.upi_vpa}`,
      color: 'var(--jade)', time: 'Active',
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop — dimming only, does NOT block the bell area */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)', zIndex: 600 }}
            onClick={onClose} />

          {/* Bottom sheet — slides up from the bottom */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 38 }}
            style={{
              position: 'fixed',
              bottom: 0, left: 0, right: 0,
              background: 'var(--bg-elevated)',
              borderRadius: '24px 24px 0 0',
              zIndex: 700,
              overflow: 'hidden',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}>
            {/* Drag handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 12, paddingBottom: 4 }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bg-overlay)' }} />
            </div>

            {/* Header */}
            <div style={{ padding: '10px 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <p style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>Notifications</p>
                {notifications.length > 0 && (
                  <span style={{ fontSize: 10, background: 'var(--jade-dim)', color: 'var(--jade)', padding: '2px 8px', borderRadius: 7, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {notifications.length} new
                  </span>
                )}
              </div>
              <motion.button whileTap={{ scale: 0.88 }} onClick={onClose}
                style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-muted)', cursor: 'pointer' }}>×</motion.button>
            </div>

            {/* Content */}
            {notifications.length === 0 ? (
              <div style={{ padding: '36px 20px 32px', textAlign: 'center' }}>
                <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, type: 'spring' }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ margin: '0 auto 12px', display: 'block' }}>
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                  </svg>
                  <p style={{ fontSize: 15, color: 'var(--text-secondary)', fontWeight: 600, marginBottom: 4 }}>No notifications</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>You're all caught up — your account is looking great!</p>
                </motion.div>
              </div>
            ) : (
              <div style={{ overflowY: 'auto', maxHeight: '60vh' }}>
                {notifications.map((n, i) => (
                  <motion.div key={n.id}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                    style={{ padding: '14px 20px', borderBottom: i < notifications.length - 1 ? '1px solid rgba(0,212,161,0.05)' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: `${n.color}18`, border: `1px solid ${n.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      {n.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: n.color }}>{n.title}</p>
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginLeft: 8 }}>{n.time}</p>
                      </div>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{n.body}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Bottom padding for home indicator */}
            <div style={{ height: 16 }} />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─────────────────────────────────────────────────────────────
// NOTIFICATION BELL BUTTON (just the button, sheet is separate)
// ─────────────────────────────────────────────────────────────
function NotificationBell({ creditAccount, ltvHealth, onOpen, hasUnread, bellColor }) {
  return (
    <motion.button whileTap={{ scale: 0.88 }} onClick={onOpen}
      style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--bg-surface)', border: `1px solid var(--border)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={bellColor} strokeWidth="2" strokeLinecap="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      {hasUnread && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}
          style={{ position: 'absolute', top: 7, right: 8, width: 7, height: 7, borderRadius: '50%', background: bellColor, border: '1.5px solid var(--bg-base)' }} />
      )}
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────
// CREDIT SUMMARY CARD
// ─────────────────────────────────────────────────────────────
function CreditSummaryCard({ account, ltvHealth }) {
  if (!account) return null
  const pledgeValue = parseFloat(ltvHealth?.current_pledge_value || 0)
  const creditLimit = parseFloat(account.credit_limit  || 0)
  const available   = parseFloat(account.available_credit || 0)
  const outstanding = parseFloat(account.outstanding || 0)
  const utilPct     = creditLimit > 0 ? (outstanding / creditLimit) * 100 : 0

  // ── FIX: fmtL already includes ₹ — do NOT add another ₹ ──
  const rows = [
    { label: 'My Pledge Value', value: fmtL(pledgeValue), highlight: false },
    { label: 'Credit Limit',    value: fmtL(creditLimit), highlight: false },
    { label: 'Available',       value: fmtL(available),   highlight: true  },
    { label: 'Utilized',        value: fmtL(outstanding), highlight: outstanding > 0 },
  ]

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} style={{ marginBottom: 16 }}>
      <div style={{ background: 'linear-gradient(135deg, #0d1f17 0%, #081510 50%, #0a1d14 100%)', border: '1px solid rgba(0,212,161,0.14)', borderRadius: 22, padding: '20px 20px 16px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,212,161,0.07), transparent)', pointerEvents: 'none' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="28" height="22" viewBox="0 0 28 22" fill="none">
              <rect x="1" y="1" width="26" height="20" rx="3" fill="rgba(0,212,161,0.15)" stroke="rgba(0,212,161,0.35)" strokeWidth="0.8"/>
              <rect x="4" y="4" width="20" height="14" rx="2" fill="rgba(0,212,161,0.08)" stroke="rgba(0,212,161,0.2)" strokeWidth="0.5"/>
              <line x1="14" y1="1" x2="14" y2="21" stroke="rgba(0,212,161,0.25)" strokeWidth="0.5"/>
              <line x1="1" y1="8" x2="27" y2="8" stroke="rgba(0,212,161,0.25)" strokeWidth="0.5"/>
              <line x1="1" y1="14" x2="27" y2="14" stroke="rgba(0,212,161,0.25)" strokeWidth="0.5"/>
            </svg>
            <div>
              <p style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)', letterSpacing: '2px', fontWeight: 600 }}>CREDIT SUMMARY</p>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Wealth-backed CLOU</p>
            </div>
          </div>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--jade)' }}>LienPay</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.label}</p>
              <p style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: row.highlight ? 'var(--jade)' : 'var(--text-primary)' }}>{row.value}</p>
            </div>
          ))}
        </div>
        {creditLimit > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>UTILISATION</p>
              <p style={{ fontSize: 9, color: utilPct > 80 ? '#EF4444' : utilPct > 50 ? '#F59E0B' : 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{utilPct.toFixed(1)}%</p>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,212,161,0.1)', overflow: 'hidden' }}>
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(utilPct, 100)}%` }} transition={{ duration: 1, ease: 'easeOut', delay: 0.4 }}
                style={{ height: '100%', background: utilPct > 80 ? '#EF4444' : utilPct > 50 ? '#F59E0B' : 'linear-gradient(90deg, var(--jade), #00A878)', borderRadius: 2 }} />
            </div>
          </div>
        )}
        {outstanding === 0 && (
          <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(0,212,161,0.06)', borderRadius: 8, border: '1px solid rgba(0,212,161,0.12)', width: 'fit-content' }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--jade)' }} />
            <p style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>30 DAYS INTEREST-FREE · ACTIVE</p>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────
// RISK SIMULATOR
// ─────────────────────────────────────────────────────────────
function RiskSimulator({ creditAccount, ltvHealth, onClose }) {
  const [tab, setTab]   = useState('used')
  const [dropPct, setDropPct] = useState(0)
  const creditLimit = parseFloat(creditAccount?.credit_limit || 0)
  const outstanding = parseFloat(creditAccount?.outstanding || 0)
  const available   = parseFloat(creditAccount?.available_credit || 0)
  const pledgeValue = parseFloat(ltvHealth?.current_pledge_value || creditLimit / 0.40 || 0)
  const maxEligible = parseFloat(ltvHealth?.max_eligible || pledgeValue * 0.40 || 0)
  const [slider, setSlider] = useState(outstanding)
  useEffect(() => { setSlider(tab === 'used' ? outstanding : available) }, [tab])
  const usedAmt = tab === 'used' ? slider : creditLimit - slider
  const calcLTV = (used, drop) => { if (maxEligible <= 0 || used <= 0) return 0; const adj = maxEligible * (1 - drop / 100); return adj <= 0 ? 999 : (used / adj) * 100 }
  const curLTV  = calcLTV(usedAmt, 0)
  const dropLTV = calcLTV(usedAmt, dropPct)
  const getLtvStatus = (l) => l >= 95 ? { label: 'Critical', color: '#EF4444' } : l >= 90 ? { label: 'Action', color: '#F97316' } : l >= 80 ? { label: 'Watch', color: '#F59E0B' } : { label: 'Healthy', color: '#00D4A1' }
  const status = getLtvStatus(curLTV), dropStatus = getLtvStatus(dropLTV)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}
      onClick={onClose}>
      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 280, damping: 32 }}
        style={{ background: 'var(--bg-elevated)', borderRadius: '28px 28px 0 0', padding: '20px 20px 44px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)' }}>RISK SIMULATOR</p>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: status.color }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: status.color }}>{status.label} {curLTV.toFixed(1)}%</span>
          </div>
          <motion.button whileTap={{ scale: 0.88 }} onClick={onClose} style={{ width: 30, height: 30, borderRadius: 10, background: 'var(--bg-overlay)', border: '1px solid var(--border)', fontSize: 16, color: 'var(--text-muted)', cursor: 'pointer' }}>×</motion.button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, background: 'var(--bg-surface)', borderRadius: 12, padding: 3, marginBottom: 14 }}>
          {['used','available'].map(t => (<motion.button key={t} whileTap={{ scale: 0.96 }} onClick={() => setTab(t)} style={{ height: 36, borderRadius: 10, fontSize: 12, fontWeight: 700, background: tab === t ? (t === 'used' ? '#C9A449' : 'var(--jade)') : 'transparent', color: tab === t ? '#000' : 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>{t.charAt(0).toUpperCase() + t.slice(1)}</motion.button>))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <motion.button whileTap={{ scale: 0.88 }} onClick={() => setSlider(v => Math.max(0, v - 10000))} style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 18, color: 'var(--text-secondary)', cursor: 'pointer' }}>−</motion.button>
          <p style={{ flex: 1, textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 28, color: tab === 'used' ? '#C9A449' : 'var(--jade)' }}>{fmtL(slider)}</p>
          <motion.button whileTap={{ scale: 0.88 }} onClick={() => setSlider(v => Math.min(creditLimit, v + 10000))} style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 18, color: 'var(--text-secondary)', cursor: 'pointer' }}>+</motion.button>
        </div>
        <input type="range" min={0} max={creditLimit || 1000000} step={5000} value={slider} onChange={e => setSlider(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: 16, accentColor: tab === 'used' ? '#C9A449' : 'var(--jade)' }} />
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px', marginBottom: 12 }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>PORTFOLIO DROP SCENARIO</p>
          <input type="range" min={0} max={30} step={5} value={dropPct} onChange={e => setDropPct(parseFloat(e.target.value))} style={{ width: '100%', marginBottom: 8, accentColor: '#EF4444' }} />
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {[0,-5,-10,-15,-20,-30].map(d => (<motion.button key={d} whileTap={{ scale: 0.9 }} onClick={() => setDropPct(Math.abs(d))} style={{ flex: 1, height: 26, borderRadius: 6, fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, border: '1px solid var(--border)', background: dropPct === Math.abs(d) ? (Math.abs(d) >= 20 ? '#EF4444' : 'var(--bg-overlay)') : 'var(--bg-elevated)', color: dropPct === Math.abs(d) ? (Math.abs(d) >= 20 ? '#fff' : 'var(--text-primary)') : 'var(--text-muted)', cursor: 'pointer' }}>{d === 0 ? '0' : `${d}%`}</motion.button>))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {[{ label: 'ORIGINAL', value: fmtL(pledgeValue), color: 'var(--text-primary)' }, { label: 'AFTER DROP', value: fmtL(pledgeValue * (1 - dropPct / 100)), color: dropPct > 0 ? '#EF4444' : 'var(--text-primary)' }, { label: 'LTV', value: `${(dropPct > 0 ? dropLTV : curLTV).toFixed(1)}%`, color: dropStatus.color }].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '7px 9px' }}>
                <p style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2, fontFamily: 'var(--font-mono)' }}>{s.label}</p>
                <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.color }}>{s.value}</p>
              </div>
            ))}
          </div>
        </div>
        {dropPct > 0 && dropLTV >= 80 && (
          <div style={{ background: dropLTV >= 90 ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${dropLTV >= 90 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`, borderRadius: 11, padding: '9px 12px' }}>
            <p style={{ fontSize: 12, color: dropLTV >= 90 ? '#EF4444' : '#F59E0B', fontWeight: 700 }}>{dropLTV >= 95 ? '🔴 Critical' : dropLTV >= 90 ? '🟠 Action required' : '🟡 Watch zone'}</p>
          </div>
        )}
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
  const [notifOpen, setNotifOpen]         = useState(false)
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
  const ltvColor    = ltvRatio >= 90 ? 'var(--red)' : ltvRatio >= 80 ? 'var(--amber)' : 'var(--jade)'

  const displayedTxns = showAllTxns ? transactions : transactions.slice(0, 5)
  const txnIcon = (name) => {
    const n = (name || '').toLowerCase()
    if (n.includes('zomato') || n.includes('swiggy')) return '🍕'
    if (n.includes('uber') || n.includes('ola')) return '🚗'
    if (n.includes('amazon') || n.includes('flipkart')) return '📦'
    return '💳'
  }

  const handleViewAll = async () => {
    if (showAllTxns) { setShowAllTxns(false); return }
    try { const r = await getTxnHistory({ limit: 100 }); setTransactions(r.data?.transactions || []) } catch(e) {}
    setShowAllTxns(true)
  }

  const bellColor   = ltvRatio >= 90 ? '#EF4444' : ltvRatio >= 80 ? '#F59E0B' : 'var(--jade)'
  const hasNotifs   = ltvRatio >= 80 || (outstanding > 0 && ltvRatio > 0) || !!account?.upi_vpa

  const ringScale   = Math.max(0.88, 1 - scrollY / 500)
  const ringOpacity = Math.max(0.4, 1 - scrollY / 350)
  const headerY     = Math.min(0, -scrollY * 0.1)

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)' }}>
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        style={{ width: 36, height: 36, border: '2px solid var(--bg-elevated)', borderTopColor: 'var(--jade)', borderRadius: '50%' }} />
    </div>
  )

  return (
    <div ref={scrollRef} className="screen">
      {/* Risk Simulator FAB */}
      <motion.button whileTap={{ scale: 0.9 }} onClick={() => setShowSimulator(true)}
        style={{ position: 'fixed', right: 16, bottom: 100, zIndex: 150, width: 46, height: 46, borderRadius: 15, background: 'linear-gradient(135deg, #1A2520, #0E1C18)', border: '1px solid var(--jade-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, boxShadow: '0 4px 16px rgba(0,212,161,0.15)', cursor: 'pointer' }}>⚡</motion.button>

      {/* Background blobs */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <LiquidBlob size={300} color="var(--jade)" top={`${-80 - scrollY * 0.2}px`} right="-70px" />
        <LiquidBlob size={200} color="var(--jade)" top={`${380 - scrollY * 0.1}px`} left="-50px" delay={3} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, padding: '0 20px' }}>

        {/* Header */}
        <div style={{ paddingTop: 18, paddingBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', transform: `translateY(${headerY}px)` }}>
          <div>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '3px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 2 }}>LIENPAY</p>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, letterSpacing: '-0.5px' }}>{getGreeting()}</h1>
          </div>
          <div style={{ marginTop: 4 }}>
            <NotificationBell creditAccount={account} ltvHealth={ltv} onOpen={() => setNotifOpen(true)} hasUnread={hasNotifs} bellColor={bellColor} />
          </div>
        </div>

        {/* Credit ring */}
        <div style={{ transform: `scale(${ringScale})`, opacity: ringOpacity, transformOrigin: 'center top', marginBottom: 6, transition: 'transform 0.05s linear, opacity 0.05s linear' }}>
          <CreditRing limit={creditLimit} available={available} />
        </div>

        {/* CLOU badge */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--jade)', animation: 'breathe 3s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--jade)', letterSpacing: '1.5px' }}>CLOU ACTIVE</span>
          </div>
        </div>

        {/* Stats — FIX: fmtL() already has ₹, no prefix needed */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {[
              { l: 'OUTSTANDING', v: fmtL(outstanding),          c: outstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' },
              { l: 'LTV RATIO',   v: `${ltvRatio.toFixed(1)}%`,  c: ltvColor },
              { l: 'APR',         v: `${account?.apr || '12'}%`, c: 'var(--text-secondary)' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
                <p style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 5 }}>{s.l}</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: s.c, fontFamily: 'var(--font-mono)' }}>{s.v}</p>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Health banner */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          style={{ background: ltvRatio >= 90 ? 'var(--red-dim)' : ltvRatio >= 80 ? 'var(--amber-dim)' : 'rgba(0,212,161,0.06)', border: `1px solid ${ltvRatio >= 90 ? 'rgba(224,82,82,0.25)' : ltvRatio >= 80 ? 'rgba(224,160,48,0.25)' : 'rgba(0,212,161,0.12)'}`, borderRadius: 14, padding: '11px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onClick={() => setActiveTab('portfolio')}>
          <div style={{ width: 28, height: 28, borderRadius: 9, background: ltvRatio >= 80 ? 'rgba(239,68,68,0.12)' : 'rgba(0,212,161,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={ltvRatio >= 80 ? (ltvRatio >= 90 ? '#EF4444' : '#F59E0B') : 'var(--jade)'} strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: ltvRatio >= 90 ? '#EF4444' : ltvRatio >= 80 ? '#F59E0B' : 'var(--jade)', marginBottom: 1 }}>
              {ltvRatio >= 90 ? 'Margin Call Active' : ltvRatio >= 80 ? 'Portfolio Alert' : 'Account healthy'}
            </p>
            <p style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
              {ltvRatio >= 80 ? ltv?.message : 'Your portfolio holds are supporting the account comfortably within range'}
            </p>
          </div>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
        </motion.div>

        {/* Action buttons */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div style={{ display: 'grid', gridTemplateColumns: outstanding > 0 ? '1fr 1fr' : '1fr', gap: 10, marginBottom: 16 }}>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} onClick={onPay}
              style={{ height: 54, borderRadius: 16, background: available > 0 ? 'linear-gradient(135deg, var(--jade), #00A878)' : 'var(--bg-elevated)', color: available > 0 ? '#000' : 'var(--text-muted)', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-sans)', border: available <= 0 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>Scan & Pay</motion.button>
            {outstanding > 0 && (
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} onClick={() => setActiveTab('billing')}
                style={{ height: 54, borderRadius: 16, background: 'rgba(201,164,73,0.12)', border: '1px solid rgba(201,164,73,0.3)', color: '#C9A449', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C9A449" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-4"/></svg>
                Repay Now
              </motion.button>
            )}
          </div>
        </motion.div>

        {/* Credit Summary Card */}
        <CreditSummaryCard account={account} ltvHealth={ltv} />

        {/* Transactions */}
        {transactions.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>Recent</p>
              <motion.button whileTap={{ scale: 0.96 }} onClick={handleViewAll} style={{ fontSize: 11, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}>
                {showAllTxns ? 'Show less' : 'View all →'}
              </motion.button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {displayedTxns.map((txn, i) => (
                <ScrollReveal key={txn.txn_id || i} scrollY={scrollY}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px' }}>
                    <div style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{txnIcon(txn.merchant_name)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{txn.merchant_name}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {txn.initiated_at ? new Date(txn.initiated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'}
                        {txn.is_in_free_period && <span style={{ color: 'var(--jade)', marginLeft: 6 }}>· Free</span>}
                      </p>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      {/* FIX: fmtL already has ₹ */}
                      <p style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>+{fmtL(txn.amount)}</p>
                      <p style={{ fontSize: 9, color: txn.status === 'SETTLED' ? 'var(--jade)' : 'var(--text-muted)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{txn.status}</p>
                    </div>
                  </div>
                </ScrollReveal>
              ))}
            </div>
          </motion.div>
        )}

        {/* Portfolio peek — FIX: fmtL already has ₹ */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <div style={{ background: 'linear-gradient(135deg, rgba(0,212,161,0.07), rgba(0,212,161,0.02))', border: '1px solid var(--jade-border)', borderRadius: 18, padding: '16px', marginBottom: 24, marginTop: 16, cursor: 'pointer' }}
            onClick={() => setActiveTab('portfolio')}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>PORTFOLIO</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: ltvColor }} />
                <span style={{ fontSize: 9, color: ltvColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{ltv?.status || 'GREEN'}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 22 }}>{fmtL(ltv?.current_pledge_value || 0)}</p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Pledged portfolio value</p>
          </div>
        </motion.div>
      </div>

      {/* Notification bottom sheet — renders outside scroll, zero overlap */}
      <NotificationSheet
        creditAccount={account}
        ltvHealth={ltv}
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
      />

      <AnimatePresence>
        {showSimulator && <RiskSimulator creditAccount={account} ltvHealth={ltv} onClose={() => setShowSimulator(false)} />}
      </AnimatePresence>
    </div>
  )
}
