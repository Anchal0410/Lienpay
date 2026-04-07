import { useEffect } from 'react'
import { motion } from 'framer-motion'
import useStore from '../store/useStore'
import { useRiskState } from '../contexts/RiskStateContext'
import { MarketTicker, RiskNudgeBanner, RiskSimulationPanel } from '../components/RiskComponents'
import NotifBell from '../components/NotifBell'

const fmt  = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${fmt(v)}`
}

function greeting() {
  const h = new Date().getHours()
  if (h < 5)  return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

function CreditRing({ available, total, riskState }) {
  const R    = 76
  const SW   = 7
  const SIZE = (R + SW) * 2
  const CIRC = 2 * Math.PI * R
  const pct    = total > 0 ? Math.max(0, Math.min(1, available / total)) : 1
  const offset = CIRC * (1 - pct)

  const strokeColor = riskState === 'critical' ? '#E05252'
    : riskState === 'action' ? '#E07830'
    : riskState === 'watch'  ? '#E0A030'
    : 'var(--jade)'

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{
        position: 'absolute', width: SIZE + 40, height: SIZE + 40,
        borderRadius: '50%',
        background: `radial-gradient(circle, ${strokeColor}10 0%, transparent 70%)`,
      }} />

      <svg width={SIZE} height={SIZE} style={{ position: 'relative', zIndex: 2 }}>
        <circle cx={SIZE/2} cy={SIZE/2} r={R}
          fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={SW} />
        <motion.circle
          cx={SIZE/2} cy={SIZE/2} r={R}
          fill="none" stroke={strokeColor} strokeWidth={SW} strokeLinecap="round"
          strokeDasharray={CIRC}
          animate={{ strokeDashoffset: offset }}
          initial={{ strokeDashoffset: CIRC }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${SIZE/2}px ${SIZE/2}px` }}
        />
      </svg>

      <div style={{
        position: 'absolute', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', zIndex: 3,
      }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 4 }}>
          AVAILABLE
        </p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400, color: 'var(--text-primary)', lineHeight: 1 }}>
          {fmtL(available)}
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
          of {fmtL(total)}
        </p>
      </div>
    </div>
  )
}

