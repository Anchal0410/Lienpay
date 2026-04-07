import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getStatements, getRepayments, mockRepay } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const formatDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

const formatShortDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function Billing() {
  const { statements, setStatements } = useStore()
  const [repayments, setRepayments] = useState([])
  const [loading, setLoading]       = useState(true)
  const [repaying, setRepaying]     = useState(false)
  const [selected, setSelected]     = useState(null)
  const [repayModal, setRepayModal] = useState(null) // { amount }

  useEffect(() => {
    const load = async () => {
      try {
        const [stmtRes, repayRes] = await Promise.all([
          getStatements(),
          getRepayments().catch(() => ({ data: { repayments: [] } })),
        ])
        setStatements(stmtRes.data || [])
        // ── FIX: repayments can be nested under .repayments or directly as array ──
        const repayArr = Array.isArray(repayRes.data)
          ? repayRes.data
          : repayRes.data?.repayments || []
        setRepayments(repayArr)
      } catch(e) {
        setStatements([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const openRepayModal = (amount) => setRepayModal({ amount })

  const handleRepay = async () => {
    if (!repayModal) return
    setRepaying(true)
    try {
      await mockRepay(repayModal.amount)
      toast.success(`₹${repayModal.amount.toLocaleString('en-IN')} repaid!`)
      setRepayModal(null)
      setSelected(null)
      // Refresh
      const [stmtRes, repayRes] = await Promise.all([
        getStatements(),
        getRepayments().catch(() => ({ data: { repayments: [] } })),
      ])
      setStatements(stmtRes.data || [])
      const repayArr = Array.isArray(repayRes.data) ? repayRes.data : repayRes.data?.repayments || []
      setRepayments(repayArr)
    } catch(err) {
      toast.error(err.message || 'Repayment failed')
    } finally {
      setRepaying(false)
    }
  }

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Billing</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Statements & repayments</p>
        </motion.div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2].map(i => <div key={i} className="shimmer" style={{ height: 120, borderRadius: 16 }} />)}
          </div>
        ) : statements.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '40px 24px', textAlign: 'center', marginBottom: 24 }}>
            <p style={{ fontSize: 32, marginBottom: 12 }}>🧾</p>
            <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No statements yet</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Your first statement generates at the end of your billing cycle. Use your credit line to get started.
            </p>
          </motion.div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            {statements.map((stmt, i) => (
              <motion.div key={stmt.statement_id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>

                <div onClick={() => setSelected(selected === stmt.statement_id ? null : stmt.statement_id)}
                  style={{ padding: '16px 18px', cursor: 'pointer' }}>
                  {/* Statement header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
                        {formatShortDate(stmt.billing_period_start)} – {formatShortDate(stmt.billing_period_end)}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        Due {formatDate(stmt.due_date)}
                      </p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                      <p style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                        {formatCurrency(stmt.total_due)}
                      </p>
                      <div style={{
                        padding: '3px 8px', borderRadius: 6,
                        background: stmt.status === 'PAID' ? 'rgba(0,200,150,0.1)' : 'rgba(245,158,11,0.1)',
                        border: `1px solid ${stmt.status === 'PAID' ? 'rgba(0,200,150,0.3)' : 'rgba(245,158,11,0.3)'}`,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: stmt.status === 'PAID' ? 'var(--jade)' : '#F59E0B' }}>
                          {stmt.status}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    {[
                      // ── FIX: backend aliases column names in getStatements query ──
                      // total_drawdowns AS total_spend → stmt.total_spend
                      // interest_charged AS total_interest → stmt.total_interest
                      // minimum_due AS minimum_amount_due → stmt.minimum_amount_due
                      { label: 'Spent',    value: formatCurrency(stmt.total_spend || stmt.total_drawdowns || 0) },
                      { label: 'Interest', value: formatCurrency(stmt.total_interest || stmt.interest_charged || 0) },
                      { label: 'Min Due',  value: formatCurrency(stmt.minimum_amount_due || stmt.minimum_due || 0) },
                    ].map((s, j) => (
                      <div key={j} style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: '8px 10px' }}>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, letterSpacing: '0.5px' }}>{s.label.toUpperCase()}</p>
                        <p style={{ fontSize: 13, fontWeight: 700 }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Repayment panel */}
                <AnimatePresence>
                  {selected === stmt.statement_id && stmt.status !== 'PAID' && parseFloat(stmt.total_due) > 0 && (
                    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                      style={{ borderTop: '1px solid var(--border)', padding: '14px 18px', background: 'var(--bg-elevated)' }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <motion.button whileTap={{ scale: 0.96 }} disabled={repaying}
                          onClick={e => { e.stopPropagation(); openRepayModal(parseFloat(stmt.minimum_amount_due || stmt.minimum_due || 0)) }}
                          style={{ flex: 1, height: 44, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>
                          Pay Min {formatCurrency(stmt.minimum_amount_due || stmt.minimum_due || 0)}
                        </motion.button>
                        <motion.button whileTap={{ scale: 0.96 }} disabled={repaying}
                          onClick={e => { e.stopPropagation(); openRepayModal(parseFloat(stmt.total_due)) }}
                          style={{ flex: 1, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-sans)' }}>
                          {repaying ? '…' : `Pay Full ${formatCurrency(stmt.total_due)}`}
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </div>
        )}

        {/* Repayment History */}
        {repayments.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>REPAYMENT HISTORY</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {repayments.slice(0, 10).map((r, i) => (
                <motion.div key={r.repayment_id || i}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0,212,161,0.08)', border: '1px solid rgba(0,212,161,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      ✓
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--jade)' }}>Repayment</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {/* ── FIX: repayments uses initiated_at not created_at ── */}
                        {formatDate(r.initiated_at || r.created_at)}
                        {/* ── FIX: field is payment_method not payment_mode ── */}
                        {(r.payment_method || r.payment_mode) && <span> · {r.payment_method || r.payment_mode}</span>}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>
                      +{formatCurrency(r.amount)}
                    </p>
                    <p style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: r.status === 'SUCCESS' ? 'var(--jade)' : 'var(--text-muted)' }}>
                      {r.status}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        <div style={{ height: 20 }} />
      </div>

      {/* Repay confirmation modal */}
      <AnimatePresence>
        {repayModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: 200, display: 'flex', alignItems: 'flex-end' }}
            onClick={() => setRepayModal(null)}>
            <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              style={{ background: 'var(--bg-elevated)', borderRadius: '24px 24px 0 0', padding: '24px 20px 40px', width: '100%' }}
              onClick={e => e.stopPropagation()}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 16, fontFamily: 'var(--font-mono)' }}>CONFIRM REPAYMENT</p>
              <div style={{ background: 'var(--bg-surface)', borderRadius: 16, padding: '20px', textAlign: 'center', marginBottom: 20 }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 40, color: 'var(--jade)', marginBottom: 4 }}>{formatCurrency(repayModal.amount)}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>via UPI Collect / NACH</p>
              </div>
              <motion.button whileTap={{ scale: 0.97 }} disabled={repaying} onClick={handleRepay}
                style={{ width: '100%', height: 52, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', marginBottom: 10 }}>
                {repaying ? 'Processing…' : 'Confirm Repayment →'}
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setRepayModal(null)}
                style={{ width: '100%', height: 44, borderRadius: 14, background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)' }}>
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
