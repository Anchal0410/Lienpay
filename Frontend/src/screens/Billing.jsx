import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getStatements, getRepayments, mockRepay, getTxnHistory, getCreditStatus } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}
const fmtShort = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function Billing() {
  const { statements, setStatements, creditAccount, setCreditAccount } = useStore()
  const [repayments, setRepayments]   = useState([])
  const [activeTxns, setActiveTxns]   = useState([])  // current period txns
  const [loading, setLoading]         = useState(true)
  const [repaying, setRepaying]       = useState(false)
  const [selected, setSelected]       = useState(null)
  const [repayModal, setRepayModal]   = useState(null)

  useEffect(() => {
    const load = async () => {
      // Statements
      try {
        const res = await getStatements()
        const arr = Array.isArray(res.data) ? res.data
          : Array.isArray(res.data?.statements) ? res.data.statements : []
        setStatements(arr)
      } catch(e) { setStatements([]) }

      // Repayments
      try {
        const res = await getRepayments()
        const arr = Array.isArray(res.data) ? res.data
          : Array.isArray(res.data?.repayments) ? res.data.repayments : []
        setRepayments(arr)
      } catch(e) {}

      // ── FIX: load current period transactions for early repayment ──
      try {
        const r = await getTxnHistory({ limit: 50 })
        const txns = (r.data?.transactions || []).filter(t =>
          t.status === 'SETTLED' || t.status === 'PRE_AUTHORISED'
        )
        setActiveTxns(txns)
      } catch(e) {}

      // Fresh credit status
      try {
        const r = await getCreditStatus()
        setCreditAccount(r.data)
      } catch(e) {}

      setLoading(false)
    }
    load()
  }, [])

  const handleRepay = async () => {
    if (!repayModal) return
    setRepaying(true)
    try {
      await mockRepay(repayModal.amount)
      toast.success(`${fmt(repayModal.amount)} repaid! 🎉`)
      setRepayModal(null)
      setSelected(null)
      // Refresh everything
      const stmtRes = await getStatements()
      setStatements(Array.isArray(stmtRes.data) ? stmtRes.data : (stmtRes.data?.statements || []))
      const repRes = await getRepayments()
      setRepayments(Array.isArray(repRes.data) ? repRes.data : (repRes.data?.repayments || []))
      const creditRes = await getCreditStatus()
      setCreditAccount(creditRes.data)
    } catch(err) {
      toast.error(err.message || 'Repayment failed')
    } finally {
      setRepaying(false)
    }
  }

  const safeStatements  = Array.isArray(statements) ? statements : []
  const outstanding     = parseFloat(creditAccount?.outstanding || 0)
  const dueDate         = creditAccount?.due_date

  // Days until due
  const daysUntilDue = dueDate ? Math.max(0, Math.ceil((new Date(dueDate) - Date.now()) / (1000 * 60 * 60 * 24))) : null

  // Calculate current cycle spend from transactions
  const currentCycleSpend = activeTxns.reduce((s, t) => s + parseFloat(t.amount || 0), 0)
  const freePeriodCount   = activeTxns.filter(t => t.is_in_free_period).length

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Billing</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>Statements & repayments</p>
        </motion.div>

        {/* ── CURRENT PERIOD — show even when no formal statement ── */}
        {outstanding > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: 'linear-gradient(135deg, var(--jade-dim), rgba(0,212,161,0.03))', border: '1px solid var(--jade-border)', borderRadius: 18, padding: '18px', marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <p style={{ fontSize: 9, color: 'var(--jade)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 600, marginBottom: 4 }}>CURRENT PERIOD</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 32, color: 'var(--jade)' }}>{fmt(outstanding)}</p>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>outstanding balance</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                {daysUntilDue !== null && (
                  <div style={{ background: daysUntilDue <= 7 ? 'var(--amber-dim)' : 'rgba(0,212,161,0.08)', border: `1px solid ${daysUntilDue <= 7 ? 'rgba(245,158,11,0.3)' : 'rgba(0,212,161,0.15)'}`, borderRadius: 10, padding: '6px 12px', marginBottom: 8 }}>
                    <p style={{ fontSize: 9, color: daysUntilDue <= 7 ? '#F59E0B' : 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {daysUntilDue > 0 ? `${daysUntilDue}d left` : 'Due today'}
                    </p>
                  </div>
                )}
                {freePeriodCount > 0 && (
                  <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {freePeriodCount} txn{freePeriodCount > 1 ? 's' : ''} interest-free
                  </p>
                )}
              </div>
            </div>

            {/* Transaction summary */}
            {activeTxns.length > 0 && (
              <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 12, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{activeTxns.length} transaction{activeTxns.length > 1 ? 's' : ''} this cycle</p>
                  <p style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>{fmt(currentCycleSpend)}</p>
                </div>
                {/* Latest txns */}
                {activeTxns.slice(0, 3).map((t, i) => (
                  <div key={t.txn_id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: t.is_in_free_period ? 'var(--jade)' : 'var(--text-muted)', flexShrink: 0 }} />
                      <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t.merchant_name}</p>
                    </div>
                    <p style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{fmt(t.amount)}</p>
                  </div>
                ))}
                {activeTxns.length > 3 && (
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, textAlign: 'center' }}>+{activeTxns.length - 3} more transactions</p>
                )}
              </div>
            )}

            {/* Repay early button */}
            <div style={{ display: 'flex', gap: 8 }}>
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={() => setRepayModal({ amount: Math.min(outstanding * 0.1, outstanding), label: 'Partial Repayment' })}
                style={{ flex: 1, height: 44, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer' }}>
                Partial Repay
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={() => setRepayModal({ amount: outstanding, label: 'Full Repayment' })}
                style={{ flex: 2, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-sans)', cursor: 'pointer' }}>
                Repay Full {fmt(outstanding)} →
              </motion.button>
            </div>

            {freePeriodCount > 0 && (
              <p style={{ fontSize: 10, color: 'var(--jade)', textAlign: 'center', marginTop: 8, fontFamily: 'var(--font-mono)' }}>
                ✓ Interest-free until {fmtDate(dueDate)} — pay in full to avoid charges
              </p>
            )}
          </motion.div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1, 2].map(i => <div key={i} className="shimmer" style={{ height: 120, borderRadius: 16 }} />)}
          </div>
        ) : safeStatements.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: outstanding > 0 ? '24px' : '48px 24px', textAlign: 'center', marginBottom: 24 }}>
            <p style={{ fontSize: outstanding > 0 ? 28 : 40, marginBottom: 12 }}>🧾</p>
            <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
              {outstanding > 0 ? 'No statements generated yet' : 'No statements yet'}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              {outstanding > 0
                ? 'Your statement will generate at end of billing cycle. Use the card above to repay anytime.'
                : 'Your first statement generates at the end of your billing cycle. Use your credit line to get started.'}
            </p>
            {outstanding === 0 && (
              <div style={{ marginTop: 20, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 16px' }}>
                <p style={{ fontSize: 12, color: 'var(--jade)', fontWeight: 600, marginBottom: 4 }}>💡 How billing works</p>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  You get 30 days interest-free from each transaction. Statements generate monthly. Pay in full to avoid interest.
                </p>
              </div>
            )}
          </motion.div>
        ) : (
          <>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>PAST STATEMENTS</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {safeStatements.map((stmt, i) => (
                <motion.div key={stmt.statement_id || i}
                  initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>

                  <div onClick={() => setSelected(selected === stmt.statement_id ? null : stmt.statement_id)}
                    style={{ padding: '16px 18px', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
                          {fmtShort(stmt.billing_period_start)} – {fmtShort(stmt.billing_period_end)}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Due {fmtDate(stmt.due_date)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>{fmt(stmt.total_due)}</p>
                        <div style={{ padding: '3px 8px', borderRadius: 6, display: 'inline-block', background: stmt.status === 'PAID' ? 'rgba(0,200,150,0.1)' : 'rgba(245,158,11,0.1)', border: `1px solid ${stmt.status === 'PAID' ? 'rgba(0,200,150,0.3)' : 'rgba(245,158,11,0.3)'}` }}>
                          <span style={{ fontSize: 9, fontWeight: 700, color: stmt.status === 'PAID' ? 'var(--jade)' : '#F59E0B' }}>{stmt.status}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        { label: 'Spent',    value: fmt(stmt.total_spend || stmt.total_drawdowns || 0) },
                        { label: 'Interest', value: fmt(stmt.total_interest || stmt.interest_charged || 0) },
                        { label: 'Min Due',  value: fmt(stmt.minimum_amount_due || stmt.minimum_due || 0) },
                      ].map((s, j) => (
                        <div key={j} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 10px' }}>
                          <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>{s.label.toUpperCase()}</p>
                          <p style={{ fontSize: 13, fontWeight: 700 }}>{s.value}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <AnimatePresence>
                    {selected === stmt.statement_id && stmt.status !== 'PAID' && parseFloat(stmt.total_due) > 0 && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                        style={{ borderTop: '1px solid var(--border)', padding: '14px 18px', background: 'var(--bg-elevated)' }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <motion.button whileTap={{ scale: 0.96 }} disabled={repaying}
                            onClick={e => { e.stopPropagation(); setRepayModal({ amount: parseFloat(stmt.minimum_amount_due || stmt.minimum_due || 0) }) }}
                            style={{ flex: 1, height: 44, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer' }}>
                            Min {fmt(stmt.minimum_amount_due || stmt.minimum_due || 0)}
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.96 }} disabled={repaying}
                            onClick={e => { e.stopPropagation(); setRepayModal({ amount: parseFloat(stmt.total_due) }) }}
                            style={{ flex: 1, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-sans)', cursor: 'pointer' }}>
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

        {/* Repayment history */}
        {repayments.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>REPAYMENT HISTORY</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {repayments.slice(0, 8).map((r, i) => (
                <motion.div key={r.repayment_id || i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0,212,161,0.08)', border: '1px solid rgba(0,212,161,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>✓</div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--jade)' }}>Repayment</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtDate(r.initiated_at || r.created_at)}</p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>+{fmt(r.amount)}</p>
                    <p style={{ fontSize: 9, color: r.status === 'SUCCESS' ? 'var(--jade)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{r.status}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        <div style={{ height: 20 }} />
      </div>

      {/* Repay modal */}
      <AnimatePresence>
        {repayModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
            onClick={() => setRepayModal(null)}>
            <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              style={{ background: 'var(--bg-elevated)', borderRadius: '24px 24px 0 0', padding: '24px 20px 44px', width: '100%' }}
              onClick={e => e.stopPropagation()}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 16, fontFamily: 'var(--font-mono)' }}>CONFIRM REPAYMENT</p>
              <div style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: '20px', textAlign: 'center', marginBottom: 20 }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 40, color: 'var(--jade)', marginBottom: 4 }}>{fmt(repayModal.amount)}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>via UPI Collect (mock settlement)</p>
              </div>
              <motion.button whileTap={{ scale: 0.97 }} disabled={repaying} onClick={handleRepay}
                style={{ width: '100%', height: 52, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', marginBottom: 10, border: 'none', cursor: 'pointer' }}>
                {repaying ? 'Processing…' : 'Confirm Repayment →'}
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setRepayModal(null)}
                style={{ width: '100%', height: 44, borderRadius: 14, background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer' }}>
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