export default function Dashboard({ onPay }) {
  const { transactions, setTransactions } = useStore()
  const { riskState, upiActive, outstanding, availableLimit, totalLimit, ltvRatio, apr, aprProduct } = useRiskState()

  useEffect(() => {
    import('../api/client').then(({ getTxnHistory }) => {
      getTxnHistory({ limit: 5 })
        .then(res => {
          const txns = res?.data?.transactions || res?.transactions || []
          if (setTransactions) setTransactions(txns)
        })
        .catch(() => {})
    })
  }, [])

  const txns = transactions || []

  const stats = [
    { label: 'OUTSTANDING', value: `₹${fmt(outstanding)}`,
      color: outstanding > 0 ? 'var(--gold)' : 'var(--jade)',
      bg: outstanding > 0 ? 'var(--gold-dim)' : 'var(--jade-dim)' },
    { label: 'LTV RATIO',   value: `${parseFloat(ltvRatio || 0).toFixed(1)}%`,
      color: riskState === 'healthy' ? 'var(--jade)' : riskState === 'watch' ? 'var(--gold)' : 'var(--red)',
      bg: 'var(--jade-dim)' },
    { label: 'APR',         value: `${apr}%`, color: 'var(--text-secondary)', bg: 'var(--bg-elevated)' },
  ]

  return (
    <div className="screen">
      <MarketTicker />

      <div style={{ padding: '20px 20px 0' }}>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
          <div>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '5px', color: 'rgba(0,212,161,0.5)', fontWeight: 700, marginBottom: 4 }}>
              LIENPAY
            </p>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>
              {greeting()}
            </h1>
          </div>
          <NotifBell />
        </motion.div>

        {/* Credit ring */}
        <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.08 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}>
          <CreditRing available={availableLimit} total={totalLimit} riskState={riskState} />

          <div style={{
            marginTop: 12, display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--bg-surface)', border: '1px solid var(--jade-border)',
            borderRadius: 20, padding: '5px 14px',
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: upiActive ? 'var(--jade)' : 'var(--gold)',
              boxShadow: upiActive ? '0 0 6px rgba(0,212,161,0.4)' : '0 0 6px rgba(224,160,48,0.4)',
            }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: upiActive ? 'var(--jade)' : 'var(--gold)' }}>
              {upiActive ? 'CLOU ACTIVE' : 'UPI PAUSED'}
            </span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            {aprProduct === 'INTEREST_ONLY' ? 'Interest-only revolving credit' : 'Closed credit line · Only inside LienPay'}
          </p>
        </motion.div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {stats.map((s, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.05 }}
              style={{ flex: 1, background: s.bg, border: '1px solid var(--border)', borderRadius: 14, padding: '10px 10px' }}>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 4 }}>
                {s.label}
              </p>
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: s.color }}>{s.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Risk nudge */}
        <div style={{ marginBottom: 16 }}>
          <RiskNudgeBanner page="home" variant="strip" />
        </div>

        {/* Scan & Pay — uses onPay prop which opens Pay.jsx (real QR scanner + backend) */}
        <motion.button
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
          whileTap={{ scale: upiActive ? 0.97 : 1 }}
          onClick={() => { if (upiActive && onPay) onPay() }}
          disabled={!upiActive}
          style={{
            width: '100%', height: 56, borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            marginBottom: 10,
            background: upiActive ? 'linear-gradient(135deg, var(--jade), var(--jade-soft))' : 'var(--bg-elevated)',
            color: upiActive ? 'var(--bg-void)' : 'var(--text-muted)',
            fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-sans)',
            boxShadow: upiActive ? '0 4px 20px rgba(0,212,161,0.2)' : 'none',
            cursor: upiActive ? 'pointer' : 'not-allowed',
            opacity: riskState === 'action' ? 0.8 : 1,
            border: 'none',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke={upiActive ? 'var(--bg-void)' : 'var(--text-muted)'} strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <path d="M14 14h3v3m0 4v-4h4M14 21h3"/>
          </svg>
          Scan &amp; Pay
        </motion.button>

        {!upiActive && (
          <p style={{ textAlign: 'center', fontSize: 11, color: riskState === 'critical' ? 'var(--red)' : 'var(--gold)', marginBottom: 10 }}>
            ⚠ UPI paused — repay or add collateral to resume
          </p>
        )}

        {/* Interest info */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--jade-dim)', border: '1px solid var(--jade-border)',
            borderRadius: 14, padding: '12px 14px', marginBottom: 20,
          }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: 'var(--jade)',
            color: 'var(--bg-void)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800, flexShrink: 0,
          }}>0%</div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700 }}>
              {aprProduct === 'INTEREST_ONLY' ? 'Interest-only — pay principal whenever' : '30 days interest-free on every payment'}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {aprProduct === 'INTEREST_ONLY' ? `${apr}% p.a. — interest charged monthly only` : `Then ${(apr / 12).toFixed(1)}%/mo. Cards charge 3%+.`}
            </p>
          </div>
        </motion.div>

        {/* Recent transactions */}
        {txns.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10 }}>
              RECENT
            </p>
            {txns.slice(0, 5).map((t, i) => (
              <motion.div key={t.transaction_id || i}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < txns.length - 1 ? '1px solid var(--border)' : 'none' }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 400, color: 'var(--jade)',
                }}>
                  {(t.merchant_name || 'M').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600 }}>{t.merchant_name || 'Payment'}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1px' }}>
                    {t.status === 'SETTLED' ? '● SETTLED' : t.status}
                  </p>
                </div>
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800 }}>
                  ₹{fmt(t.amount)}
                </p>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <RiskSimulationPanel />
    </div>
  )
}
