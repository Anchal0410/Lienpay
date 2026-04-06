// ─────────────────────────────────────────────────────────────
// MARKET TICKER, RISK NUDGE BANNER, RISK SIMULATION PANEL
// Three components in one file for clean imports
// ─────────────────────────────────────────────────────────────
import { useState, useRef } from 'react'
import { useRiskState } from '../contexts/RiskStateContext'

// ══════════════════════════════════════════════════════════════
// 1. MARKET TICKER
// Seamlessly looping horizontal ticker at top of every page
// ══════════════════════════════════════════════════════════════

const MARKET_DATA = [
  { label: 'GOLD',       value: '₹93,450',  change: '+0.32%', up: true  },
  { label: 'SILVER',     value: '₹1,05,200',change: '+0.18%', up: true  },
  { label: 'NIFTY 50',   value: '23,568',   change: '-0.45%', up: false },
  { label: 'SENSEX',     value: '77,842',   change: '-0.38%', up: false },
  { label: 'BANK NIFTY', value: '50,215',   change: '+0.22%', up: true  },
]

export function MarketTicker() {
  // Triple the data for seamless loop
  const items = [...MARKET_DATA, ...MARKET_DATA, ...MARKET_DATA]

  return (
    <div className="market-ticker">
      <div
        className="ticker-track"
        style={{
          display:    'flex',
          alignItems: 'center',
          gap:        0,
          width:      `${items.length * 160}px`,
          willChange: 'transform',
          animation:  `ticker-scroll ${MARKET_DATA.length * 4}s linear infinite`,
        }}
      >
        {items.map((item, i) => (
          <div
            key={i}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 20px', flexShrink: 0 }}
          >
            <span style={{
              fontFamily:    'var(--font-mono)',
              fontSize:      9,
              fontWeight:    700,
              letterSpacing: '1.5px',
              color:         'var(--text-muted)',
            }}>
              {item.label}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   11,
              fontWeight: 700,
              color:      'var(--text-primary)',
            }}>
              {item.value}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize:   10,
              fontWeight: 600,
              color:      item.up ? '#4ADE80' : '#F87171',
            }}>
              {item.up ? '▲' : '▼'} {item.change}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.4 }}>·</span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// 2. RISK NUDGE BANNER
// Context-specific risk messaging (Home / Portfolio / Billing)
// ══════════════════════════════════════════════════════════════

const NUDGE_CONFIG = {
  healthy: {
    color:      '#22C55E',
    bg:         'rgba(34,197,94,0.05)',
    border:     'rgba(34,197,94,0.15)',
    icon:       '🛡',
    title:      'Account healthy',
    home:       'Your portfolio buffer is comfortably within range.',
    portfolio:  'Collateral stable — Your pledged holdings are supporting the account comfortably.',
    billing:    'No immediate repayment pressure — Your account remains within a comfortable range.',
  },
  watch: {
    color:      '#F59E0B',
    bg:         'rgba(245,158,11,0.05)',
    border:     'rgba(245,158,11,0.18)',
    icon:       '⚠',
    title:      'Buffer reduced',
    home:       'Market movement has reduced your safety buffer. UPI paused.',
    portfolio:  'Collateral under watch — Recent movement has reduced available headroom.',
    billing:    'Optional repayment — A small repayment can rebuild your buffer.',
  },
  action: {
    color:      '#F97316',
    bg:         'rgba(249,115,22,0.05)',
    border:     'rgba(249,115,22,0.18)',
    icon:       '⚡',
    title:      'Action needed',
    home:       'Your buffer has tightened. Repay or add collateral to stay comfortable.',
    portfolio:  'Buffer tightening — Current collateral health suggests corrective action may be needed.',
    billing:    'Recommended repayment — Repay now to improve portfolio headroom.',
  },
  critical: {
    color:      '#EF4444',
    bg:         'rgba(239,68,68,0.05)',
    border:     'rgba(239,68,68,0.2)',
    icon:       '🚨',
    title:      'Urgent attention needed',
    home:       'Your account is near the risk limit. Repayment is now recommended.',
    portfolio:  'Margin pressure rising — Your pledged portfolio is approaching the risk threshold.',
    billing:    'Priority repayment — Repayment is needed before spending can resume.',
  },
}

