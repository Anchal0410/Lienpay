import { useEffect, useState, useRef } from 'react'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import { getCreditStatus, getLTVHealth, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import CreditCard3D from '../components/CreditCard3D'
import toast from 'react-hot-toast'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const getGreeting = () => {
  const h = new Date().getHours()
  if (h >= 5  && h < 12) return { text: 'Good morning',   sub: 'Your wealth is growing' }
  if (h >= 12 && h < 17) return { text: 'Good afternoon', sub: 'Markets are moving' }
  if (h >= 17 && h < 21) return { text: 'Good evening',   sub: 'End of a great day' }
  return { text: 'Good night', sub: 'Markets rest, wealth grows' }
}

function AnimatedNumber({ value }) {
  const [display, setDisplay] = useState(0)
  const prevRef = useRef(0)
  useEffect(() => {
    const target = parseFloat(value) || 0
    const start  = prevRef.current
    const duration = 1000
    const startTime = Date.now()
    const tick = () => {
      const elapsed  = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased    = 1 - Math.pow(1 - progress, 4)
      const current  = Math.round(start + (target - start) * eased)
      setDisplay(current)
      if (progress < 1) requestAnimationFrame(tick)
      else prevRef.current = target
    }
    requestAnimationFrame(tick)
  }, [value])
  return <span>₹{display.toLocaleString('en-IN')}</span>
}

function LiquidOrb({ color, size, style = {} }) {
  return (
    <motion.div
      animate={{ scale: [1, 1.2, 0.9, 1.1, 1], rotate: [0, 15, -10, 5, 0] }}
      transition={{ duration: 10 + Math.random() * 4, repeat: Infinity, ease: 'easeInOut' }}
      style={{
        position: 'absolute',
        width: size, height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${color}35, ${color}08)`,
        filter: `blur(${size / 3}px)`,
        pointerEvents: 'none',
        ...style,
      }}
    />
  )
}

export default function Dashboard({ onPay }) {
  const { creditAccount, setCreditAccount, ltvHealth, setLTVHealth,
          setTransactions, transactions, riskDecision } = useStore()
  const [loading, setLoading] = useState(!creditAccount)
  const scrollRef = useRef(null)
  const { scrollY } = useScroll({ container: scrollRef })
  const cardScale   = useTransform(scrollY, [0, 100], [1, 0.94])
  const cardOpacity = useTransform(scrollY, [0, 130], [1, 0.55])
  const headerY     = useTransform(scrollY, [0, 100], [0, -8])
  const greeting    = getGreeting()

  useEffect(() => {
    const load = async () => {
      try {
        const [creditRes, ltvRes, txnRes] = await Promise.all([
          getCreditStatus(), getLTVHealth(), getTxnHistory({ limit: 5 }),
        ])
        setCreditAccount(creditRes.data)
        setLTVHealth(ltvRes.data)
        setTransactions(txnRes.data?.transactions || [])
      } catch (err) { toast.error('Failed to load') }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const account     = creditAccount
  const available   = parseFloat(account?.available_credit || 0)
  const creditLimit = parseFloat(account?.credit_limit || 0)
  const outstanding = parseFloat(account?.outstanding || 0)
  const usedPct     = creditLimit > 0 ? (outstanding / creditLimit) * 100 : 0
  const ltv         = ltvHealth
  const ltvColor    = ltv?.status === 'RED' ? '#EF4444' : ltv?.status === 'AMBER' ? '#F59E0B' : '#00C896'

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)' }}>
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        style={{ width: 36, height: 36, border: '2px solid var(--bg-elevated)', borderTopColor: 'var(--jade)', borderRadius: '50%' }} />
    </div>
  )

  return (
    <div ref={scrollRef} className="screen">
      {/* Liquid background */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <LiquidOrb color="#00C896" size={320} style={{ top: -80, left: -80 }} />
        <LiquidOrb color="#C9A449" size={220} style={{ top: 400, right: -60 }} />
        <LiquidOrb color="#00C896" size={180} style={{ bottom: 200, left: 40 }} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, padding: '0 20px' }}>

        {/* Header */}
        <motion.div style={{ y: headerY }} initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          style2={{ paddingTop: 20, paddingBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ paddingTop: 20, paddingBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
            <div>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
                style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 4 }}>
                LIENPAY
              </motion.p>
              <motion.h1 initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}
                style={{ fontFamily: 'var(--font-serif)', fontSize: 34, fontWeight: 400, lineHeight: 1.1, marginBottom: 3 }}>
                {greeting.text}
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
                style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {greeting.sub}
              </motion.p>
            </div>

            {/* LTV pulse dot */}
            <motion.div initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.4, type: 'spring' }}
              style={{ width: 46, height: 46, borderRadius: '50%', background: `radial-gradient(circle, ${ltvColor}20, transparent)`,
                border: `1.5px solid ${ltvColor}50`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 20 }}>
              <motion.div animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }} transition={{ duration: 2.5, repeat: Infinity }}
                style={{ width: 12, height: 12, borderRadius: '50%', background: ltvColor, boxShadow: `0 0 10px ${ltvColor}` }} />
            </motion.div>
          </div>
        </motion.div>

        {/* Card with scroll effect */}
        <motion.div style={{ scale: cardScale, opacity: cardOpacity, transformOrigin: 'center top', marginBottom: 18 }}>
          <CreditCard3D creditLimit={creditLimit} available={available} vpa={account?.upi_vpa} tier={riskDecision?.risk_tier} />
        </motion.div>

        {/* Available — Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
          style={{
            background: 'linear-gradient(135deg, rgba(0,200,150,0.07), rgba(0,200,150,0.02))',
            border: '1px solid rgba(0,200,150,0.18)', borderRadius: 24,
            padding: '22px 22px', marginBottom: 14, position: 'relative', overflow: 'hidden',
          }}>
          <motion.div animate={{ x: [0, 10, -5, 0], y: [0, -8, 4, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
            style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(0,200,150,0.15), transparent)', filter: 'blur(15px)' }} />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2.5px', marginBottom: 8 }}>AVAILABLE CREDIT</p>
          <p style={{ fontFamily: 'var(--font-serif)', fontSize: 46, lineHeight: 1, marginBottom: 10, color: 'var(--text-primary)' }}>
            <AnimatedNumber value={available} />
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
              <motion.div initial={{ width: 0 }} animate={{ width: `${usedPct}%` }} transition={{ duration: 1.4, ease: 'easeOut', delay: 0.6 }}
                style={{ height: '100%', borderRadius: 2, background: usedPct > 80 ? 'linear-gradient(90deg,#EF4444,#DC2626)' : 'linear-gradient(90deg,var(--jade),#00A878)' }} />
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{usedPct.toFixed(0)}% used</p>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
          {[
            { icon: '◈', label: 'OUTSTANDING', value: formatCurrency(outstanding), accent: outstanding > 0 ? 'var(--gold)' : 'var(--text-secondary)' },
            { icon: '◎', label: 'INTEREST RATE', value: `${account?.apr || '—'}%`, accent: 'var(--text-primary)' },
          ].map((s, i) => (
            <motion.div key={i} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px', cursor: 'pointer' }}>
              <p style={{ fontSize: 20, marginBottom: 10, opacity: 0.4 }}>{s.icon}</p>
              <p style={{ fontSize: 20, fontWeight: 800, color: s.accent, marginBottom: 4 }}>{s.value}</p>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1.5px' }}>{s.label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* PAY CTA */}
        <motion.button
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
          whileHover={{ scale: 1.02, boxShadow: '0 16px 48px rgba(0,200,150,0.45)' }}
          whileTap={{ scale: 0.96 }}
          onClick={onPay}
          style={{
            width: '100%', height: 70, borderRadius: 22,
            background: 'linear-gradient(135deg, #00C896 0%, #00A878 60%, #007A58 100%)',
            color: '#000', fontSize: 19, fontWeight: 900,
            fontFamily: 'var(--font-sans)', letterSpacing: '-0.5px',
            marginBottom: 24, position: 'relative', overflow: 'hidden',
            boxShadow: '0 12px 40px rgba(0,200,150,0.35)',
          }}
        >
          {/* Shimmer */}
          <motion.div animate={{ x: ['-120%', '220%'] }} transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5, ease: 'linear' }}
            style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)', transform: 'skewX(-20deg)' }} />
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>⊞</span>
            Scan & Pay
          </span>
        </motion.button>

        {/* LTV Alert */}
        <AnimatePresence>
          {ltv && ltv.status !== 'GREEN' && (
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              style={{
                background: ltv.status === 'RED' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${ltv.status === 'RED' ? 'rgba(239,68,68,0.25)' : 'rgba(245,158,11,0.25)'}`,
                borderRadius: 16, padding: '14px 16px', marginBottom: 20,
              }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: ltv.status === 'RED' ? '#EF4444' : '#F59E0B', marginBottom: 4 }}>
                {ltv.status === 'RED' ? '⚠️ Margin Call' : '⚡ Alert'}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ltv.message}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Transactions */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.5px' }}>Recent</h2>
            <button style={{ fontSize: 12, color: 'var(--jade)', fontWeight: 700 }}>All →</button>
          </div>

          {transactions.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 40, marginBottom: 10 }}>💳</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600 }}>No payments yet</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Scan any UPI QR to pay</p>
            </motion.div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {transactions.map((txn, i) => (
                <motion.div key={txn.txn_id}
                  initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                  whileHover={{ x: 4, background: 'var(--bg-elevated)' }}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 16, padding: '14px 16px', cursor: 'pointer', transition: 'background 0.2s, transform 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 14, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
                      🏪
                    </div>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 2 }}>{txn.merchant_name || txn.merchant_vpa}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(txn.initiated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {txn.is_in_free_period && <span style={{ color: 'var(--jade)', marginLeft: 6, fontWeight: 700 }}>• Free</span>}
                      </p>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <p style={{ fontSize: 16, fontWeight: 800, marginBottom: 2 }}>−{formatCurrency(txn.amount)}</p>
                    <p style={{ fontSize: 10, color: txn.status === 'SETTLED' ? 'var(--jade)' : 'var(--text-muted)', letterSpacing: '0.5px', fontWeight: 600 }}>
                      {txn.status}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {/* Free period card */}
        {outstanding === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}
            style={{ background: 'linear-gradient(135deg, rgba(0,200,150,0.07), rgba(201,164,73,0.04))',
              border: '1px solid rgba(0,200,150,0.15)', borderRadius: 18, padding: '16px 18px', marginBottom: 20 }}>
            <p style={{ fontSize: 14, color: 'var(--jade)', fontWeight: 800, marginBottom: 4 }}>✨ Zero interest right now</p>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Pay within 30 days of each purchase and pay nothing extra. Your wealth earns while you spend free.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  )
}
