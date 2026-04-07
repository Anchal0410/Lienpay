import { useState } from 'react'
import { motion } from 'framer-motion'
import { useRiskState } from '../contexts/RiskStateContext'

// ─────────────────────────────────────────────────────────────
// Inline SVG icons — no emoji, no external deps
// ─────────────────────────────────────────────────────────────
const ShieldIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)
const WarnIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)
const AlertIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
)
const BoltIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
)
const TrendDownIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/>
    <polyline points="17 18 23 18 23 12"/>
  </svg>
)
const MinusIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
)
const PlusIcon = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
)
const CloseIcon = ({ size = 16, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
)

// ── MARKET DATA ───────────────────────────────────────────────
const MARKET_DATA = [
  { label: 'GOLD',       value: '93,450',   change: '+0.32%', up: true  },
  { label: 'SILVER',     value: '1,05,200', change: '+0.18%', up: true  },
  { label: 'NIFTY 50',   value: '23,568',   change: '-0.45%', up: false },
  { label: 'SENSEX',     value: '77,842',   change: '-0.38%', up: false },
  { label: 'BANK NIFTY', value: '50,215',   change: '+0.22%', up: true  },
]

// ══════════════════════════════════════════════════════════════
// MARKET TICKER
// ══════════════════════════════════════════════════════════════
export function MarketTicker() {
  const items = [...MARKET_DATA, ...MARKET_DATA, ...MARKET_DATA]

  return (
    <div className="market-ticker">
      <div className="ticker-track" style={{ display: 'flex', alignItems: 'center', width: `${items.length * 160}px` }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px', flexShrink: 0 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
              {item.label}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>
              {item.up ? '+' : ''}{item.value}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: item.up ? 'var(--jade)' : 'var(--red)' }}>
              {item.change}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 10, opacity: 0.3 }}>·</span>
          </div>
        ))}
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// RISK NUDGE BANNER
// ══════════════════════════════════════════════════════════════
const NUDGE = {
  healthy: {
    color:  'var(--jade)',
    bg:     'rgba(0,212,161,0.05)',
    border: 'rgba(0,212,161,0.12)',
    Icon:   ShieldIcon,
    title:  'Account healthy',
    home:       'Your portfolio buffer is comfortably within range.',
    portfolio:  'Collateral stable — Your pledged holdings are supporting the account comfortably.',
    billing:    'No immediate repayment pressure — Your account remains within a comfortable range.',
  },
  watch: {
    color:  'var(--gold)',
    bg:     'rgba(196,162,101,0.05)',
    border: 'rgba(196,162,101,0.18)',
    Icon:   WarnIcon,
    title:  'Buffer reduced',
    home:       'Market movement has reduced your safety buffer. UPI paused.',
    portfolio:  'Collateral under watch — Recent movement has reduced available headroom.',
    billing:    'Optional repayment — A small repayment can rebuild your buffer.',
  },
  action: {
    color:  '#E07830',
    bg:     'rgba(224,120,48,0.05)',
    border: 'rgba(224,120,48,0.18)',
    Icon:   AlertIcon,
    title:  'Action needed',
    home:       'Your buffer has tightened. Repay or add collateral to stay comfortable.',
    portfolio:  'Buffer tightening — Current collateral health suggests corrective action may be needed.',
    billing:    'Recommended repayment — Repay now to improve portfolio headroom.',
  },
  critical: {
    color:  'var(--red)',
    bg:     'rgba(224,82,82,0.05)',
    border: 'rgba(224,82,82,0.18)',
    Icon:   AlertIcon,
    title:  'Urgent attention needed',
    home:       'Your account is near the risk limit. Repayment is now recommended.',
    portfolio:  'Margin pressure rising — Your pledged portfolio is approaching the risk threshold.',
    billing:    'Priority repayment — Repayment is needed before spending can resume.',
  },
}

