import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getStatements, mockRepay, initiateRepay, getCreditStatus, getRepayments, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function Billing() {
  const { statements, setStatements, setCreditAccount, creditAccount } = useStore()
  const [loading,  setLoading]  = useState(true)
  const [repaying, setRepaying] = useState(false)
  const [selected, setSelected] = useState(null)
  const [repayModal, setRepayModal] = useState(null)
  const [customAmount, setCustomAmount] = useState('')
  const [repayments, setRepayments] = useState([])
  const [freePeriodAlerts, setFreePeriodAlerts] = useState([])

  useEffect(() => {
    const load = async () => {
      try { const res = await getStatements(); setStatements(res?.data?.statements || res?.statements || []) } catch(e) {}
      try { const res = await getRepayments(); setRepayments(res?.data?.repayments || []) } catch(e) {}
      try {
        const res = await getTxnHistory({ limit: 50 })
        const txns = res?.data?.transactions || []
        // Find transactions with free period ending in next 7 days
        const alerts = txns.filter(t => {
          if (!t.is_in_free_period) return false
          const initiated = new Date(t.initiated_at)
          const freeEnds = new Date(initiated.getTime() + 30 * 24 * 60 * 60 * 1000)
          const daysLeft = Math.ceil((freeEnds - Date.now()) / (1000 * 60 * 60 * 24))
          return daysLeft > 0 && daysLeft <= 7
        }).map(t => {
          const initiated = new Date(t.initiated_at)
          const freeEnds = new Date(initiated.getTime() + 30 * 24 * 60 * 60 * 1000)
          return { ...t, daysLeft: Math.ceil((freeEnds - Date.now()) / (1000 * 60 * 60 * 24)), freeEnds }
        })
        setFreePeriodAlerts(alerts)
      } catch(e) {}
      setLoading(false)
    }
    load()
  }, [])

  // Step 1: Open repayment modal with UPI details
  const openRepayModal = async (amount) => {
    try {
      const res = await initiateRepay(amount)
      setRepayModal(res.data)
    } catch (err) {
      toast.error(err.message || 'Failed to initiate repayment')
    }
  }

  // Step 2: User pays via UPI app or we simulate
  const completeRepayment = async () => {
    if (!repayModal) return
    setRepaying(true)
    try {
      await mockRepay(repayModal.amount)
      const creditRes = await getCreditStatus()
      setCreditAccount(creditRes?.data || creditRes)
      toast.success(`${formatCurrency(repayModal.amount)} repaid! ✓`)
      setRepayModal(null)
      setCustomAmount('')
      // Refresh
      try { const res = await getStatements(); setStatements(res?.data?.statements || res?.statements || []) } catch(e) {}
      try { const res = await getRepayments(); setRepayments(res?.data?.repayments || []) } catch(e) {}
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRepaying(false)
    }
  }

  // Open UPI app deep link
  const openUPIApp = () => {
    if (repayModal?.upi_link) {
      window.location.href = repayModal.upi_link
    }
  }

  return (
    <>
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Billing</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Statements & repayments</p>
        </motion.div>

        {/* Current balance card */}
        {creditAccount && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: 'linear-gradient(135deg, rgba(0,200,150,0.07), rgba(0,200,150,0.02))',
              border: '1px solid rgba(0,200,150,0.18)', borderRadius: 20, padding: '18px 20px', marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'OUTSTANDING', value: formatCurrency(creditAccount.outstanding), color: parseFloat(creditAccount.outstanding) > 0 ? 'var(--gold)' : 'var(--jade)' },
                { label: 'AVAILABLE', value: formatCurrency(creditAccount.available_credit), color: 'var(--jade)' },
              ].map((s, i) => (
                <div key={i}>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 4 }}>{s.label}</p>
                  <p style={{ fontFamily: 'var(--font-serif)', fontSize: 24, color: s.color }}>{s.value}</p>
                </div>
              ))}
            </div>
            {parseFloat(creditAccount.outstanding) > 0 && (
              <>
                <motion.button whileTap={{ scale: 0.97 }}
                  onClick={() => openRepayModal(parseFloat(creditAccount.outstanding))}
                  disabled={repaying}
                  style={{ width: '100%', height: 46, borderRadius: 14, marginTop: 14,
                    background: 'linear-gradient(135deg, var(--jade), #00A878)',
                    color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)',
                    boxShadow: '0 6px 20px rgba(0,212,161,0.2)' }}>
                  {repaying ? 'Processing…' : `Repay Full ${formatCurrency(creditAccount.outstanding)}`}
                </motion.button>

                {/* Custom amount */}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', padding: '0 12px' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600 }}>₹</span>
                    <input type="number" placeholder="Custom amount" value={customAmount} onChange={e => setCustomAmount(e.target.value)}
                      style={{ flex: 1, height: 40, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }} />
                  </div>
                  <motion.button whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      const amt = parseFloat(customAmount)
                      if (!amt || amt <= 0) return toast.error('Enter a valid amount')
                      if (amt > parseFloat(creditAccount.outstanding)) return toast.error('Amount exceeds outstanding balance')
                      openRepayModal(amt)
                    }}
                    disabled={repaying || !customAmount}
                    style={{ padding: '0 20px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--jade-border)',
                      color: 'var(--jade)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)', opacity: customAmount ? 1 : 0.5 }}>
                    Pay
                  </motion.button>
                </div>
              </>
            )}
          </motion.div>
        )}

        {/* Free period ending alerts */}
        {freePeriodAlerts.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ background: 'rgba(224,160,48,0.06)', border: '1px solid rgba(224,160,48,0.2)', borderRadius: 16, padding: '14px 16px', marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#E0A030', marginBottom: 10 }}>
              Interest-free period ending soon
            </p>
            {freePeriodAlerts.map((t, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0',
                borderBottom: i < freePeriodAlerts.length - 1 ? '1px solid rgba(224,160,48,0.1)' : 'none' }}>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600 }}>{t.merchant_name}</p>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{formatCurrency(t.amount)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 14, fontWeight: 700, color: t.daysLeft <= 3 ? '#E05252' : '#E0A030', fontFamily: 'var(--font-mono)' }}>
                    {t.daysLeft}d left
                  </p>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Expires {formatDate(t.freeEnds)}
                  </p>
                </div>
              </div>
            ))}
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              Repay before the free period ends to avoid interest charges.
            </p>
          </motion.div>
        )}

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2].map(i => <div key={i} className="shimmer" style={{ height: 110, borderRadius: 18 }} />)}
          </div>
        ) : statements.length === 0 ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '48px 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 48, marginBottom: 12 }}>📋</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15, fontWeight: 600 }}>No statements yet</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
              Your first statement is generated at the end of each billing month
            </p>
          </motion.div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {statements.map((stmt, i) => (
              <motion.div key={stmt.statement_id}
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
                <div onClick={() => setSelected(selected === stmt.statement_id ? null : stmt.statement_id)}
                  style={{
                    background: 'var(--bg-surface)',
                    border: `1px solid ${selected === stmt.statement_id ? 'var(--border-jade)' : 'var(--border)'}`,
                    borderRadius: 20, overflow: 'hidden', cursor: 'pointer', transition: 'border-color 0.2s',
                  }}>
                  <div style={{ padding: '18px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>
                          {new Date(stmt.billing_period_start).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Due {formatDate(stmt.due_date)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontFamily: 'var(--font-serif)', fontSize: 24, marginBottom: 5 }}>
                          {formatCurrency(stmt.total_due)}
                        </p>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 10px', borderRadius: 20,
                          background: stmt.status === 'PAID' ? 'rgba(0,200,150,0.1)' : 'rgba(245,158,11,0.1)',
                          border: `1px solid ${stmt.status === 'PAID' ? 'rgba(0,200,150,0.3)' : 'rgba(245,158,11,0.3)'}`,
                        }}>
                          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', color: stmt.status === 'PAID' ? 'var(--jade)' : '#F59E0B' }}>
                            {stmt.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {[
                        { label: 'Spent', value: formatCurrency(stmt.total_spend || stmt.total_drawdowns) },
                        { label: 'Interest', value: formatCurrency(stmt.total_interest || stmt.interest_charged) },
                        { label: 'Min Due', value: formatCurrency(stmt.minimum_amount_due || stmt.minimum_due) },
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
                            onClick={e => { e.stopPropagation(); openRepayModal(parseFloat(stmt.minimum_due || stmt.minimum_amount_due)) }}
                            style={{ flex: 1, height: 44, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>
                            Pay Min {formatCurrency(stmt.minimum_due || stmt.minimum_amount_due)}
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
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* Repayment History */}
        {repayments.length > 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            style={{ marginTop: 20 }}>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10 }}>REPAYMENT HISTORY</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {repayments.slice(0, 10).map((r, i) => (
                <motion.div key={r.repayment_id || i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(0,212,161,0.08)', border: '1px solid rgba(0,212,161,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      ✓
                    </div>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--jade)' }}>Repayment</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                        {r.created_at ? formatDate(r.created_at) : '—'}
                        {r.payment_mode && <span> · {r.payment_mode}</span>}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>
                      +{formatCurrency(r.amount)}
                    </p>
                    <p style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: r.status === 'SUCCESS' ? 'var(--jade)' : 'var(--text-muted)', fontWeight: 600 }}>
                      {r.status || 'SUCCESS'}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Auto-pay / Recurring Payments */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '18px', marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <p style={{ fontSize: 13, fontWeight: 700 }}>🔄 Auto-pay (recurring)</p>
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--jade)', fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: 'rgba(0,212,161,0.08)', border: '1px solid rgba(0,212,161,0.15)' }}>NACH</span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
            Set up automatic payments for subscriptions like Netflix, Spotify, or gym memberships. 
            Payments execute on their due date using your credit line — no UPI PIN needed.
          </p>

          {/* Subscription list placeholder */}
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 14, padding: '16px', marginBottom: 12 }}>
            {[
              { name: 'Netflix', amount: 649, icon: '🎬', day: 15, active: false },
              { name: 'Spotify', amount: 119, icon: '🎵', day: 1, active: false },
              { name: 'Gym membership', amount: 1500, icon: '💪', day: 5, active: false },
            ].map((sub, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '10px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{sub.icon}</span>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600 }}>{sub.name}</p>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {formatCurrency(sub.amount)}/month · Due {sub.day}th
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => toast.success(`Auto-pay for ${sub.name} coming soon! NACH mandate setup requires bank partnership.`)}
                  style={{ padding: '6px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-sans)',
                    background: sub.active ? 'rgba(0,212,161,0.1)' : 'var(--bg-surface)',
                    border: `1px solid ${sub.active ? 'rgba(0,212,161,0.3)' : 'var(--border)'}`,
                    color: sub.active ? 'var(--jade)' : 'var(--text-secondary)' }}>
                  {sub.active ? 'Active' : 'Set up'}
                </button>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Auto-pay uses NACH (National Automated Clearing House) mandates. You authorize a max amount per month, 
            and payments auto-debit from your credit line. Cancel anytime.
          </p>
        </motion.div>

        {/* How interest works */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '18px', marginTop: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>💡 How interest works</p>
          {[
            { icon: '✓', color: 'var(--jade)', text: '30 days interest-free on every payment' },
            { icon: '%', color: 'var(--text-secondary)', text: `Just ${((parseFloat(creditAccount?.apr || 12))/12).toFixed(2)}%/month — credit cards charge 3%+. Pay only for days used.` },
            { icon: '↺', color: 'var(--text-secondary)', text: 'Pay minimum due or full balance anytime' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: i < 2 ? 10 : 0 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: `${item.color}15`, border: `1px solid ${item.color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                <span style={{ fontSize: 10, color: item.color, fontWeight: 700 }}>{item.icon}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item.text}</p>
            </div>
          ))}
        </motion.div>

      </div>
    </div>

    {/* Repayment Modal */}
    <AnimatePresence>
      {repayModal && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
          onClick={() => !repaying && setRepayModal(null)}>
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            onClick={e => e.stopPropagation()}
            style={{ background: 'var(--bg-surface)', borderRadius: '24px 24px 0 0', padding: '24px', width: '100%', border: '1px solid var(--border)', borderBottom: 'none' }}>

            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, marginBottom: 20 }}>Repay via UPI</h3>

            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 40, color: 'var(--jade)', marginBottom: 4 }}>
                {formatCurrency(repayModal.amount)}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>to be repaid</p>
            </div>

            <div style={{ background: 'var(--bg-elevated)', borderRadius: 14, padding: '16px', marginBottom: 16, border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pay to UPI ID</span>
                <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--jade)' }}>{repayModal.upi_id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>After repayment</span>
                <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {formatCurrency(repayModal.outstanding_after)} outstanding
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <motion.button whileTap={{ scale: 0.96 }} onClick={openUPIApp}
                style={{ flex: 1, height: 50, borderRadius: 14,
                  background: 'var(--bg-elevated)', border: '1px solid var(--jade-border)',
                  color: 'var(--jade)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>
                Open UPI App
              </motion.button>
              <motion.button whileTap={{ scale: 0.96 }} onClick={completeRepayment} disabled={repaying}
                style={{ flex: 1, height: 50, borderRadius: 14,
                  background: 'linear-gradient(135deg, var(--jade), #00A878)',
                  color: 'var(--bg-void)', fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-sans)',
                  opacity: repaying ? 0.6 : 1,
                  boxShadow: '0 6px 20px rgba(0,212,161,0.2)' }}>
                {repaying ? 'Processing...' : 'Confirm Payment'}
              </motion.button>
            </div>

            <p style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
              Pay via any UPI app (GPay, PhonePe, Paytm) to the above ID, then tap Confirm.
            </p>

            <button onClick={() => setRepayModal(null)}
              style={{ width: '100%', fontSize: 12, color: 'var(--text-muted)', padding: '12px 0', marginTop: 8 }}>
              Cancel
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    </>
  )
}
