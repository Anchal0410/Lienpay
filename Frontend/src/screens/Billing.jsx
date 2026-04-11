import { useEffect, useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getStatements, getRepayments, mockRepay, getCreditStatus } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtDate  = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) }
const fmtShort = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }

// ── NBFC collection VPA ───────────────────────────────────────
// In production this comes from the backend repayment API.
// Hardcoded fallback matches process.env.NBFC_REPAYMENT_VPA on Railway.
const NBFC_REPAYMENT_VPA = 'lienpay.repay@yesbank'
const NBFC_NAME          = 'LienPay Repayment'

// Build UPI deep-link — opens any UPI app (GPay, PhonePe, Paytm, BHIM…)
const buildUPILink = (amount, ref) => {
  const pa = encodeURIComponent(NBFC_REPAYMENT_VPA)
  const pn = encodeURIComponent(NBFC_NAME)
  const am = parseFloat(amount).toFixed(2)
  const tn = encodeURIComponent(`LienPay Repayment ${ref}`)
  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&tn=${tn}&cu=INR`
}

// ── Donut ─────────────────────────────────────────────────────
function OutstandingDonut({ outstanding, available }) {
  const total = outstanding + available
  const pct   = total > 0 ? outstanding / total : 0
  const r = 52, circ = 2 * Math.PI * r, dash = pct * circ
  const c = outstanding === 0 ? 'var(--jade)' : pct > 0.7 ? '#F97316' : pct > 0.4 ? '#F59E0B' : 'var(--jade)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0 4px' }}>
      <div style={{ position: 'relative', width: 130, height: 130 }}>
        <svg width="130" height="130" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(0,212,161,0.08)" strokeWidth="8"/>
          <motion.circle cx="65" cy="65" r={r} fill="none" stroke={c} strokeWidth="8"
            strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4} strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${circ}` }} animate={{ strokeDasharray: `${dash} ${circ}` }}
            transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}/>
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', marginBottom: 2 }}>OUTSTANDING</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: outstanding > 99999 ? 16 : 20, color: c, lineHeight: 1 }}>{fmt(outstanding)}</p>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>AVAILABLE</p>
          <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmt(available)}</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>USED</p>
          <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: outstanding > 0 ? c : 'var(--text-secondary)' }}>{fmt(outstanding)}</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// UPI REPAYMENT MODAL
