import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { getStatements, mockRepay, getCreditStatus } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const formatDate = (d) =>
  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

export default function Billing() {
  const { statements, setStatements, setCreditAccount } = useStore()
  const [loading, setLoading]       = useState(!statements.length)
  const [repaying, setRepaying]     = useState(false)
  const [selected, setSelected]     = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getStatements()
        setStatements(res.data?.statements || [])
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
      setCreditAccount(creditRes.data)
      toast.success(`₹${amount} repaid successfully!`)
      // Refresh statements
      const res = await getStatements()
      setStatements(res.data?.statements || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setRepaying(false)
    }
  }

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 0' }}>

        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 28, fontWeight: 400,
            marginBottom: 4,
          }}
        >
          Billing
        </motion.h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Statements & repayments
        </p>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[1,2,3].map(i => (
              <div key={i} className="shimmer" style={{ height: 100, borderRadius: 16 }} />
            ))}
          </div>
        ) : statements.length === 0 ? (
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '48px 24px',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 48, marginBottom: 12 }}>📋</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 15 }}>No statements yet</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
              Your first statement will be generated at end of month
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {statements.map((stmt, i) => (
              <motion.div
                key={stmt.statement_id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 }}
              >
                <div
                  onClick={() => setSelected(selected === stmt.statement_id ? null : stmt.statement_id)}
                  style={{
                    background: 'var(--bg-surface)',
                    border: `1px solid ${selected === stmt.statement_id ? 'var(--border-jade)' : 'var(--border)'}`,
                    borderRadius: 18,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                  }}
                >
                  {/* Statement header */}
                  <div style={{ padding: '16px 18px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                          {new Date(stmt.billing_period_start).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Due {formatDate(stmt.due_date)}
                        </p>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <p style={{
                          fontSize: 20,
                          fontFamily: 'var(--font-serif)',
                          color: parseFloat(stmt.total_due) > 0 ? 'var(--text-primary)' : 'var(--jade)',
                        }}>
                          {formatCurrency(stmt.total_due)}
                        </p>
                        <div style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          marginTop: 4,
                          padding: '2px 8px', borderRadius: 20,
                          background: stmt.status === 'PAID' ? 'rgba(0,200,150,0.1)' : 'rgba(245,158,11,0.1)',
                          border: `1px solid ${stmt.status === 'PAID' ? 'rgba(0,200,150,0.3)' : 'rgba(245,158,11,0.3)'}`,
                        }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: '0.5px',
                            color: stmt.status === 'PAID' ? 'var(--jade)' : '#F59E0B',
                          }}>
                            {stmt.status}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Mini stats */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 8, marginTop: 14,
                    }}>
                      {[
                        { label: 'Spent', value: formatCurrency(stmt.total_spend) },
                        { label: 'Interest', value: formatCurrency(stmt.total_interest) },
                        { label: 'MAD', value: formatCurrency(stmt.minimum_amount_due) },
                      ].map((s, j) => (
                        <div key={j} style={{
                          background: 'var(--bg-elevated)',
                          borderRadius: 10,
                          padding: '8px 10px',
                        }}>
                          <p style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3, letterSpacing: '0.5px' }}>
                            {s.label.toUpperCase()}
                          </p>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {s.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Expanded repayment panel */}
                  {selected === stmt.statement_id && stmt.status !== 'PAID' && parseFloat(stmt.total_due) > 0 && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      style={{
                        borderTop: '1px solid var(--border)',
                        padding: '14px 18px',
                        background: 'var(--bg-elevated)',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 8 }}>
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={(e) => { e.stopPropagation(); handleRepay(parseFloat(stmt.minimum_amount_due)) }}
                          disabled={repaying}
                          style={{
                            flex: 1, height: 44, borderRadius: 12,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                            fontSize: 13, fontWeight: 600,
                            fontFamily: 'var(--font-sans)',
                          }}
                        >
                          Pay MAD {formatCurrency(stmt.minimum_amount_due)}
                        </motion.button>
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          onClick={(e) => { e.stopPropagation(); handleRepay(parseFloat(stmt.total_due)) }}
                          disabled={repaying}
                          style={{
                            flex: 1, height: 44, borderRadius: 12,
                            background: 'linear-gradient(135deg, var(--jade), #00A878)',
                            color: '#000',
                            fontSize: 13, fontWeight: 700,
                            fontFamily: 'var(--font-sans)',
                          }}
                        >
                          {repaying ? '...' : `Pay Full ${formatCurrency(stmt.total_due)}`}
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* How interest works */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 16,
            padding: '16px 18px',
            marginTop: 20,
          }}
        >
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            💡 How interest works
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { icon: '✓', text: '30 days interest-free on every payment', color: 'var(--jade)' },
              { icon: '~', text: `${creditAccount?.apr || '15.99'}% APR after free period`, color: 'var(--text-secondary)' },
              { icon: '↗', text: 'Pay only on what you use, for days used', color: 'var(--text-secondary)' },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: item.color, width: 16 }}>{item.icon}</span>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{item.text}</p>
              </div>
            ))}
          </div>
        </motion.div>

      </div>
    </div>
  )
}
