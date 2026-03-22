import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPortfolioSummary, getLTVHealth, getPledgeStatus, initiatePledge, confirmPledgeOTP, notifyNBFC } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const formatLtv = (raw) => {
  if (!raw) return '—'
  if (typeof raw === 'string' && raw.includes('%')) return raw
  const num = parseFloat(raw)
  return num > 1 ? `${num.toFixed(0)}%` : `${(num * 100).toFixed(0)}%`
}

const SCHEME_COLORS = {
  EQUITY_LARGE_CAP: 'var(--jade)', EQUITY_MID_CAP: '#C9A449',
  EQUITY_SMALL_CAP: '#EF4444', EQUITY_FLEXI_CAP: '#8B5CF6',
  DEBT_SHORT_DUR: '#3B82F6', DEBT_LIQUID: '#06B6D4',
  HYBRID_BALANCED: '#F59E0B',
}

export default function Portfolio() {
  const { portfolio, setPortfolio, ltvHealth, setLTVHealth, creditAccount } = useStore()
  const [loading, setLoading] = useState(!portfolio)
  const [pledges, setPledges] = useState([])
  const [pledgeModal, setPledgeModal] = useState(null) // folio to pledge
  const [pledging, setPledging] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [portfolioRes, ltvRes, pledgeRes] = await Promise.all([
          getPortfolioSummary(),
          getLTVHealth().catch(() => ({ data: {} })),
          getPledgeStatus().catch(() => ({ data: { pledges: [] } })),
        ])
        setPortfolio(portfolioRes.data)
        setLTVHealth(ltvRes.data)
        setPledges(pledgeRes.data?.pledges || [])
      } catch (err) {
        // Portfolio might not be linked yet
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const holdings = portfolio?.holdings || []
  const summary = portfolio?.summary
  const ltv = ltvHealth
  const totalValue = parseFloat(summary?.total_value || 0)
  const creditLimit = parseFloat(creditAccount?.credit_limit || 0)
  const outstanding = parseFloat(creditAccount?.outstanding || 0)
  const ltvRatio = ltv?.ltv_ratio || 0

  // Map pledges by folio_number for quick lookup
  const pledgeMap = {}
  pledges.forEach(p => { pledgeMap[p.folio_number] = p })

  const isPledged = (folio) => {
    const p = pledgeMap[folio]
    return p && p.status === 'ACTIVE'
  }

  // Handle quick pledge
  const handlePledge = async (holding) => {
    setPledging(true)
    try {
      const res = await initiatePledge([{ folio_number: holding.folio_number }])
      const pledge = res.data.pledges?.[0]
      if (pledge) {
        const otp = pledge.rta === 'CAMS' ? '123456' : '654321'
        await confirmPledgeOTP(pledge.pledge_id, otp)
        await notifyNBFC([pledge.pledge_id])
        toast.success(`${holding.scheme_name?.split(' - ')[0]} pledged successfully!`)
        // Refresh pledges
        const pledgeRes = await getPledgeStatus()
        setPledges(pledgeRes.data?.pledges || [])
        setPledgeModal(null)
      }
    } catch (err) {
      toast.error(err.message || 'Failed to pledge fund')
    } finally {
      setPledging(false)
    }
  }

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 0' }}>

        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, marginBottom: 4 }}
        >
          Portfolio
        </motion.h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Your collateral health
        </p>

        {/* Summary card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 20,
            padding: '20px',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>PORTFOLIO VALUE</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 28 }}>
                {formatCurrency(totalValue)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>CREDIT BACKED</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--jade)' }}>
                {formatCurrency(creditLimit)}
              </p>
            </div>
          </div>

          {/* LTV Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>LTV Ratio</p>
              <p style={{
                fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)',
                color: outstanding <= 0 ? 'var(--jade)' : ltvRatio >= 90 ? '#EF4444' : ltvRatio >= 80 ? '#F59E0B' : 'var(--jade)',
              }}>
                {outstanding <= 0 ? 'No outstanding' : `${ltvRatio.toFixed(1)}%`}
              </p>
            </div>
            <div style={{
              height: 6, borderRadius: 3,
              background: 'var(--bg-elevated)',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Threshold markers */}
              <div style={{ position: 'absolute', left: '80%', top: 0, bottom: 0, width: 1, background: 'rgba(245,158,11,0.5)' }} />
              <div style={{ position: 'absolute', left: '90%', top: 0, bottom: 0, width: 1, background: 'rgba(239,68,68,0.5)' }} />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(outstanding > 0 ? ltvRatio : 0, 100)}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
                style={{
                  height: '100%',
                  background: ltvRatio >= 90
                    ? 'linear-gradient(90deg, #EF4444, #DC2626)'
                    : ltvRatio >= 80
                    ? 'linear-gradient(90deg, var(--jade), #F59E0B)'
                    : 'linear-gradient(90deg, var(--jade), #00A878)',
                  borderRadius: 3,
                }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <p style={{ fontSize: 9, color: 'var(--text-muted)' }}>Safe</p>
              <p style={{ fontSize: 9, color: '#F59E0B' }}>80% Alert</p>
              <p style={{ fontSize: 9, color: '#EF4444' }}>90% Call</p>
            </div>
          </div>
        </motion.div>

        {/* Holdings — with pledge status */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.5px' }}>
            MUTUAL FUND HOLDINGS
          </p>
          <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {holdings.filter(h => isPledged(h.folio_number)).length} of {holdings.length} pledged
          </p>
        </div>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[1,2,3].map(i => (
              <div key={i} className="shimmer" style={{ height: 80, borderRadius: 14 }} />
            ))}
          </div>
        ) : holdings.length === 0 ? (
          <div style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: '40px 24px',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>📊</p>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Portfolio not linked</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
              Complete onboarding to link your MF portfolio
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {holdings.map((holding, i) => {
              const pct = totalValue > 0 ? (holding.value_at_fetch / totalValue) * 100 : 0
              const color = SCHEME_COLORS[holding.scheme_type] || '#8888AA'
              const pledged = isPledged(holding.folio_number)
              return (
                <motion.div
                  key={holding.folio_number}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  onClick={() => !pledged && setPledgeModal(holding)}
                  style={{
                    background: 'var(--bg-surface)',
                    border: `1px solid ${pledged ? 'var(--jade-border)' : 'var(--border)'}`,
                    borderRadius: 14,
                    padding: '14px 16px',
                    position: 'relative',
                    overflow: 'hidden',
                    cursor: pledged ? 'default' : 'pointer',
                  }}
                >
                  {/* Color accent bar */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: 3, background: pledged ? 'var(--jade)' : color,
                  }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ flex: 1, marginLeft: 8 }}>
                      <p style={{
                        fontSize: 13, fontWeight: 500,
                        color: 'var(--text-primary)',
                        marginBottom: 4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                      }}>
                        {holding.scheme_name}
                      </p>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{
                          fontSize: 9, color: color, fontWeight: 600,
                          letterSpacing: '0.5px',
                          background: `${color}15`,
                          padding: '2px 6px', borderRadius: 4,
                        }}>
                          {holding.scheme_type?.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {holding.rta}
                        </span>
                        {/* Pledge badge */}
                        {pledged ? (
                          <span style={{
                            fontSize: 8, fontWeight: 700, fontFamily: 'var(--font-mono)',
                            color: 'var(--jade)', background: 'var(--jade-dim)',
                            border: '1px solid var(--jade-border)',
                            padding: '2px 6px', borderRadius: 4, letterSpacing: '0.5px',
                          }}>
                            PLEDGED
                          </span>
                        ) : (
                          <span style={{
                            fontSize: 8, fontWeight: 600, fontFamily: 'var(--font-mono)',
                            color: 'var(--text-muted)', background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-light)',
                            padding: '2px 6px', borderRadius: 4, letterSpacing: '0.5px',
                          }}>
                            TAP TO PLEDGE
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontSize: 15, fontWeight: 600 }}>
                        {formatCurrency(holding.value_at_fetch)}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {pct.toFixed(1)}% of portfolio
                      </p>
                    </div>
                  </div>

                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    marginLeft: 8, paddingTop: 8,
                    borderTop: '1px solid var(--border)',
                  }}>
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>UNITS</p>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        {parseFloat(holding.units_held || 0).toFixed(3)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>NAV</p>
                      <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                        ₹{parseFloat(holding.nav_at_fetch || 0).toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>LTV</p>
                      <p style={{ fontSize: 12, color: color }}>
                        {formatLtv(holding.ltv_cap)}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>ELIGIBLE</p>
                      <p style={{ fontSize: 12, color: 'var(--jade)' }}>
                        {formatCurrency(holding.eligible_value)}
                      </p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* AMFI note */}
        <p style={{
          fontSize: 11, color: 'var(--text-muted)',
          textAlign: 'center', marginTop: 16, lineHeight: 1.5,
        }}>
          NAVs updated daily from AMFI · LTV calculated in real-time
        </p>
      </div>

      {/* Pledge confirmation modal */}
      <AnimatePresence>
        {pledgeModal && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
            onClick={() => !pledging && setPledgeModal(null)}>
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--bg-surface)', borderRadius: '24px 24px 0 0',
                padding: '24px', width: '100%',
                border: '1px solid var(--border)', borderBottom: 'none',
              }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400, marginBottom: 16 }}>
                Pledge this fund?
              </h3>

              <div style={{
                background: 'var(--bg-elevated)', borderRadius: 14, padding: '16px', marginBottom: 16,
                border: '1px solid var(--border)',
              }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{pledgeModal.scheme_name?.split(' - ')[0]}</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                  <div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>VALUE</p>
                    <p style={{ fontSize: 14, fontWeight: 600 }}>{formatCurrency(pledgeModal.value_at_fetch || pledgeModal.current_value)}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>LTV</p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: SCHEME_COLORS[pledgeModal.scheme_type] || 'var(--jade)' }}>{formatLtv(pledgeModal.ltv_cap)}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>ELIGIBLE</p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--jade)' }}>{formatCurrency(pledgeModal.eligible_value || pledgeModal.eligible_credit)}</p>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                Your units will be lien-marked (not sold). Your investments keep growing. You can release pledged funds anytime by repaying the outstanding balance.
              </p>

              <div style={{ display: 'flex', gap: 10 }}>
                <motion.button whileTap={{ scale: 0.96 }}
                  onClick={() => setPledgeModal(null)}
                  disabled={pledging}
                  style={{
                    flex: 1, height: 50, borderRadius: 14,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', fontSize: 14, fontWeight: 600,
                  }}>
                  Cancel
                </motion.button>
                <motion.button whileTap={{ scale: 0.96 }}
                  onClick={() => handlePledge(pledgeModal)}
                  disabled={pledging}
                  style={{
                    flex: 1, height: 50, borderRadius: 14,
                    background: 'linear-gradient(135deg, var(--jade), #00A878)',
                    color: 'var(--bg-void)', fontSize: 14, fontWeight: 700,
                    boxShadow: '0 6px 20px rgba(0,212,161,0.2)',
                    opacity: pledging ? 0.6 : 1,
                  }}>
                  {pledging ? 'Pledging...' : 'Confirm Pledge'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