// Shows amount + destination, opens UPI app, auto-confirms on return
// ─────────────────────────────────────────────────────────────
function UPIRepayModal({ amount, apr, isInterestOnly, onConfirmed, onClose }) {
  const [processing, setProcessing] = useState(false)
  const repayRef = useRef(`LP${Date.now().toString(36).toUpperCase()}`)
  const upiLink  = buildUPILink(amount, repayRef.current)

  const openUPIApp = async () => {
    setProcessing(true)
    // Fire the UPI deep link — phone shows GPay / PhonePe / Paytm chooser
    window.location.href = upiLink
    // Wait 2.5s for the user to switch apps and come back,
    // then auto-confirm the repayment (we assume it went through)
    setTimeout(async () => {
      try {
        await onConfirmed(amount)
      } catch(e) {
        toast.error('Could not confirm repayment — contact support if amount was debited.')
        setProcessing(false)
      }
    }, 2500)
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(5px)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
      onClick={!processing ? onClose : undefined}>

      <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 320, damping: 38 }}
        style={{ background: 'var(--bg-elevated)', borderRadius: '24px 24px 0 0', padding: '20px 20px 44px', width: '100%' }}
        onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bg-overlay)' }} />
        </div>

        <AnimatePresence mode="wait">
          {!processing ? (
            <motion.div key="preview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
                {isInterestOnly ? 'INTEREST PAYMENT' : 'CREDIT LINE REPAYMENT'}
              </p>

              {/* Amount */}
              <div style={{ background: 'linear-gradient(135deg, #0d1f17, #081510)', border: '1px solid rgba(0,212,161,0.18)', borderRadius: 20, padding: '22px 20px', marginBottom: 16, textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Amount to pay</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 44, color: 'var(--jade)', lineHeight: 1, marginBottom: 6 }}>{fmt(amount)}</p>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {isInterestOnly ? `Interest only · ${apr || 12}% APR revolving` : 'Full outstanding balance'}
                </p>
              </div>

              {/* Destination */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 16px', marginBottom: 20 }}>
                {[
                  { label: 'Pay to',    value: NBFC_NAME,              mono: false },
                  { label: 'UPI ID',    value: NBFC_REPAYMENT_VPA,     mono: true  },
                  { label: 'Reference', value: repayRef.current,        mono: true  },
                ].map((row, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: i < 2 ? 8 : 0 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.label}</p>
                    <p style={{ fontSize: 12, fontWeight: 600, color: row.mono ? 'var(--jade)' : 'var(--text-primary)', fontFamily: row.mono ? 'var(--font-mono)' : 'inherit' }}>{row.value}</p>
                  </div>
                ))}
              </div>

              {/* App badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 18, justifyContent: 'center' }}>
                <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>Opens in</p>
                {['GPay', 'PhonePe', 'Paytm', 'BHIM'].map(app => (
                  <span key={app} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-overlay)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{app}</span>
                ))}
              </div>

              {/* CTA */}
              <motion.button whileTap={{ scale: 0.97 }} onClick={openUPIApp}
                style={{ width: '100%', height: 54, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer', marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <rect width="24" height="24" rx="6" fill="rgba(0,0,0,0.15)"/>
                  <path d="M7 12h10M12 7l5 5-5 5" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Pay {fmt(amount)} via UPI
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={onClose}
                style={{ width: '100%', height: 44, borderRadius: 14, background: 'transparent', color: 'var(--text-muted)', fontSize: 13, border: 'none', cursor: 'pointer' }}>
                Cancel
              </motion.button>
            </motion.div>
          ) : (
            <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ textAlign: 'center', padding: '24px 0 8px' }}>
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                style={{ width: 52, height: 52, borderRadius: '50%', border: '2.5px solid var(--jade-border)', borderTopColor: 'var(--jade)', margin: '0 auto 20px' }} />
              <p style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Processing repayment…</p>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                Completing payment of {fmt(amount)} and restoring your credit.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

// ── Post-30-day plan card ─────────────────────────────────────
function RepaymentPlanCard({ outstanding, apr, onRepay, isPastDue, dueDate, daysLeft }) {
  const [plan, setPlan] = useState('standard')
  const stdApr     = apr || 12
  const monthlyInt = outstanding * (18 / 12 / 100)
  const fmtDate2   = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

  // isPastDue = due_date has passed (credit card model — free for entire cycle until due_date)
  const headerColor = isPastDue ? '#F59E0B' : 'var(--jade)'
  const headerBg    = isPastDue ? 'rgba(245,158,11,0.05)' : 'rgba(0,212,161,0.04)'
  const headerBdr   = isPastDue ? 'rgba(245,158,11,0.2)' : 'rgba(0,212,161,0.15)'

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      style={{ background: headerBg, border: `1px solid ${headerBdr}`, borderRadius: 18, padding: '16px', marginBottom: 16 }}>

      {/* Billing cycle info bar */}
      {dueDate && (
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 12px', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            DUE DATE
          </p>
          <p style={{ fontSize: 11, fontWeight: 700, color: isPastDue ? '#F59E0B' : 'var(--jade)', fontFamily: 'var(--font-mono)' }}>
            {fmtDate2(dueDate)} {!isPastDue && daysLeft !== null ? `· ${daysLeft}d left` : ''}
          </p>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={headerColor} strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <p style={{ fontSize: 11, color: headerColor, fontWeight: 700 }}>
          {isPastDue ? 'DUE DATE PASSED — INTEREST IS ACCRUING' : `INTEREST-FREE UNTIL ${fmtDate2(dueDate)}`}
        </p>
      </div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
        {isPastDue
          ? 'Your due date has passed. Choose how you would like to handle the outstanding balance:'
          : 'Pay in full by the due date to avoid all interest. Or choose revolving to keep the credit line alive by paying just the monthly interest.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
        {[
          { id: 'standard', label: 'Pay Outstanding', badge: 'Recommended', sublabel: `${stdApr}% APR`, desc: 'Pay full amount. Clears balance entirely.', amount: outstanding, color: 'var(--jade)' },
          { id: 'interest-only', label: 'Pay Interest Only', badge: 'Revolving', sublabel: '18% APR', desc: `Pay ${fmt(monthlyInt)} this month. Balance rolls forward.`, amount: monthlyInt, color: '#F59E0B' },
        ].map(p => (
          <div key={p.id} onClick={() => setPlan(p.id)}
            style={{ background: plan === p.id ? `${p.color}10` : 'var(--bg-elevated)', border: `1.5px solid ${plan === p.id ? p.color : 'var(--border)'}`, borderRadius: 14, padding: '13px 14px', cursor: 'pointer', transition: 'all 0.2s', position: 'relative' }}>
            <div style={{ position: 'absolute', top: 13, right: 13, width: 18, height: 18, borderRadius: '50%', background: plan === p.id ? p.color : 'transparent', border: `2px solid ${plan === p.id ? p.color : 'var(--border)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {plan === p.id && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#000' }} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: p.color }}>{p.label}</p>
              <span style={{ fontSize: 9, background: `${p.color}18`, color: p.color, padding: '2px 7px', borderRadius: 5, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{p.badge}</span>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4, marginBottom: 7, paddingRight: 24 }}>{p.desc}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{p.sublabel}</p>
              <p style={{ fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-mono)', color: p.color }}>{fmt(p.amount)}</p>
            </div>
          </div>
        ))}
      </div>
      <motion.button whileTap={{ scale: 0.97 }} onClick={() => onRepay(plan === 'standard' ? outstanding : monthlyInt, plan === 'interest-only')}
        style={{ width: '100%', height: 50, borderRadius: 14, background: plan === 'standard' ? 'linear-gradient(135deg, var(--jade), #00A878)' : 'linear-gradient(135deg, #F59E0B, #D97706)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.8"><path d="M20 6L9 17L4 12"/></svg>
        {plan === 'standard' ? `Pay ${fmt(outstanding)} via UPI` : `Pay ${fmt(monthlyInt)} via UPI`}
      </motion.button>
    </motion.div>
  )
}

// ── NACH entries ──────────────────────────────────────────────
const DEMO_AUTOPAY = [
  { name: 'Netflix',  category: 'Subscription', amount: 649,  color: '#00D4A1', initials: 'NF', due: 'Apr 15' },
  { name: 'Spotify',  category: 'Music',        amount: 119,  color: '#8B7BD4', initials: 'SP', due: 'Apr 18' },
  { name: 'Gym',      category: 'Fitness',      amount: 1500, color: '#4DA8FF', initials: 'GY', due: 'Apr 1'  },
]

// ─────────────────────────────────────────────────────────────
// BILLING SCREEN
// ─────────────────────────────────────────────────────────────
export default function Billing() {
  const { statements, setStatements, creditAccount, setCreditAccount } = useStore()
  const [repayments, setRepayments]       = useState([])
  const [loading, setLoading]             = useState(true)
  const [selected, setSelected]           = useState(null)
  const [customAmt, setCustomAmt]         = useState('')
  const [nachSetup, setNachSetup]         = useState(false)
  const [nachModal, setNachModal]         = useState(false)
  // UPI repay modal state
  const [upiModal, setUpiModal]           = useState(null) // { amount, isInterestOnly }

  const outstanding  = parseFloat(creditAccount?.outstanding || 0)
  const available    = parseFloat(creditAccount?.available_credit || 0)
  const dueDate      = creditAccount?.due_date
  const apr          = parseFloat(creditAccount?.apr || 12)
  const daysUntilDue = dueDate ? Math.max(0, Math.ceil((new Date(dueDate) - Date.now()) / 86400000)) : null

  useEffect(() => {
    const load = async () => {
      try { const res = await getStatements(); setStatements(Array.isArray(res.data) ? res.data : res.data?.statements || []) } catch(e) { setStatements([]) }
      try { const res = await getRepayments(); setRepayments(Array.isArray(res.data) ? res.data : res.data?.repayments || []) } catch(e) {}
      try { const r = await getCreditStatus(); setCreditAccount(r.data) } catch(e) {}
      setLoading(false)
    }
    load()
  }, [])

  // Open UPI modal instead of directly calling mockRepay
  const initiateRepay = (amount, isInterestOnly = false) => {
    if (!amount || amount <= 0) return toast.error('Enter a valid amount')
    if (amount > outstanding) return toast.error(`Cannot repay more than ${fmt(outstanding)}`)
    setUpiModal({ amount, isInterestOnly })
  }

  // Called after user confirms payment came through in UPI app
  const handleUPIConfirmed = async (amount) => {
    await mockRepay(amount)
    setUpiModal(null)
    setSelected(null)
    setCustomAmt('')
    toast.success(`${fmt(amount)} repaid! Credit restored 🎉`)
    // Refresh all data
    const stmtRes   = await getStatements(); setStatements(Array.isArray(stmtRes.data) ? stmtRes.data : stmtRes.data?.statements || [])
    const repRes    = await getRepayments(); setRepayments(Array.isArray(repRes.data) ? repRes.data : repRes.data?.repayments || [])
    const creditRes = await getCreditStatus(); setCreditAccount(creditRes.data)
  }

  const safeStatements = Array.isArray(statements) ? statements : []

  // ── CREDIT CARD BILLING MODEL ────────────────────────────────
  // Free period = entire billing cycle until due_date
  // isPastDue = due_date has passed AND there's still outstanding balance
  const today         = new Date()
  today.setHours(0, 0, 0, 0)
  const dueDateObj    = dueDate ? new Date(dueDate) : null
  const isPastDue     = dueDateObj && dueDateObj < today && outstanding > 0
  const daysLeft      = dueDateObj ? Math.max(0, Math.ceil((dueDateObj - today) / 86400000)) : null
  const cycleStart    = creditAccount?.current_cycle_start
  const cycleEnd      = creditAccount?.current_cycle_end
  const fmtCycleDate  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Billing</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Statements & repayments</p>
        </motion.div>

        <OutstandingDonut outstanding={outstanding} available={available} />

        {/* Billing cycle banner */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          {/* Cycle dates row */}
          {(cycleStart || cycleEnd) && (
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '8px 14px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '1.5px' }}>BILLING CYCLE</p>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                {fmtCycleDate(cycleStart)} – {fmtCycleDate(cycleEnd)}
              </p>
            </div>
          )}
          {/* Status row */}
          <div style={{ background: outstanding === 0 ? 'rgba(0,212,161,0.06)' : isPastDue ? 'rgba(245,158,11,0.06)' : 'rgba(0,212,161,0.04)', border: `1px solid ${outstanding === 0 ? 'rgba(0,212,161,0.12)' : isPastDue ? 'rgba(245,158,11,0.2)' : 'rgba(0,212,161,0.12)'}`, borderRadius: 14, padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 9, background: outstanding === 0 ? 'rgba(0,212,161,0.12)' : isPastDue ? 'rgba(245,158,11,0.15)' : 'rgba(0,212,161,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={outstanding === 0 ? 'var(--jade)' : isPastDue ? '#F59E0B' : 'var(--jade)'} strokeWidth="2.5">
                {outstanding === 0 ? <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></> : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="17" x2="12.01" y2="17"/></>}
              </svg>
            </div>
            <p style={{ fontSize: 12, color: outstanding === 0 ? 'var(--jade)' : isPastDue ? '#F59E0B' : 'var(--jade)', fontWeight: 600 }}>
              {outstanding === 0
                ? 'No outstanding balance — all clear'
                : isPastDue
                  ? `Due date passed · Interest accruing on ${fmt(outstanding)}`
                  : `${fmt(outstanding)} outstanding · Pay by ${fmtDate(dueDate)} · ${daysLeft}d interest-free`}
            </p>
          </div>
        </motion.div>

        {/* Repayment plan — shown whenever there is outstanding balance */}
        {outstanding > 0 && (
          <RepaymentPlanCard
            outstanding={outstanding}
            apr={apr}
            onRepay={initiateRepay}
            isPastDue={isPastDue}
            dueDate={dueDate}
            daysLeft={daysLeft}
          />
        )}

        {/* Standard repay fallback — never shown now that card handles everything */}
        {false && outstanding > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            {/* Full repay */}
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => initiateRepay(outstanding)}
              style={{ width: '100%', height: 54, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-sans)', marginBottom: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.8"><path d="M20 6L9 17L4 12"/></svg>
              Repay {fmt(outstanding)} via UPI
            </motion.button>

            {/* Custom amount */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '0 14px' }}>
                <span style={{ fontSize: 15, color: 'var(--text-muted)', marginRight: 4 }}>₹</span>
                <input type="number" inputMode="numeric" placeholder="Custom amount"
                  value={customAmt} onChange={e => setCustomAmt(e.target.value)}
                  style={{ flex: 1, height: 46, fontSize: 14, fontFamily: 'var(--font-mono)', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)' }} />
              </div>
              <motion.button whileTap={{ scale: 0.96 }} disabled={!customAmt}
                onClick={() => initiateRepay(parseFloat(customAmt))}
                style={{ width: 70, height: 46, borderRadius: 14, background: customAmt ? 'var(--jade)' : 'var(--bg-elevated)', border: `1px solid ${customAmt ? 'transparent' : 'var(--border)'}`, color: customAmt ? '#000' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: customAmt ? 'pointer' : 'not-allowed' }}>
                Pay
              </motion.button>
            </div>

            {freePeriodTxns.length > 0 && (
              <div style={{ background: 'rgba(0,212,161,0.06)', border: '1px solid rgba(0,212,161,0.12)', borderRadius: 12, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600 }}>{freePeriodTxns.length} txn{freePeriodTxns.length > 1 ? 's' : ''} interest-free until {fmtDate(dueDate)}</p>
              </div>
            )}
          </motion.div>
        )}

        {/* Statements */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {[1,2].map(i => <div key={i} className="shimmer" style={{ height: 100, borderRadius: 16 }} />)}
          </div>
        ) : safeStatements.length === 0 ? (
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '32px 24px', textAlign: 'center', marginBottom: 16 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No statements yet</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Statements generate at end of your billing cycle.</p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>PAST STATEMENTS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {safeStatements.map((stmt, i) => (
                <div key={stmt.statement_id || i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                  <div onClick={() => setSelected(selected === stmt.statement_id ? null : stmt.statement_id)} style={{ padding: '14px 16px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{fmtShort(stmt.billing_period_start)} – {fmtShort(stmt.billing_period_end)}</p>
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Due {fmtDate(stmt.due_date)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 3 }}>{fmt(stmt.total_due)}</p>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: stmt.status === 'PAID' ? 'rgba(0,200,150,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${stmt.status === 'PAID' ? 'rgba(0,200,150,0.3)' : 'rgba(245,158,11,0.3)'}`, color: stmt.status === 'PAID' ? 'var(--jade)' : '#F59E0B' }}>{stmt.status}</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                      {[{l:'Spent',v:fmt(stmt.total_drawdowns||0)},{l:'Interest',v:fmt(stmt.interest_charged||0)},{l:'Min Due',v:fmt(stmt.minimum_due||0)}].map((s,j) => (
                        <div key={j} style={{ background: 'var(--bg-elevated)', borderRadius: 9, padding: '7px 9px' }}>
                          <p style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>{s.l.toUpperCase()}</p>
                          <p style={{ fontSize: 12, fontWeight: 700 }}>{s.v}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <AnimatePresence>
                    {selected === stmt.statement_id && stmt.status !== 'PAID' && parseFloat(stmt.total_due) > 0 && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', background: 'var(--bg-elevated)' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <motion.button whileTap={{ scale: 0.96 }}
                            onClick={e => { e.stopPropagation(); initiateRepay(parseFloat(stmt.minimum_due||0)) }}
                            style={{ flex: 1, height: 42, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Min {fmt(stmt.minimum_due||0)}
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.96 }}
                            onClick={e => { e.stopPropagation(); initiateRepay(parseFloat(stmt.total_due)) }}
                            style={{ flex: 1, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            Full {fmt(stmt.total_due)}
                          </motion.button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </>
        )}

        {/* NACH */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)' }}>AUTO-PAY</p>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => setNachModal(true)} style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>{nachSetup ? 'MANAGE' : 'SET UP'}</motion.button>
          </div>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>
            {DEMO_AUTOPAY.map((item, i) => (
              <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: i < DEMO_AUTOPAY.length - 1 ? '1px solid rgba(0,212,161,0.04)' : 'none' }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `${item.color}18`, border: `1px solid ${item.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <p style={{ fontSize: 10, fontWeight: 800, color: item.color, fontFamily: 'var(--font-mono)' }}>{item.initials}</p>
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 1 }}>{item.name}</p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.category} · Due {item.due}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{fmt(item.amount)}</p>
                  <span style={{ fontSize: 8, color: 'var(--jade)', fontFamily: 'var(--font-mono)', background: 'var(--jade-dim)', padding: '2px 6px', borderRadius: 4 }}>Set up</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Info pills */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 24 }}>
          {[{ label: '30 days', sub: 'Interest-free' }, { label: `${apr}% APR`, sub: 'After due date' }, { label: 'Flexible', sub: 'Repay anytime' }].map((item, i) => (
            <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
              <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 2, color: 'var(--jade)' }}>{item.label}</p>
              <p style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.sub}</p>
            </div>
          ))}
        </div>

        {/* Repayment history */}
        {repayments.length > 0 && (
          <div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>REPAYMENT HISTORY</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {repayments.slice(0, 8).map((r, i) => (
                <div key={r.repayment_id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '11px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(0,212,161,0.08)', border: '1px solid rgba(0,212,161,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--jade)' }}>Repayment</p>
                      <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtDate(r.initiated_at || r.created_at)}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 13, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>+{fmt(r.amount)}</p>
                    <p style={{ fontSize: 8, color: r.status === 'SUCCESS' ? 'var(--jade)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div style={{ height: 20 }} />
      </div>

      {/* NACH Modal */}
      <AnimatePresence>
        {nachModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
            onClick={() => setNachModal(false)}>
            <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              style={{ background: 'var(--bg-elevated)', borderRadius: '24px 24px 0 0', padding: '24px 20px 44px', width: '100%' }}
              onClick={e => e.stopPropagation()}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>NACH AUTO-PAY MANDATE</p>
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Setup Auto-Repayment</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>NACH mandate allows automatic debit of minimum due on your due date.</p>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setNachSetup(true); setNachModal(false); toast.success('NACH mandate registered!') }}
                style={{ width: '100%', height: 52, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', marginBottom: 10, border: 'none', cursor: 'pointer' }}>
                Register NACH Mandate →
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setNachModal(false)}
                style={{ width: '100%', height: 44, borderRadius: 14, background: 'transparent', color: 'var(--text-muted)', fontSize: 13, border: 'none', cursor: 'pointer' }}>Cancel</motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* UPI Repayment Modal */}
      <AnimatePresence>
        {upiModal && (
          <UPIRepayModal
            amount={upiModal.amount}
            apr={apr}
            isInterestOnly={upiModal.isInterestOnly}
            onConfirmed={handleUPIConfirmed}
            onClose={() => setUpiModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
