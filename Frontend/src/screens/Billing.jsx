import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getStatements, getRepayments, mockRepay, getTxnHistory, getCreditStatus } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtDate  = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) }
const fmtShort = (d) => { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) }

// ── Donut circle indicator ────────────────────────────────────
function OutstandingDonut({ outstanding, available, dueDate }) {
  const total = outstanding + available
  const pct   = total > 0 ? outstanding / total : 0
  const r     = 52
  const circ  = 2 * Math.PI * r
  const dash  = pct * circ
  const statusColor = outstanding === 0 ? 'var(--jade)' : pct > 0.7 ? '#EF4444' : pct > 0.4 ? '#F59E0B' : 'var(--jade)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0 4px' }}>
      <div style={{ position: 'relative', width: 130, height: 130 }}>
        <svg width="130" height="130" viewBox="0 0 130 130">
          {/* Track */}
          <circle cx="65" cy="65" r={r} fill="none" stroke="rgba(0,212,161,0.08)" strokeWidth="8"/>
          {/* Used arc */}
          <motion.circle cx="65" cy="65" r={r} fill="none" stroke={statusColor} strokeWidth="8"
            strokeDasharray={`${dash} ${circ}`} strokeDashoffset={circ / 4} strokeLinecap="round"
            initial={{ strokeDasharray: `0 ${circ}` }}
            animate={{ strokeDasharray: `${dash} ${circ}` }}
            transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}/>
        </svg>
        {/* Center text */}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '1px', marginBottom: 2 }}>OUTSTANDING</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: outstanding > 99999 ? 16 : 20, color: statusColor, lineHeight: 1 }}>{fmt(outstanding)}</p>
        </div>
      </div>

      {/* Available + Used labels */}
      <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>AVAILABLE</p>
          <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmt(available)}</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>USED</p>
          <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: outstanding > 0 ? statusColor : 'var(--text-secondary)' }}>{fmt(outstanding)}</p>
        </div>
      </div>
    </div>
  )
}

// ── NACH Auto-pay entries ─────────────────────────────────────
const DEMO_AUTOPAY = [
  { name: 'Netflix', category: 'Subscription', amount: 649, color: '#E05252', initials: 'NF', due: 'Apr 15' },
  { name: 'Spotify', category: 'Music',        amount: 119, color: '#1DB954', initials: 'SP', due: 'Apr 18' },
  { name: 'Gym',     category: 'Fitness',      amount: 1500, color: '#4DA8FF', initials: 'GY', due: 'Apr 1'  },
]

