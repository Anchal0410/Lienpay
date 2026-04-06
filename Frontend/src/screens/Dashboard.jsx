import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { getCreditStatus, getTxnHistory, decodeQR, initiatePayment, mockSettle } from '../api/client'
import useStore from '../store/useStore'
import { useRiskState } from '../contexts/RiskStateContext'
import { MarketTicker, RiskNudgeBanner, RiskSimulationPanel } from '../components/RiskComponents'
import NotifBell from '../components/NotifBell'

const fmt    = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtL   = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${fmt(v)}`
}
const fmtPct = (n) => `${parseFloat(n || 0).toFixed(1)}%`

function greeting() {
  const h = new Date().getHours()
  if (h < 5)  return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

// ── CREDIT RING SVG ────────────────────────────────────────────
function CreditRing({ available, total, riskState }) {
  const R = 80
  const SW = 8
  const SIZE = (R + SW) * 2
  const CIRC = 2 * Math.PI * R
  const pct  = total > 0 ? available / total : 1
  const offset = CIRC * (1 - pct)

  const stateColors = {
    healthy:  ['#22C55E', '#16A34A'],
    watch:    ['#F59E0B', '#D97706'],
    action:   ['#F97316', '#EA580C'],
    critical: ['#EF4444', '#DC2626'],
  }
  const [c1, c2] = stateColors[riskState] || stateColors.healthy

  return (
    <div className="credit-ring-wrapper" style={{ width: SIZE, height: SIZE }}>
      {/* Rotating halo */}
      <div
        className="ring-halo"
        style={{
          width: SIZE + 24, height: SIZE + 24,
          marginLeft: -12, marginTop: -12,
          background: `conic-gradient(${c1}15 0deg, transparent 180deg, ${c1}08 360deg)`,
        }}
      />

      <svg width={SIZE} height={SIZE} style={{ position: 'relative', zIndex: 2 }}>
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>

        {/* Track */}
        <circle
          cx={SIZE/2} cy={SIZE/2} r={R}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW}
        />

        {/* Fill */}
        <motion.circle
          cx={SIZE/2} cy={SIZE/2} r={R}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={SW}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          animate={{ strokeDashoffset: offset }}
          initial={{ strokeDashoffset: CIRC }}
          transition={{ duration: 1, ease: 'easeOut' }}
          style={{ transform: `rotate(-90deg)`, transformOrigin: `${SIZE/2}px ${SIZE/2}px` }}
        />
      </svg>

      {/* Center text */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', zIndex: 3,
      }}>
        <p style={{
          fontFamily:    'var(--font-mono)',
          fontSize:      9,
          letterSpacing: '2px',
          color:         'var(--text-muted)',
          marginBottom:  4,
        }}>AVAILABLE</p>
        <p style={{
          fontFamily: 'var(--font-display)',
          fontSize:   28,
          fontWeight: 800,
          color:      'var(--text-primary)',
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}>
          {fmtL(available)}
        </p>
        <p style={{
          fontFamily: 'var(--font-mono)',
          fontSize:   11,
          color:      'var(--text-secondary)',
          marginTop:  4,
        }}>
          of {fmtL(total)}
        </p>
      </div>
    </div>
  )
}

// ── MAIN DASHBOARD ─────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useStore()
  const {
    riskState, upiActive,
    outstanding, availableLimit, totalLimit, ltvRatio,
    apr, aprProduct, refreshAccount, spendFromLimit,
  } = useRiskState()

  const [txns, setTxns]         = useState([])
  const [scanning, setScanning] = useState(false)
  const [qrResult, setQrResult] = useState(null)
  const [paying, setPaying]     = useState(false)
  const [txnSuccess, setTxnSuccess] = useState(null)
  const videoRef = useRef(null)

  useEffect(() => {
    getTxnHistory({ limit: 5 })
      .then(res => setTxns(res?.data?.transactions || res?.transactions || []))
      .catch(() => {})
  }, [])

  // Determine active APR display
  const aprDisplay = aprProduct === 'INTEREST_ONLY'
    ? '18% p.a. interest-only'
    : `0% (first 30d) → ${apr}% p.a.`

  // Stat cards
  const stats = [
    {
      label: 'OUTSTANDING',
      value: `₹${fmt(outstanding)}`,
      color: outstanding > 0 ? 'var(--amber)' : 'var(--jade)',
      bg:    outstanding > 0 ? 'rgba(245,158,11,0.08)' : 'rgba(34,197,94,0.05)',
    },
    {
      label: 'LTV RATIO',
      value: fmtPct(ltvRatio),
      color: riskState === 'healthy' ? 'var(--jade)' : riskState === 'watch' ? 'var(--amber)' : 'var(--red)',
      bg:    'rgba(34,197,94,0.05)',
    },
    {
      label: 'APR',
      value: `${apr}%`,
      color: 'var(--text-secondary)',
      bg:    'var(--bg-elevated)',
    },
  ]

  return (
    <div className="screen">
      <MarketTicker />

      <div className="page-pad" style={{ paddingTop: 20 }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}
        >
          <div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              letterSpacing: '5px', color: 'rgba(34,197,94,0.6)',
              fontWeight: 700, marginBottom: 4,
            }}>LIENPAY</p>
            <h1 style={{
              fontFamily: 'var(--font-display)',
              fontSize: 30, fontWeight: 700,
              letterSpacing: '-0.02em',
            }}>
              {greeting()}
            </h1>
          </div>
          <NotifBell />
        </motion.div>

        {/* Credit Ring */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 24 }}
        >
          <CreditRing
            available={availableLimit}
            total={totalLimit}
            riskState={riskState}
          />

          {/* Status pill */}
          <motion.div
            style={{
              marginTop: 12,
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--bg-surface)',
              border: '1px solid var(--jade-border)',
              borderRadius: 20, padding: '5px 12px',
            }}
          >
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--jade)',
              boxShadow: '0 0 6px var(--jade-glow)',
            }} />
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              fontWeight: 700, letterSpacing: '1.5px',
              color: 'var(--jade)',
            }}>CLOU ACTIVE</span>
          </motion.div>

          <p style={{
            fontSize: 11, color: 'var(--text-muted)', marginTop: 4,
          }}>
            {aprProduct === 'INTEREST_ONLY' ? 'Interest-only revolving credit' : 'Closed credit line · Only inside LienPay'}
          </p>
        </motion.div>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {stats.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              style={{
                flex: 1, background: s.bg,
                border: '1px solid var(--border)',
                borderRadius: 14, padding: '10px 10px',
              }}
            >
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 8,
                letterSpacing: '2px', color: 'var(--text-muted)',
                marginBottom: 4,
              }}>{s.label}</p>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 15,
                fontWeight: 800, color: s.color,
              }}>{s.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Risk Nudge */}
        <div style={{ marginBottom: 16 }}>
          <RiskNudgeBanner page="home" variant="strip" />
        </div>

        {/* Scan & Pay */}
        <motion.button
          className="btn-primary"
          whileTap={{ scale: upiActive ? 0.97 : 1 }}
          disabled={!upiActive || paying}
          onClick={() => upiActive && setScanning(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, marginBottom: 10,
            opacity: riskState === 'action' ? 0.8 : 1,
            cursor: upiActive ? 'pointer' : 'not-allowed',
            background: upiActive
              ? 'linear-gradient(135deg, var(--jade), #16A34A)'
              : 'var(--bg-elevated)',
            color: upiActive ? '#000' : 'var(--text-muted)',
          }}
        >
          <span style={{ fontSize: 20 }}>⊞</span>
          <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.01em' }}>
            Scan & Pay
          </span>
        </motion.button>

        {!upiActive && (
          <p style={{
            textAlign: 'center', fontSize: 11,
            color: riskState === 'critical' ? 'var(--red)' : 'var(--amber)',
            marginBottom: 10,
          }}>
            {riskState === 'critical'
              ? '⚠ UPI paused — repay or add collateral to resume'
              : '⚠ UPI paused at 80% LTV — portfolio safety buffer reached'}
          </p>
        )}

        {/* Interest banner */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--jade-dim)',
            border: '1px solid var(--jade-border)',
            borderRadius: 14, padding: '12px 14px', marginBottom: 20,
          }}
        >
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--jade)', color: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 800, flexShrink: 0,
          }}>0%</div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
              {aprProduct === 'INTEREST_ONLY'
                ? 'Interest-only mode — Pay whenever you want'
                : '30 days interest-free on every payment'}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {aprProduct === 'INTEREST_ONLY'
                ? `${apr}% p.a. — pay just the interest monthly, principal anytime`
                : `Then just ${apr/12}%/mo. Credit cards charge 3%+.`}
            </p>
          </div>
        </motion.div>

        {/* Recent Transactions */}
        {txns.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 10,
            }}>RECENT TRANSACTIONS</p>

            {txns.slice(0, 5).map((t, i) => (
              <motion.div
                key={t.transaction_id || i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 0',
                  borderBottom: i < 4 ? '1px solid var(--border)' : 'none',
                }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-light)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800,
                  color: 'var(--jade)',
                }}>
                  {(t.merchant_name || 'M').charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 600 }}>{t.merchant_name || 'Payment'}</p>
                  <p style={{
                    fontFamily: 'var(--font-mono)', fontSize: 9,
                    color: 'var(--text-muted)', letterSpacing: '1px',
                  }}>
                    {t.status === 'SETTLED' ? '● SETTLED' : t.status}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{
                    fontFamily: 'var(--font-mono)', fontSize: 14,
                    fontWeight: 800, color: 'var(--text-primary)',
                  }}>
                    ₹{fmt(t.amount)}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Scanner overlay */}
      <AnimatePresence>
        {scanning && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 80,
              background: 'rgba(9,9,15,0.97)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <button
              onClick={() => setScanning(false)}
              style={{
                position: 'absolute', top: 16, right: 16,
                color: 'var(--text-secondary)', fontSize: 24,
              }}
            >×</button>

            {/* Mock QR frame */}
            <div style={{
              width: 240, height: 240,
              border: '2px solid var(--jade)',
              borderRadius: 20, position: 'relative',
              marginBottom: 32,
              boxShadow: '0 0 30px var(--jade-glow)',
            }}>
              {/* Corner brackets */}
              {[[0,0],[0,1],[1,0],[1,1]].map(([r,c], i) => (
                <div key={i} style={{
                  position: 'absolute',
                  top:    r ? 'auto' : 0,   bottom: r ? 0 : 'auto',
                  left:   c ? 'auto' : 0,   right:  c ? 0 : 'auto',
                  width: 24, height: 24,
                  borderTop:    r ? 'none' : '3px solid var(--jade)',
                  borderBottom: r ? '3px solid var(--jade)' : 'none',
                  borderLeft:   c ? 'none' : '3px solid var(--jade)',
                  borderRight:  c ? '3px solid var(--jade)' : 'none',
                  borderRadius: `${r?0:6}px ${r?0:c?6:0}px ${r?6:0}px ${r?c?0:6:0}px`,
                }} />
              ))}

              {/* Scan line */}
              <motion.div
                animate={{ top: ['10%', '90%', '10%'] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute', left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, transparent, var(--jade), transparent)',
                  boxShadow: '0 0 8px var(--jade-glow)',
                }}
              />
            </div>

            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              color: 'var(--text-muted)', letterSpacing: '2px',
              marginBottom: 24,
            }}>
              POINT AT ANY UPI QR CODE
            </p>

            {/* Simulate payment for development */}
            <button
              className="btn-primary"
              style={{ width: 'auto', padding: '0 32px', height: 48 }}
              onClick={async () => {
                setScanning(false)
                setPaying(true)
                try {
                  const txnRes = await initiatePayment({
                    merchant_vpa:  'merchant@upi',
                    merchant_name: 'Test Merchant',
                    amount:        500,
                    qr_string:     'upi://pay?pa=merchant@upi&am=500',
                  })
                  await mockSettle(txnRes.data?.transaction_id)
                  spendFromLimit(500)
                  setTxnSuccess({ amount: 500, merchant: 'Test Merchant', utr: `UTR${Date.now()}` })
                } catch (err) {
                  toast.error(err.message)
                } finally {
                  setPaying(false)
                }
              }}
            >
              Simulate ₹500 Payment
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success overlay */}
      <AnimatePresence>
        {txnSuccess && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{
              position: 'fixed', inset: 0, zIndex: 90,
              background: 'rgba(9,9,15,0.97)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--jade), #16A34A)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, marginBottom: 16,
              boxShadow: '0 0 30px var(--jade-glow)',
            }}>✓</div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
              Payment Sent
            </p>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 28,
              fontWeight: 800, color: 'var(--jade)', marginBottom: 16,
            }}>
              ₹{fmt(txnSuccess.amount)}
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>
              {txnSuccess.merchant}
            </p>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: 10,
              color: 'var(--text-muted)', marginBottom: 32,
            }}>
              {txnSuccess.utr}
            </p>
            <button
              className="btn-primary"
              style={{ width: 'auto', padding: '0 48px', height: 48 }}
              onClick={() => { setTxnSuccess(null); refreshAccount() }}
            >
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <RiskSimulationPanel />
    </div>
  )
}
