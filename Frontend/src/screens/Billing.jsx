import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getStatements, mockRepay, getCreditStatus } from '../api/client'
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

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getStatements()
        const data = res?.data?.statements || res?.statements || []
        setStatements(data)
      } catch (err) {
        toast.error('Failed to load statements')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleRepay = async (amount) => {
    setRepaying(true)
    try {
      await mockRepay(amount)
      const creditRes = await getCreditStatus()
      setCreditAccount(creditRes?.data || creditRes)
      toast.success(`${formatCurrency(amount)} repaid! ✓`)
      // Refresh
      const res = await getStatements()
      setStatements(res?.data?.statements || res?.statements || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRepaying(false)
    }
  }

  return (
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
              <motion.button whileTap={{ scale: 0.97 }}
                onClick={() => handleRepay(parseFloat(creditAccount.outstanding))}
                disabled={repaying}
                style={{ width: '100%', height: 46, borderRadius: 14, marginTop: 14,
                  background: 'linear-gradient(135deg, var(--jade), #00A878)',
                  color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)' }}>
                {repaying ? 'Processing…' : `Pay Full Balance ${formatCurrency(creditAccount.outstanding)}`}
              </motion.button>
            )}
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
                            onClick={e => { e.stopPropagation(); handleRepay(parseFloat(stmt.minimum_due || stmt.minimum_amount_due)) }}
                            style={{ flex: 1, height: 44, borderRadius: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>
                            Pay Min {formatCurrency(stmt.minimum_due || stmt.minimum_amount_due)}
                          </motion.button>
                          <motion.button whileTap={{ scale: 0.96 }} disabled={repaying}
                            onClick={e => { e.stopPropagation(); handleRepay(parseFloat(stmt.total_due)) }}
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

        {/* How interest works */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '18px', marginTop: 20 }}>
          <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>💡 How interest works</p>
          {[
            { icon: '✓', color: 'var(--jade)', text: '30 days interest-free on every payment' },
            { icon: '%', color: 'var(--text-secondary)', text: `${creditAccount?.apr || '15.99'}% APR — only on what you use, for days used` },
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
  )
}
