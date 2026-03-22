import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { getPortfolioSummary, getLTVHealth } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const SCHEME_COLORS = {
  EQUITY_LARGE_CAP:  '#00C896',
  EQUITY_MID_CAP:    '#C9A449',
  EQUITY_SMALL_CAP:  '#EF4444',
  EQUITY_FLEXI_CAP:  '#8B5CF6',
  DEBT_SHORT_DUR:    '#3B82F6',
  DEBT_LIQUID:       '#06B6D4',
  HYBRID_BALANCED:   '#F59E0B',
}

export default function Portfolio() {
  const { portfolio, setPortfolio, ltvHealth, setLTVHealth, creditAccount } = useStore()
  const [loading, setLoading] = useState(!portfolio)

  useEffect(() => {
    const load = async () => {
      try {
        const [portfolioRes, ltvRes] = await Promise.all([
          getPortfolioSummary(),
          getLTVHealth(),
        ])
        setPortfolio(portfolioRes.data)
        setLTVHealth(ltvRes.data)
      } catch (err) {
        // Portfolio might not be linked yet
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const holdings  = portfolio?.holdings || []
  const summary   = portfolio?.summary
  const ltv       = ltvHealth
  const totalValue = parseFloat(summary?.total_value || 0)
  const totalEligible = parseFloat(summary?.total_eligible || 0)
  const creditLimit   = parseFloat(creditAccount?.credit_limit || 0)
  const ltvRatio      = ltv?.ltv_ratio || 0

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
          Portfolio
        </motion.h1>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Your collateral health
        </p>

        {/* LTV Gauge */}
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
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28 }}>
                {formatCurrency(totalValue)}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>CREDIT BACKED</p>
              <p style={{ fontFamily: 'var(--font-serif)', fontSize: 28, color: 'var(--jade)' }}>
                {formatCurrency(creditLimit)}
              </p>
            </div>
          </div>

          {/* LTV Bar */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>LTV Ratio</p>
              <p style={{
                fontSize: 11, fontWeight: 600,
                color: ltvRatio >= 90 ? '#EF4444' : ltvRatio >= 80 ? '#F59E0B' : 'var(--jade)',
              }}>
                {ltvRatio.toFixed(1)}%
              </p>
            </div>
            <div style={{
              height: 6, borderRadius: 3,
              background: 'var(--bg-elevated)',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {/* Threshold markers */}
              <div style={{
                position: 'absolute', left: '80%', top: 0, bottom: 0,
                width: 1, background: 'rgba(245,158,11,0.5)',
              }} />
              <div style={{
                position: 'absolute', left: '90%', top: 0, bottom: 0,
                width: 1, background: 'rgba(239,68,68,0.5)',
              }} />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(ltvRatio, 100)}%` }}
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

        {/* Holdings */}
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: '0.5px' }}>
          MUTUAL FUND HOLDINGS
        </p>

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
              const pct   = totalValue > 0 ? (holding.value_at_fetch / totalValue) * 100 : 0
              const color = SCHEME_COLORS[holding.scheme_type] || '#8888AA'
              return (
                <motion.div
                  key={holding.folio_number}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 14,
                    padding: '14px 16px',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  {/* Color accent bar */}
                  <div style={{
                    position: 'absolute', left: 0, top: 0, bottom: 0,
                    width: 3, background: color, borderRadius: '14px 0 0 14px',
                  }} />

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ flex: 1, marginLeft: 8 }}>
                      <p style={{
                        fontSize: 13, fontWeight: 500,
                        color: 'var(--text-primary)',
                        marginBottom: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: 200,
                      }}>
                        {holding.scheme_name}
                      </p>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                    marginLeft: 8,
                    paddingTop: 8,
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
                        {holding.ltv_cap ? (typeof holding.ltv_cap === 'string' && holding.ltv_cap.includes('%') ? holding.ltv_cap : `${(parseFloat(holding.ltv_cap) > 1 ? parseFloat(holding.ltv_cap) : parseFloat(holding.ltv_cap) * 100).toFixed(0)}%`) : '—'}
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
          textAlign: 'center', marginTop: 16,
          lineHeight: 1.5,
        }}>
          NAVs updated daily from AMFI • LTV calculated in real-time
        </p>
      </div>
    </div>
  )
}