export function RiskNudgeBanner({ page = 'home', variant = 'banner' }) {
  const { riskState } = useRiskState()
  const cfg     = NUDGE[riskState]
  const text    = cfg[page] || cfg.home
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
      <cfg.Icon size={isStrip ? 14 : 15} color={cfg.color} />
      <div style={{ flex: 1 }}>
        {!isStrip && (
          <p style={{
            fontFamily:    'var(--font-mono)',
            fontSize:      11,
            fontWeight:    700,
            color:         cfg.color,
            marginBottom:  2,
            letterSpacing: '0.5px',
          }}>
            {cfg.title}
          </p>
        )}
        <p style={{ fontSize: isStrip ? 11 : 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
          {text}
        </p>
      </div>
      {!isStrip && <span style={{ color: cfg.color, fontSize: 14, flexShrink: 0, fontFamily: 'var(--font-mono)' }}>›</span>}
    </div>
  )
}


// ══════════════════════════════════════════════════════════════
// RISK SIMULATION PANEL
// ══════════════════════════════════════════════════════════════
const STATE_META = {
  healthy:  { label: 'Healthy',      color: 'var(--jade)' },
  watch:    { label: 'Watch',        color: 'var(--gold)' },
  action:   { label: 'Action',       color: '#E07830'     },
  critical: { label: 'Critical',     color: 'var(--red)'  },
}

const THRESHOLDS = [
  { label: 'Healthy',  range: '< 80%',  state: 'healthy',  color: 'var(--jade)' },
  { label: 'Watch',    range: '80–89%', state: 'watch',    color: 'var(--gold)' },
  { label: 'Action',   range: '90–94%', state: 'action',   color: '#E07830'     },
  { label: 'Critical', range: '≥ 95%',  state: 'critical', color: 'var(--red)'  },
]

export function RiskSimulationPanel() {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('outstanding')

  const {
    riskState, ltvRatio, ltvCap,
    totalLimit, outstanding, availableLimit,
    setOutstanding, setAvailableLimit,
    marketDrop, setMarketDrop,
    portfolioValue, effectivePortfolioValue,
  } = useRiskState()

  const meta    = STATE_META[riskState]
  const fmtINR  = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`
  const spendVal = mode === 'outstanding' ? outstanding : availableLimit

  const handleChange = (raw) => {
    const val = Math.round(raw / 1000) * 1000
    if (mode === 'outstanding') setOutstanding(val)
    else                        setAvailableLimit(val)
  }

  return (
    <>
      {open && (
        <div onClick={() => setOpen(false)} style={{
          position: 'fixed', inset: 0, zIndex: 99,
          background: 'rgba(0,0,0,0.5)',
        }} />
      )}

      {/* Trigger tab */}
      <button className="sim-tab" onClick={() => setOpen(o => !o)} style={{ borderColor: `${meta.color}25` }}>
        <BoltIcon size={14} color={meta.color} />
      </button>

      {/* Panel */}
      <div className={`sim-panel ${open ? 'open' : ''}`}>
        <div style={{ padding: 16 }}>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)' }}>
              RISK SIMULATOR
            </p>
            <button onClick={() => setOpen(false)} style={{ color: 'var(--text-muted)' }}>
              <CloseIcon size={16} color="var(--text-muted)" />
            </button>
          </div>

          {/* State indicator */}
          <div style={{
            background: `${meta.color}10`, border: `1px solid ${meta.color}25`,
            borderRadius: 12, padding: '10px 12px', marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: meta.color }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: meta.color }}>
                {meta.label}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 20 }}>
              {[['LTV', `${ltvRatio}%`], ['Cap', `${ltvCap}%`]].map(([l, v]) => (
                <div key={l}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1px' }}>{l}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: meta.color }}>{v}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Thresholds */}
          <div style={{ marginBottom: 14 }}>
            {THRESHOLDS.map(t => (
              <div key={t.state} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '5px 8px', borderRadius: 7,
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
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, height: 30, borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: mode === m
                  ? (m === 'outstanding' ? 'rgba(196,162,101,0.12)' : 'var(--jade-dim)')
                  : 'transparent',
                color: mode === m
                  ? (m === 'outstanding' ? 'var(--gold)' : 'var(--jade)')
                  : 'var(--text-muted)',
                border: mode === m
                  ? `1px solid ${m === 'outstanding' ? 'rgba(196,162,101,0.25)' : 'var(--jade-border)'}`
                  : '1px solid transparent',
              }}>{l}</button>
            ))}
          </div>

          {/* Spending slider */}
          <div style={{ marginBottom: 14 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
              {mode === 'outstanding' ? 'USED AMOUNT' : 'AVAILABLE CREDIT'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <button onClick={() => handleChange(spendVal - 5000)} style={{
                width: 34, height: 34, borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
              }}>
                <MinusIcon size={13} color="var(--text-primary)" />
              </button>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 700,
                color: mode === 'outstanding' ? 'var(--gold)' : 'var(--jade)',
              }}>
                {fmtINR(spendVal)}
              </p>
              <button onClick={() => handleChange(spendVal + 5000)} style={{
                width: 34, height: 34, borderRadius: 8,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
              }}>
                <PlusIcon size={13} color="var(--text-primary)" />
              </button>
            </div>
            <input type="range" min={0} max={totalLimit} step={1000}
              value={spendVal} onChange={e => handleChange(parseFloat(e.target.value))}
              style={{ width: '100%', marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              {(mode === 'outstanding'
                ? [[0,'0'],[totalLimit*0.25,'25%'],[totalLimit*0.5,'50%'],[totalLimit*0.75,'75%'],[totalLimit,'MAX']]
                : [[totalLimit,'MAX'],[totalLimit*0.75,'75%'],[totalLimit*0.5,'50%'],[totalLimit*0.25,'25%'],[0,'0']]
              ).map(([v, l]) => (
                <button key={l} onClick={() => handleChange(v)} style={{
                  flex: 1, height: 24, borderRadius: 6,
                  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                }}>{l}</button>
              ))}
            </div>
          </div>

          {/* Portfolio drop */}
          <div style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <TrendDownIcon size={12} color="var(--red)" />
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)' }}>
                PORTFOLIO DROP
              </p>
            </div>
            <input type="range" min={0} max={50} step={1}
              value={marketDrop} onChange={e => setMarketDrop(parseFloat(e.target.value))}
              style={{ width: '100%', marginBottom: 6 }} />
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {[0, -5, -10, -15, -20, -30].map(v => (
                <button key={v} onClick={() => setMarketDrop(Math.abs(v))} style={{
                  flex: 1, height: 22, borderRadius: 5,
                  fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600,
                  background: marketDrop === Math.abs(v) ? 'var(--red-dim)' : 'var(--bg-elevated)',
                  border: marketDrop === Math.abs(v) ? '1px solid rgba(224,82,82,0.3)' : '1px solid var(--border)',
                  color: marketDrop === Math.abs(v) ? 'var(--red)' : 'var(--text-muted)',
                }}>
                  {v === 0 ? '0' : `${v}%`}
                </button>
              ))}
            </div>
            {marketDrop > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>Original</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)' }}>
                    {fmtINR(portfolioValue)}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>After drop</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--red)' }}>
                    {fmtINR(effectivePortfolioValue)}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)' }}>LTV</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: meta.color }}>{ltvRatio}%</p>
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
