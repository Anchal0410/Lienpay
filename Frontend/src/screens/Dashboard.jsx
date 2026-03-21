import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getCreditStatus, getLTVHealth, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import CreditCard3D from '../components/CreditCard3D'
import toast from 'react-hot-toast'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const LTVBadge = ({ status }) => {
  const config = {
    GREEN:  { color: '#00C896', bg: 'rgba(0,200,150,0.1)',  label: 'Healthy' },
    AMBER:  { color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', label: 'Monitor' },
    RED:    { color: '#EF4444', bg: 'rgba(239,68,68,0.1)',  label: 'Action Needed' },
  }
  const c = config[status] || config.GREEN
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 20,
      background: c.bg, border: `1px solid ${c.color}30`,
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: c.color,
        boxShadow: `0 0 6px ${c.color}`,
      }} />
      <span style={{ fontSize: 11, color: c.color, fontWeight: 600, letterSpacing: '0.5px' }}>
        {c.label}
      </span>
    </div>
  )
}

export default function Dashboard({ onPay }) {
  const { creditAccount, setCreditAccount, ltvHealth, setLTVHealth, setTransactions, transactions, riskDecision } = useStore()
  const [loading, setLoading]   = useState(!creditAccount)
  const [showFunds, setShowFunds] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [creditRes, ltvRes, txnRes] = await Promise.all([
          getCreditStatus(),
          getLTVHealth(),
          getTxnHistory({ limit: 5 }),
        ])
        setCreditAccount(creditRes.data)
        setLTVHealth(ltvRes.data)
        setTransactions(txnRes.data?.transactions || [])
      } catch (err) {
        toast.error('Failed to load account data')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const account = creditAccount
  const ltv     = ltvHealth
  const available  = parseFloat(account?.available_credit || 0)
  const creditLimit = parseFloat(account?.credit_limit || 0)
  const outstanding = parseFloat(account?.outstanding || 0)

  if (loading) {
    return (
      <div className="screen" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          style={{
            width: 32, height: 32,
            border: '2px solid var(--border)',
            borderTopColor: 'var(--jade)',
            borderRadius: '50%',
          }}
        />
      </div>
    )
  }

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 0' }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 24,
          }}
        >
          <div>
            <h1 style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 26, fontWeight: 400,
              color: 'var(--text-primary)',
            }}>
              Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
              Your wealth is working
            </p>
          </div>
          {ltv && <LTVBadge status={ltv.status} />}
        </motion.div>

        {/* 3D Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          style={{ marginBottom: 20 }}
        >
          <CreditCard3D
            creditLimit={creditLimit}
            available={available}
            vpa={account?.upi_vpa}
            tier={riskDecision?.risk_tier}
          />
        </motion.div>

        {/* Stats row */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
            gap: 10, marginBottom: 20,
          }}
        >
          {[
            { label: 'Available', value: formatCurrency(available), color: 'var(--jade)' },
            { label: 'Used', value: formatCurrency(outstanding), color: outstanding > 0 ? 'var(--gold)' : 'var(--text-secondary)' },
            { label: 'APR', value: `${account?.apr || '—'}%`, color: 'var(--text-primary)' },
          ].map((stat, i) => (
            <div key={i} style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 14,
              padding: '12px 14px',
            }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.5px' }}>
                {stat.label.toUpperCase()}
              </p>
              <p style={{
                fontSize: 15, fontWeight: 600,
                color: stat.color,
                fontFamily: 'var(--font-sans)',
              }}>
                {stat.value}
              </p>
            </div>
          ))}
        </motion.div>

        {/* Pay Button */}
        <motion.button
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3 }}
          whileTap={{ scale: 0.97 }}
          onClick={onPay}
          style={{
            width: '100%', height: 60,
            borderRadius: 18,
            background: 'linear-gradient(135deg, var(--jade), #00A878)',
            color: '#000',
            fontSize: 17,
            fontWeight: 700,
            fontFamily: 'var(--font-sans)',
            letterSpacing: '0.3px',
            marginBottom: 24,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 8px 32px rgba(0,200,150,0.25)',
          }}
        >
          <span style={{ fontSize: 20 }}>⊞</span>
          Scan & Pay
        </motion.button>

        {/* LTV Alert */}
        {ltv && ltv.status !== 'GREEN' && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            style={{
              background: ltv.status === 'RED' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${ltv.status === 'RED' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
              borderRadius: 14,
              padding: '14px 16px',
              marginBottom: 20,
            }}
          >
            <p style={{
              fontSize: 13, fontWeight: 600,
              color: ltv.status === 'RED' ? '#EF4444' : '#F59E0B',
              marginBottom: 4,
            }}>
              {ltv.status === 'RED' ? '⚠️ Margin Call Active' : '⚡ Portfolio Alert'}
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {ltv.message}
            </p>
          </motion.div>
        )}

        {/* Recent Transactions */}
        <div style={{ marginBottom: 20 }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 14,
          }}>
            <h2 style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 15, fontWeight: 600,
              color: 'var(--text-primary)',
            }}>
              Recent
            </h2>
            <button style={{ fontSize: 12, color: 'var(--jade)' }}>
              See all
            </button>
          </div>

          {transactions.length === 0 ? (
            <div style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: 16,
              padding: '32px 20px',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: 32, marginBottom: 8 }}>💳</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
                No transactions yet
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                Scan a QR code to make your first payment
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transactions.slice(0, 5).map((txn, i) => (
                <motion.div
                  key={txn.txn_id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  style={{
                    display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    padding: '12px 16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 40, height: 40, borderRadius: 12,
                      background: 'var(--bg-elevated)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 18,
                    }}>
                      🏪
                    </div>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {txn.merchant_name || txn.merchant_vpa}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {new Date(txn.initiated_at).toLocaleDateString('en-IN', {
                          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                        })}
                      </p>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <p style={{
                      fontSize: 15, fontWeight: 600,
                      color: txn.status === 'SETTLED' ? 'var(--text-primary)' : 'var(--text-muted)',
                    }}>
                      −{formatCurrency(txn.amount)}
                    </p>
                    <div style={{
                      fontSize: 10, marginTop: 2,
                      color: txn.status === 'SETTLED' ? 'var(--jade)' : 'var(--text-muted)',
                      letterSpacing: '0.3px',
                    }}>
                      {txn.status}
                      {txn.is_in_free_period && (
                        <span style={{ color: 'var(--jade)', marginLeft: 4 }}>• FREE</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Interest Free Banner */}
        {outstanding === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{
              background: 'linear-gradient(135deg, rgba(0,200,150,0.08), rgba(201,164,73,0.05))',
              border: '1px solid var(--border-jade)',
              borderRadius: 16,
              padding: '16px 18px',
              marginBottom: 20,
            }}
          >
            <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 600, marginBottom: 4 }}>
              ✨ 30-day interest-free period
            </p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Pay within 30 days and pay zero interest. Your wealth earns, you spend free.
            </p>
          </motion.div>
        )}

      </div>
    </div>
  )
}
