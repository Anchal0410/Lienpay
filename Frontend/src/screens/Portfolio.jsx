import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPortfolioSummary, getLTVHealth, getPledgeStatus } from '../api/client'
import useStore from '../store/useStore'
import { useRiskState } from '../contexts/RiskStateContext'
import { MarketTicker, RiskNudgeBanner } from '../components/RiskComponents'

const fmt  = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${fmt(v)}`
}

const SCHEME_COLORS = {
  EQUITY_LARGE_CAP:  'var(--jade)',
  EQUITY_MID_CAP:    '#C9A449',
  EQUITY_SMALL_CAP:  '#E05252',
  EQUITY_FLEXI_CAP:  '#8B5CF6',
  EQUITY_INDEX:      'var(--jade)',
  DEBT_SHORT_DUR:    '#3B82F6',
  DEBT_LIQUID:       '#06B6D4',
  HYBRID_BALANCED:   '#F59E0B',
}

const SCHEME_LABELS = {
  EQUITY_LARGE_CAP:  'Large Cap',
  EQUITY_MID_CAP:    'Mid Cap',
  EQUITY_SMALL_CAP:  'Small Cap',
  EQUITY_FLEXI_CAP:  'Flexi Cap',
  EQUITY_INDEX:      'Index',
  DEBT_SHORT_DUR:    'Short Duration',
  DEBT_LIQUID:       'Liquid Debt',
  HYBRID_BALANCED:   'Hybrid',
}

// LTV Bar: 50% LTV = full bar (govt threshold)
function LTVBar({ ltvRatio }) {
  const ratio = parseFloat(ltvRatio || 0)
  const pct   = Math.min((ratio / 50) * 100, 100)
  const color = ratio >= 90 ? 'var(--red)' : ratio >= 80 ? 'var(--gold)' : 'var(--jade)'

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px' }}>LTV RATIO</p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color }}>{ratio.toFixed(1)}%</p>
      </div>

      {/* Track */}
      <div style={{ width: '100%', height: 8, borderRadius: 6, background: 'var(--bg-elevated)', position: 'relative', overflow: 'visible' }}>
        {/* Fill */}
        <motion.div
          animate={{ width: `${pct}%`, backgroundColor: color }}
          initial={{ width: '0%' }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{
            height: '100%', borderRadius: 6,
            boxShadow: `0 0 8px ${color}60`,
          }}
        />
        {/* 80% marker */}
        <div style={{
          position: 'absolute', left: `${(80/50)*100 > 100 ? 100 : (80/50)*100}%`,
          top: -4, width: 2, height: 16, borderRadius: 1,
          background: 'var(--gold)', transform: 'translateX(-50%)',
          display: (80/50)*100 <= 100 ? 'block' : 'none',
        }} />
        {/* 90% marker */}
        <div style={{
          position: 'absolute', left: `${(90/50)*100 > 100 ? 100 : (90/50)*100}%`,
          top: -4, width: 2, height: 16, borderRadius: 1,
          background: 'var(--red)', transform: 'translateX(-50%)',
          display: (90/50)*100 <= 100 ? 'block' : 'none',
        }} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)' }}>0%</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)' }}>50% (Govt limit)</span>
      </div>
    </div>
  )
}

// Individual pledge card
function PledgeCard({ pledge, hidden, totalValue }) {
  const [expanded, setExpanded] = useState(false)

  const nav       = parseFloat(pledge.nav_at_pledge || 0)
  const units     = parseFloat(pledge.units_pledged || 0)
  const value     = parseFloat(pledge.value_at_pledge || units * nav || 0)
  const eligible  = parseFloat(pledge.eligible_value_at_pledge || value * 0.4 || 0)
  const alloc     = totalValue > 0 ? (value / totalValue) * 100 : 0
  const color     = SCHEME_COLORS[pledge.scheme_type] || 'var(--text-secondary)'
  const typeLabel = SCHEME_LABELS[pledge.scheme_type] || (pledge.scheme_type || 'Fund').replace(/_/g, ' ')

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background:   'var(--bg-surface)',
        border:       expanded ? '1px solid var(--jade-border)' : '1px solid var(--border)',
        borderRadius: 18, marginBottom: 10, overflow: 'hidden', cursor: 'pointer',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      {/* Main row */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, marginRight: 12 }}>
            <p style={{
              fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 6,
              color: 'var(--text-primary)',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {pledge.scheme_name || 'Mutual Fund'}
            </p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 8,
                background: `${color}15`, color, border: `1px solid ${color}30`,
                padding: '2px 7px', borderRadius: 6, letterSpacing: '0.5px',
              }}>{typeLabel}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 8,
                background: 'var(--jade-dim)', color: 'var(--jade)',
                border: '1px solid var(--jade-border)',
                padding: '2px 7px', borderRadius: 6,
              }}>PLEDGED</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)',
                padding: '2px 4px',
              }}>{pledge.rta || 'RTA'}</span>
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 800 }}>
              {hidden ? '••••' : fmtL(value)}
            </p>
            <div style={{ width: 60, height: 3, background: 'var(--bg-elevated)', borderRadius: 2, marginTop: 4, marginLeft: 'auto' }}>
              <div style={{ width: `${alloc}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>
              {alloc.toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      {/* Expanded */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div style={{
              padding: '12px 16px 14px',
              borderTop: '1px solid var(--border)',
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
            }}>
              {[
                { l: 'UNITS PLEDGED',   v: units.toFixed(3) },
                { l: 'NAV AT PLEDGE',   v: hidden ? '••' : `₹${nav.toFixed(2)}` },
                { l: 'PLEDGED VALUE',   v: hidden ? '••••' : fmtL(value) },
                { l: 'ELIGIBLE CREDIT', v: hidden ? '••••' : fmtL(eligible) },
                { l: 'PLEDGE REF',      v: pledge.pledge_ref_number || '—' },
                { l: 'STATUS',          v: pledge.status || 'ACTIVE', color: 'var(--jade)' },
              ].map((d, i) => (
                <div key={i}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: 'var(--text-muted)', letterSpacing: '1.5px', marginBottom: 2 }}>{d.l}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: d.color || 'var(--text-primary)', wordBreak: 'break-all' }}>{d.v}</p>
                </div>
              ))}
            </div>
            <div style={{ height: 2, background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.3 }} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function Portfolio() {
  const { portfolio, setPortfolio, ltvHealth, setLTVHealth, creditAccount } = useStore()
  const { ltvRatio: ctxLtv, availableLimit } = useRiskState()

  const [pledges, setPledges]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [hidden,  setHidden]    = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const [portfolioRes, ltvRes, pledgeRes] = await Promise.all([
          getPortfolioSummary().catch(() => null),
          getLTVHealth().catch(() => null),
          getPledgeStatus().catch(() => null),
        ])

        if (portfolioRes?.data) setPortfolio(portfolioRes.data)
        if (ltvRes?.data)       setLTVHealth(ltvRes.data)

        // API returns { data: { pledges: [...] } }
        const pledgeList = pledgeRes?.data?.pledges || []
        setPledges(pledgeList.filter(p => p.status === 'ACTIVE'))
      } catch (_) {}
      finally { setLoading(false) }
    }
    load()
  }, [])

  const summary       = portfolio?.summary || {}
  const totalValue    = parseFloat(summary.total_value || creditAccount?.credit_limit || 0)
  const ltvRatio      = ltvHealth?.ltv_ratio || ctxLtv || 0
  const outstanding   = parseFloat(creditAccount?.outstanding || 0)
  const totalPledgedV = pledges.reduce((s, p) => s + parseFloat(p.value_at_pledge || 0), 0)

  if (loading) return (
    <div className="screen">
      <MarketTicker />
      <div style={{ padding: '20px 20px 0' }}>
        {[1,2,3].map(i => (
          <div key={i} className="shimmer" style={{ height: 80, borderRadius: 18, marginBottom: 10 }} />
        ))}
      </div>
    </div>
  )

  return (
    <div className="screen">
      <MarketTicker />

      <div style={{ padding: '20px 20px 0' }}>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>Portfolio</h1>
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
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}
          style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
            borderRadius: 20, padding: '18px 20px', marginBottom: 14,
          }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 4 }}>PLEDGED VALUE</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400 }}>
                {hidden ? '••••••' : fmtL(totalPledgedV)}
              </p>
            </div>
            <div>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 4 }}>AVAILABLE CREDIT</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, color: 'var(--jade)' }}>
                {hidden ? '••••••' : fmtL(availableLimit)}
              </p>
            </div>
          </div>
        </motion.div>

        {/* LTV bar */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
          style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 16, padding: '14px 16px', marginBottom: 14,
          }}>
          <LTVBar ltvRatio={ltvRatio} />

          {outstanding > 0 && (
            <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
              <div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>OUTSTANDING</p>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--gold)' }}>
                  {hidden ? '••••' : fmtL(outstanding)}
                </p>
              </div>
              {ltvHealth?.message && (
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', flex: 1, lineHeight: 1.4 }}>
                  {ltvHealth.message}
                </p>
              )}
            </div>
          )}
        </motion.div>

        {/* Risk nudge */}
        <div style={{ marginBottom: 14 }}>
          <RiskNudgeBanner page="portfolio" variant="strip" />
        </div>

        {/* Holdings list */}
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10 }}>
          PLEDGED FUNDS ({pledges.length})
        </p>

        {pledges.length === 0 ? (
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 18, padding: '40px 20px', textAlign: 'center', marginBottom: 20,
          }}>
            <p style={{ fontSize: 32, marginBottom: 10 }}>📊</p>
            <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>No pledged funds</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Your pledged holdings will appear here after onboarding
            </p>
          </div>
        ) : (
          pledges.map((p, i) => (
            <PledgeCard
              key={p.pledge_id || i}
              pledge={p}
              hidden={hidden}
              totalValue={totalPledgedV}
            />
          ))
        )}
      </div>
    </div>
  )
}