export function RiskNudgeBanner({ page = 'home', variant = 'banner' }) {
  const { riskState } = useRiskState()
  const cfg = NUDGE_CONFIG[riskState]
  const text = cfg[page] || cfg.home
  const isStrip = variant === 'strip'

  return (
    <div style={{
      background:   cfg.bg,
      border:       `1px solid ${cfg.border}`,
      borderRadius: isStrip ? 12 : 14,
      padding:      isStrip ? '10px 12px' : '12px 14px',
      display:      'flex',
      alignItems:   'center',
      gap:          isStrip ? 8 : 10,
    }}>
      <span style={{ fontSize: isStrip ? 14 : 16, flexShrink: 0 }}>{cfg.icon}</span>
      <div style={{ flex: 1 }}>
        {!isStrip && (
          <p style={{
            fontFamily:    'var(--font-display)',
            fontSize:      12,
            fontWeight:    700,
            color:         cfg.color,
            marginBottom:  2,
            letterSpacing: '-0.01em',
          }}>
            {cfg.title}
          </p>
        )}
        <p style={{
          fontSize:   isStrip ? 11 : 12,
          color:      'var(--text-secondary)',
          lineHeight: 1.4,
        }}>
          {text}
        </p>
      </div>
      {!isStrip && (
        <span style={{ color: cfg.color, fontSize: 14, flexShrink: 0 }}>›</span>
      )}
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// 3. RISK SIMULATION PANEL (Secret debug panel)
// Right-edge toggle for internal testing
// ══════════════════════════════════════════════════════════════

const STATE_COLORS = {
  healthy:  '#22C55E',
  watch:    '#F59E0B',
  action:   '#F97316',
  critical: '#EF4444',
}

const STATE_LABELS = {
  healthy:  'Healthy',
  watch:    'Watch',
  action:   'Action Needed',
  critical: 'Critical',
}

const THRESHOLDS = [
  { label: 'Healthy',      range: '< 80%',  state: 'healthy',  color: '#22C55E' },
  { label: 'Watch',        range: '80–89%', state: 'watch',    color: '#F59E0B' },
  { label: 'Action',       range: '90–94%', state: 'action',   color: '#F97316' },
  { label: 'Critical',     range: '≥ 95%',  state: 'critical', color: '#EF4444' },
]

export function RiskSimulationPanel() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('outstanding') // 'outstanding' | 'available'

  const {
    riskState, ltvRatio, ltvCap,
    totalLimit, outstanding, availableLimit,
    setOutstanding, setAvailableLimit,
    marketDrop, setMarketDrop,
    portfolioValue, effectivePortfolioValue,
  } = useRiskState()

  const color = STATE_COLORS[riskState]
  const fmtINR = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`

  const handleSpendingChange = (raw) => {
    const val = Math.round(raw / 1000) * 1000
    if (mode === 'outstanding')  setOutstanding(val)
    else                          setAvailableLimit(val)
  }

  const spendingValue = mode === 'outstanding' ? outstanding : availableLimit

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 99,
            background: 'rgba(0,0,0,0.5)',
          }}
        />
      )}

      {/* Tab trigger */}
      <button
        className="sim-tab"
        onClick={() => setOpen(o => !o)}
        style={{ borderColor: `${color}30` }}
        title="Risk Simulation"
      >
        <span style={{ fontSize: 14, color }}>⚡</span>
      </button>

      {/* Panel */}
      <div className={`sim-panel ${open ? 'open' : ''}`}>
        <div style={{ padding: 16 }}>

          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)' }}>
              RISK SIMULATOR
            </p>
            <button onClick={() => setOpen(false)} style={{ color: 'var(--text-muted)', fontSize: 18 }}>×</button>
          </div>

          {/* Current State */}
          <div style={{
            background: `${color}10`, border: `1px solid ${color}25`,
            borderRadius: 12, padding: '10px 12px', marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color }}>
                {STATE_LABELS[riskState]}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              {[['LTV', `${ltvRatio}%`], ['Cap', `${ltvCap}%`]].map(([l, v]) => (
                <div key={l}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1px' }}>{l}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color }}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Thresholds */}
          <div style={{ marginBottom: 16 }}>
            {THRESHOLDS.map(t => (
              <div key={t.state} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 8px', borderRadius: 8,
                background: riskState === t.state ? `${t.color}10` : 'transparent',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: t.color }} />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t.label}</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: t.color }}>{t.range}</span>
              </div>
            ))}
          </div>

          {/* Mode toggle */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, background: 'var(--bg-surface)', borderRadius: 10, padding: 3 }}>
            {[['outstanding','Used'], ['available','Available']].map(([m, l]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1, height: 30, borderRadius: 8, fontSize: 11, fontWeight: 600,
                  background: mode === m ? (m === 'outstanding' ? 'var(--amber-dim)' : 'var(--jade-dim)') : 'transparent',
                  color: mode === m ? (m === 'outstanding' ? 'var(--amber)' : 'var(--jade)') : 'var(--text-muted)',
                  border: mode === m ? `1px solid ${m === 'outstanding' ? 'var(--amber-border)' : 'var(--jade-border)'}` : '1px solid transparent',
                }}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Spending controls */}
          <div style={{ marginBottom: 12 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
              {mode === 'outstanding' ? 'USED AMOUNT' : 'AVAILABLE CREDIT'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
              <button
                onClick={() => handleSpendingChange(spendingValue - 5000)}
                style={{
                  width: 36, height: 36, borderRadius: 8, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-light)', color: 'var(--text-primary)', fontSize: 16,
                }}
              >−</button>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700,
                color: mode === 'outstanding' ? 'var(--amber)' : 'var(--jade)',
                flex: 1, textAlign: 'center',
              }}>
                {fmtINR(spendingValue)}
              </p>
              <button
                onClick={() => handleSpendingChange(spendingValue + 5000)}
                style={{
                  width: 36, height: 36, borderRadius: 8, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-light)', color: 'var(--text-primary)', fontSize: 16,
                }}
              >+</button>
            </div>
            <input
              type="range" min={0} max={totalLimit} step={1000}
              value={spendingValue}
              onChange={e => handleSpendingChange(parseFloat(e.target.value))}
              style={{ width: '100%' }}
            />
            {/* Presets */}
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              {(mode === 'outstanding'
                ? [[0,'0'],[totalLimit*0.25,'25%'],[totalLimit*0.5,'50%'],[totalLimit*0.75,'75%'],[totalLimit,'MAX']]
                : [[totalLimit,'MAX'],[totalLimit*0.75,'75%'],[totalLimit*0.5,'50%'],[totalLimit*0.25,'25%'],[0,'0']]
              ).map(([v, l]) => (
                <button
                  key={l}
                  onClick={() => handleSpendingChange(v)}
                  style={{
                    flex: 1, height: 24, borderRadius: 6, fontSize: 9,
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Portfolio drop */}
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 12,
          }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
              📉 PORTFOLIO DROP SIMULATION
            </p>
            <input
              type="range" min={0} max={50} step={1}
              value={marketDrop}
              onChange={e => setMarketDrop(parseFloat(e.target.value))}
              style={{ width: '100%', marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[0, -5, -10, -15, -20, -30].map(v => (
                <button
                  key={v}
                  onClick={() => setMarketDrop(Math.abs(v))}
                  style={{
                    flex: 1, height: 22, borderRadius: 5, fontSize: 9,
                    fontFamily: 'var(--font-mono)', fontWeight: 600,
                    background: marketDrop === Math.abs(v) ? 'var(--red-dim)' : 'var(--bg-elevated)',
                    border: marketDrop === Math.abs(v) ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)',
                    color: marketDrop === Math.abs(v) ? 'var(--red)' : 'var(--text-muted)',
                  }}
                >
                  {v === 0 ? '0' : `${v}%`}
                </button>
              ))}
            </div>
            {marketDrop > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>Original</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}>{fmtINR(portfolioValue)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>After drop</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--red)' }}>{fmtINR(effectivePortfolioValue)}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>LTV</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color }}>
                    {ltvRatio}%
                  </p>
                </div>
              </div>
            )}
          </div>

          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
            Outstanding pushes LTV up. Portfolio drop squeezes the same line automatically.
          </p>
        </div>
      </div>
    </>
  )
}