export default function Billing() {
  const { statements, setStatements, creditAccount, setCreditAccount } = useStore()
  const [repayments, setRepayments] = useState([])
  const [activeTxns, setActiveTxns] = useState([])
  const [loading, setLoading]       = useState(true)
  const [repaying, setRepaying]     = useState(false)
  const [selected, setSelected]     = useState(null)
  const [repayModal, setRepayModal] = useState(null)
  const [customAmt, setCustomAmt]   = useState('')
  const [nachSetup, setNachSetup]   = useState(false)
  const [nachModal, setNachModal]   = useState(false)

  const outstanding = parseFloat(creditAccount?.outstanding || 0)
  const available   = parseFloat(creditAccount?.available_credit || 0)
  const dueDate     = creditAccount?.due_date
  const daysUntilDue = dueDate ? Math.max(0, Math.ceil((new Date(dueDate) - Date.now()) / 86400000)) : null

  useEffect(() => {
    const load = async () => {
      try { const res = await getStatements(); setStatements(Array.isArray(res.data) ? res.data : res.data?.statements || []) } catch(e) { setStatements([]) }
      try { const res = await getRepayments(); setRepayments(Array.isArray(res.data) ? res.data : res.data?.repayments || []) } catch(e) {}
      try {
        const r = await getTxnHistory({ limit: 50 })
        setActiveTxns((r.data?.transactions || []).filter(t => t.status === 'SETTLED' || t.status === 'PRE_AUTHORISED'))
      } catch(e) {}
      try { const r = await getCreditStatus(); setCreditAccount(r.data) } catch(e) {}
      setLoading(false)
    }
    load()
  }, [])

  const handleRepay = async (amount) => {
    if (!amount || amount <= 0) return toast.error('Enter a valid amount')
    if (amount > outstanding) return toast.error(`Cannot repay more than ₹${fmt(outstanding)} outstanding`)
    setRepaying(true)
    try {
      await mockRepay(amount)
      toast.success(`${fmt(amount)} repaid! 🎉`)
      setRepayModal(null); setSelected(null); setCustomAmt('')
      const stmtRes = await getStatements(); setStatements(Array.isArray(stmtRes.data) ? stmtRes.data : stmtRes.data?.statements || [])
      const repRes  = await getRepayments(); setRepayments(Array.isArray(repRes.data) ? repRes.data : repRes.data?.repayments || [])
      const creditRes = await getCreditStatus(); setCreditAccount(creditRes.data)
    } catch(err) { toast.error(err.message || 'Repayment failed') }
    finally { setRepaying(false) }
  }

  const safeStatements = Array.isArray(statements) ? statements : []
  const freePeriodTxns = activeTxns.filter(t => t.is_in_free_period)

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Billing</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>Statements & repayments</p>
        </motion.div>

        {/* Donut indicator */}
        <OutstandingDonut outstanding={outstanding} available={available} dueDate={dueDate} />

        {/* Status banner */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          style={{ background: outstanding === 0 ? 'rgba(0,212,161,0.06)' : daysUntilDue !== null && daysUntilDue <= 3 ? 'var(--red-dim)' : 'var(--amber-dim)', border: `1px solid ${outstanding === 0 ? 'rgba(0,212,161,0.12)' : daysUntilDue !== null && daysUntilDue <= 3 ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.2)'}`, borderRadius: 14, padding: '12px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 9, background: outstanding === 0 ? 'rgba(0,212,161,0.12)' : 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={outstanding === 0 ? 'var(--jade)' : '#F59E0B'} strokeWidth="2.5">
              {outstanding === 0 ? <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></> : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>}
            </svg>
          </div>
          <p style={{ fontSize: 12, color: outstanding === 0 ? 'var(--jade)' : '#F59E0B', fontWeight: 600 }}>
            {outstanding === 0 ? 'No immediate repayment pressure' : daysUntilDue !== null && daysUntilDue <= 3 ? `Due in ${daysUntilDue} days — pay to avoid interest` : `${fmt(outstanding)} outstanding · Due ${fmtDate(dueDate)}`}
          </p>
        </motion.div>

        {/* Repay section */}
        {outstanding > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            {/* Full repay button */}
            <motion.button whileTap={{ scale: 0.97 }} disabled={repaying}
              onClick={() => handleRepay(outstanding)}
              style={{ width: '100%', height: 50, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', marginBottom: 10, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-4"/></svg>
              {repaying ? 'Processing…' : `Repay Full ${fmt(outstanding)}`}
            </motion.button>

            {/* Custom amount input */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '0 14px' }}>
                <span style={{ fontSize: 15, color: 'var(--text-muted)', marginRight: 4 }}>₹</span>
                <input type="number" inputMode="numeric" placeholder="Custom amount"
                  value={customAmt} onChange={e => setCustomAmt(e.target.value)}
                  style={{ flex: 1, height: 46, fontSize: 14, fontFamily: 'var(--font-mono)', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)' }} />
              </div>
              <motion.button whileTap={{ scale: 0.96 }} disabled={repaying || !customAmt}
                onClick={() => handleRepay(parseFloat(customAmt))}
                style={{ width: 70, height: 46, borderRadius: 14, background: customAmt ? 'var(--jade)' : 'var(--bg-elevated)', border: `1px solid ${customAmt ? 'transparent' : 'var(--border)'}`, color: customAmt ? '#000' : 'var(--text-muted)', fontSize: 13, fontWeight: 700, cursor: customAmt ? 'pointer' : 'not-allowed' }}>
                Pay
              </motion.button>
            </div>

            {/* Free period callout */}
            {freePeriodTxns.length > 0 && (
              <div style={{ background: 'rgba(0,212,161,0.06)', border: '1px solid rgba(0,212,161,0.12)', borderRadius: 12, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600 }}>
                  {freePeriodTxns.length} txn{freePeriodTxns.length > 1 ? 's' : ''} in free period — interest-free until {fmtDate(dueDate)}
                </p>
              </div>
            )}
          </motion.div>
        )}

        {/* Statements */}
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
            {[1, 2].map(i => <div key={i} className="shimmer" style={{ height: 100, borderRadius: 16 }} />)}
          </div>
        ) : safeStatements.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '32px 24px', textAlign: 'center', marginBottom: 16 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" style={{ margin: '0 auto 10px', display: 'block' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
            </svg>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No statements yet</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>Statements generate at end of your billing cycle.</p>
          </motion.div>
        ) : (
          <>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>PAST STATEMENTS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
              {safeStatements.map((stmt, i) => (
                <motion.div key={stmt.statement_id || i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
                  <div onClick={() => setSelected(selected === stmt.statement_id ? null : stmt.statement_id)}
                    style={{ padding: '14px 16px', cursor: 'pointer' }}>
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
                      {[{ l: 'Spent', v: fmt(stmt.total_spend || stmt.total_drawdowns || 0) }, { l: 'Interest', v: fmt(stmt.total_interest || stmt.interest_charged || 0) }, { l: 'Min Due', v: fmt(stmt.minimum_amount_due || stmt.minimum_due || 0) }].map((s, j) => (
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
                          <motion.button whileTap={{ scale: 0.96 }} disabled={repaying}
                            onClick={e => { e.stopPropagation(); handleRepay(parseFloat(stmt.minimum_amount_due || stmt.minimum_due || 0)) }}
                            style={{ flex: 1, height: 42, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                            Min {fmt(stmt.minimum_amount_due || stmt.minimum_due || 0)}
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.96 }} disabled={repaying}
                            onClick={e => { e.stopPropagation(); handleRepay(parseFloat(stmt.total_due)) }}
                            style={{ flex: 1, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}>
                            Full {fmt(stmt.total_due)}
                          </motion.button>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </>
        )}

        {/* NACH Auto-pay section */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)' }}>AUTO-PAY</p>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => setNachModal(true)}
              style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
              {nachSetup ? 'MANAGE' : 'SET UP'}
            </motion.button>
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

        {/* Interest info pills */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 24 }}>
          {[
            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>, label: '30 days', sub: 'Interest-free' },
            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>, label: '1%/mo', sub: 'After due date' },
            { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.08-4"/></svg>, label: 'Flexible', sub: 'Repay anytime' },
          ].map((item, i) => (
            <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>{item.icon}</div>
              <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{item.label}</p>
              <p style={{ fontSize: 9, color: 'var(--text-muted)' }}>{item.sub}</p>
            </div>
          ))}
        </div>

        {/* Repayment history */}
        {repayments.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
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
          </motion.div>
        )}

        <div style={{ height: 20 }} />
      </div>

      {/* NACH Setup Modal */}
      <AnimatePresence>
        {nachModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
            onClick={() => setNachModal(false)}>
            <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              style={{ background: 'var(--bg-elevated)', borderRadius: '24px 24px 0 0', padding: '24px 20px 44px', width: '100%' }}
              onClick={e => e.stopPropagation()}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>NACH AUTO-PAY MANDATE</p>
              <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Setup Auto-Repayment</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
                NACH mandate allows LienPay to automatically debit your bank account for minimum due amounts on the due date. You can cancel anytime.
              </p>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px', marginBottom: 20 }}>
                {[{ label: 'Mandate Type', value: 'NACH (National Automated Clearing House)' }, { label: 'Debit Amount', value: 'Minimum due on statement date' }, { label: 'Debit Date', value: 'Due date of each billing cycle' }, { label: 'Bank', value: 'Linked bank account' }].map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: i < 3 ? 10 : 0 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.label}</p>
                    <p style={{ fontSize: 11, fontWeight: 600, textAlign: 'right', maxWidth: '55%' }}>{r.value}</p>
                  </div>
                ))}
              </div>
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
    </div>
  )
}
