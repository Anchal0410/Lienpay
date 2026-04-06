import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPortfolioSummary, getPledgeStatus } from '../api/client'
import { useRiskState } from '../contexts/RiskStateContext'
import { MarketTicker, RiskNudgeBanner } from '../components/RiskComponents'

const fmt    = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtL   = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${fmt(v)}`
}

// Per-category LTV caps (matches backend fund universe)
const LTV_CAPS = {
  'EQUITY_LARGE_CAP':  0.40,
  'EQUITY_MID_CAP':    0.40,
  'EQUITY_SMALL_CAP':  0.35,
  'EQUITY_FLEXI_CAP':  0.40,
  'EQUITY_INDEX':      0.40,
  'DEBT_LIQUID':       0.80,
  'DEBT_SHORT_DUR':    0.80,
  'HYBRID_BALANCED':   0.40,
}

const FUND_QUALITY_COLORS = {
  'DEBT_LIQUID':    '#22C55E',
  'DEBT_SHORT_DUR': '#22C55E',
  'EQUITY_LARGE_CAP': '#4ADE80',
  'EQUITY_INDEX':   '#4ADE80',
  'EQUITY_FLEXI_CAP': '#F59E0B',
  'HYBRID_BALANCED': '#F59E0B',
  'EQUITY_MID_CAP':  '#F97316',
  'EQUITY_SMALL_CAP': '#EF4444',
}

const SCHEME_LABELS = {
  'EQUITY_LARGE_CAP':  'Large Cap',
  'EQUITY_MID_CAP':    'Mid Cap',
  'EQUITY_SMALL_CAP':  'Small Cap',
  'EQUITY_FLEXI_CAP':  'Flexi Cap',
  'EQUITY_INDEX':      'Index',
  'DEBT_LIQUID':       'Liquid Debt',
  'DEBT_SHORT_DUR':    'Short Duration',
  'HYBRID_BALANCED':   'Hybrid',
}

// ── LTV BAR ───────────────────────────────────────────────────
// Scale: bar fills to 100% when LTV = 50% (government threshold)
// This makes the visual intuitive — halfway filled = at the limit
function LTVBar({ ltvRatio }) {
  const pct = Math.min((ltvRatio / 50) * 100, 100) // scaled to 50% = full

  const barColor =
    ltvRatio > 45 ? '#EF4444' :
    ltvRatio >= 42 ? '#F59E0B' :
    ltvRatio >= 80 ? '#F97316' :
    '#22C55E'

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px' }}>
          LTV RATIO
        </p>
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
          color: barColor,
        }}>
          {ltvRatio.toFixed(1)}%
        </p>
      </div>

      {/* Bar */}
      <div className="ltv-bar-track">
        <motion.div
          className="ltv-bar-fill"
          animate={{ width: `${pct}%`, backgroundColor: barColor }}
          initial={{ width: '0%' }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          style={{ background: barColor, boxShadow: `0 0 10px ${barColor}40` }}
        />

        {/* 42% marker (watch threshold) */}
        <div
          className="ltv-marker"
          style={{
            left: `${(42/50)*100}%`,
            background: '#F59E0B',
            transform: 'translateX(-50%)',
          }}
        />

        {/* 45% marker (action threshold) */}
        <div
          className="ltv-marker"
          style={{
            left: `${(45/50)*100}%`,
            background: '#EF4444',
            transform: 'translateX(-50%)',
          }}
        />
      </div>

      {/* Scale labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)' }}>0%</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#F59E0B' }}>42%</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#EF4444' }}>45%</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)' }}>50% ← Govt limit</span>
      </div>
    </div>
  )
}

// ── HOLDING CARD ──────────────────────────────────────────────
function HoldingCard({ holding, hidden, totalPledgedValue, marketDrop }) {
  const [expanded, setExpanded] = useState(false)

  const nav         = parseFloat(holding.nav_at_fetch || holding.nav || 0)
  const units       = parseFloat(holding.units_pledged || holding.units || 0)
  const ltvCap      = LTV_CAPS[holding.scheme_type] || 0.40
  const effectiveNav = nav * (1 - (marketDrop || 0) / 100)
  const currentValue = units * effectiveNav
  const eligibleCredit = currentValue * ltvCap
  const allocation  = totalPledgedValue > 0 ? (currentValue / totalPledgedValue) * 100 : 0
  const navChange   = nav > 0 ? ((effectiveNav - nav) / nav * 100) : 0
  const color       = FUND_QUALITY_COLORS[holding.scheme_type] || 'var(--text-secondary)'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background:   'var(--bg-surface)',
        border:       expanded ? '1px solid var(--jade-border)' : '1px solid var(--border)',
        borderRadius: 18, marginBottom: 10, overflow: 'hidden',
        cursor: 'pointer',
        transition:   'border-color 0.2s',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Main row */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <p style={{
              fontSize: 13, fontWeight: 700, color: 'var(--text-primary)',
              lineHeight: 1.2, marginBottom: 4,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {holding.scheme_name}
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 8,
                background: `${color}15`, color, border: `1px solid ${color}30`,
                padding: '2px 7px', borderRadius: 6, letterSpacing: '0.5px',
              }}>
                {SCHEME_LABELS[holding.scheme_type] || holding.scheme_type}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 8,
                background: 'var(--jade-dim)', color: 'var(--jade)',
                border: '1px solid var(--jade-border)',
                padding: '2px 7px', borderRadius: 6, letterSpacing: '0.5px',
              }}>
                PLEDGED
              </span>
              {holding.is_notorious && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 8,
                  background: 'rgba(239,68,68,0.1)', color: 'var(--red)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  padding: '2px 7px', borderRadius: 6,
                }}>
                  ⚠ WATCHLIST
                </span>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 16,
              fontWeight: 800, color: 'var(--text-primary)',
            }}>
              {hidden ? '••••••' : fmtL(currentValue)}
            </p>
            {/* Allocation bar */}
            <div style={{ width: 80, height: 3, background: 'var(--bg-elevated)', borderRadius: 2, marginTop: 4, marginLeft: 'auto' }}>
              <div style={{
                width: `${allocation}%`, height: '100%',
                background: color, borderRadius: 2,
              }} />
            </div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
              {allocation.toFixed(1)}% of pledge
            </p>
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div style={{
              padding: '0 16px 14px',
              borderTop: '1px solid var(--border)',
              paddingTop: 12,
              display: 'grid', gridTemplateColumns: '1fr 1fr',
              gap: 12,
            }}>
              {[
                { label: 'UNITS', value: units.toFixed(3) },
                { label: 'LTV CAP', value: `${(ltvCap * 100).toFixed(0)}%` },
                { label: 'CURRENT NAV', value: hidden ? '••' : `₹${effectiveNav.toFixed(2)}` },
                { label: 'ELIGIBLE CREDIT', value: hidden ? '••••' : fmtL(eligibleCredit) },
                { label: 'ORIGINAL NAV', value: hidden ? '••' : `₹${nav.toFixed(2)}` },
                {
                  label: 'NAV CHANGE',
                  value: `${navChange >= 0 ? '+' : ''}${navChange.toFixed(2)}%`,
                  color: navChange >= 0 ? 'var(--jade)' : 'var(--red)',
                },
              ].map((d, i) => (
                <div key={i}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)', letterSpacing: '1.5px', marginBottom: 2 }}>
                    {d.label}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: d.color || 'var(--text-primary)' }}>
                    {d.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Bottom glow line */}
            <div style={{
              height: 2,
              background: `linear-gradient(90deg, transparent, ${color}, transparent)`,
              opacity: 0.4,
            }} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── MAIN PORTFOLIO ────────────────────────────────────────────
export default function Portfolio() {
  const { ltvRatio, availableLimit, marketDrop } = useRiskState()
  const [holdings, setHoldings]   = useState([])
  const [pledges, setPledges]     = useState([])
  const [summary, setSummary]     = useState(null)
  const [hidden, setHidden]       = useState(false)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    Promise.all([
      getPortfolioSummary().catch(() => null),
      getPledgeStatus().catch(() => null),
    ]).then(([s, p]) => {
      setSummary(s?.data || s)
      const pledgeList = p?.data?.pledges || p?.pledges || []
      setPledges(pledgeList)
    }).finally(() => setLoading(false))
  }, [])

  // Combine pledge data with holding data for display
  const pledgedItems = pledges.filter(p => p.status === 'ACTIVE')
  const totalPledgedValue = pledgedItems.reduce((sum, p) => {
    const nav   = parseFloat(p.nav_at_pledge || 0)
    const units = parseFloat(p.units_pledged || 0)
    const effectiveNav = nav * (1 - (marketDrop || 0) / 100)
    return sum + (units * effectiveNav)
  }, 0)

  const totalPortfolioValue = parseFloat(summary?.total_portfolio_value || 0)
  const marketDropLabel     = marketDrop > 0 ? `-${marketDrop}%` : null

  if (loading) return (
    <div className="screen">
      <MarketTicker />
      <div className="page-pad" style={{ paddingTop: 20 }}>
        {[1,2,3].map(i => <div key={i} className="shimmer" style={{ height: 80, borderRadius: 18, marginBottom: 10 }} />)}
      </div>
    </div>
  )

  return (
    <div className="screen">
      <MarketTicker />

      <div className="page-pad" style={{ paddingTop: 20 }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}
        >
          <div>
            <h1 style={{
              fontFamily: 'var(--font-display)', fontSize: 30,
              fontWeight: 800, letterSpacing: '-0.02em',
            }}>Portfolio</h1>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>Collateral health</p>
          </div>
          <button
            onClick={() => setHidden(h => !h)}
            style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, color: 'var(--text-secondary)',
            }}
          >
            {hidden ? '👁' : '🙈'}
          </button>
        </motion.div>

        {/* Hero numbers */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-light)',
            borderRadius: 20, padding: '18px 20px', marginBottom: 16,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 4 }}>
                PORTFOLIO VALUE
              </p>
              <p style={{
                fontFamily: 'var(--font-display)', fontSize: 22,
                fontWeight: 800, letterSpacing: '-0.02em',
              }}>
                {hidden ? '••••••' : fmtL(totalPortfolioValue * (1 - marketDrop / 100))}
              </p>
              {marketDropLabel && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10,
                  background: 'rgba(239,68,68,0.1)', color: 'var(--red)',
                  padding: '2px 6px', borderRadius: 5, marginTop: 4, display: 'inline-block',
                }}>
                  ▼ {marketDropLabel}
                </span>
              )}
            </div>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 4 }}>
                AVAILABLE CREDIT
              </p>
              <p style={{
                fontFamily: 'var(--font-display)', fontSize: 22,
                fontWeight: 800, color: 'var(--jade)', letterSpacing: '-0.02em',
              }}>
                {hidden ? '••••••' : fmtL(availableLimit)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* LTV Bar */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 16, padding: '14px 16px', marginBottom: 16,
          }}
        >
          <LTVBar ltvRatio={ltvRatio} />

          {/* LTV Cap Badge */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'var(--jade-dim)', border: '1px solid var(--jade-border)',
              borderRadius: 8, padding: '4px 10px',
            }}>
              <span style={{ fontSize: 12 }}>↑</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--jade)', fontWeight: 600 }}>
                LTV Cap: 40%
              </span>
            </div>
          </div>
        </motion.div>

        {/* Risk Nudge */}
        <div style={{ marginBottom: 16 }}>
          <RiskNudgeBanner page="portfolio" variant="strip" />
        </div>

        {/* Holdings */}
        <p style={{
          fontFamily: 'var(--font-mono)', fontSize: 9,
          letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10,
        }}>
          PLEDGED HOLDINGS ({pledgedItems.length})
        </p>

        {pledgedItems.length === 0 ? (
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 18, padding: '40px 20px', textAlign: 'center',
          }}>
            <p style={{ fontSize: 36, marginBottom: 10 }}>📊</p>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No pledged funds</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Your pledged holdings will appear here
            </p>
          </div>
        ) : (
          pledgedItems.map((h, i) => (
            <HoldingCard
              key={h.pledge_id || i}
              holding={h}
              hidden={hidden}
              totalPledgedValue={totalPledgedValue}
              marketDrop={marketDrop}
            />
          ))
        )}
      </div>
    </div>
  )
}
