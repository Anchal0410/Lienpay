import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { LiquidBlob } from '../components/LiquidUI'
import { LienzoLogoImage } from '../components/Logo'

// ─────────────────────────────────────────────────────────────
// MARKET TICKER (pure CSS scroll, no canvas dependency)
// ─────────────────────────────────────────────────────────────
const TICKERS = [
  { label: 'NIFTY 50', val: '+0.84%', up: true },
  { label: 'SENSEX',   val: '+0.76%', up: true },
  { label: 'LTV CAP',  val: '40%',    up: null },
  { label: 'PLEDGE',   val: 'SECURE', up: null },
  { label: 'APR',      val: '12%',    up: null },
  { label: 'GOLD',     val: '+0.22%', up: true },
  { label: 'DEBT',     val: '80% LTV',up: null },
]

// ─────────────────────────────────────────────────────────────
// SPLASH SCREEN
// Uses LiquidBlob + Framer Motion only — no canvas
// Safe on all devices and browsers
// ─────────────────────────────────────────────────────────────
export default function Splash({ onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 3000)
    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-void)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {/* Liquid blobs background */}
      <LiquidBlob size={400} color="var(--jade)" top="-120px" left="-100px" />
      <LiquidBlob size={300} color="var(--jade)" bottom="60px" right="-80px" delay={2} />
      <LiquidBlob size={200} color="#4DA8FF" top="40%" right="-60px" delay={4} />

      {/* Grid overlay — CSS only */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: `linear-gradient(rgba(0,212,161,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,161,0.03) 1px, transparent 1px)`,
        backgroundSize: '64px 64px',
      }} />

      {/* Scanning line */}
      <motion.div
        animate={{ y: ['0%', '100%'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
        style={{
          position: 'absolute', left: 0, right: 0, height: 80,
          background: 'linear-gradient(to bottom, transparent, rgba(0,212,161,0.04), transparent)',
          pointerEvents: 'none',
        }}
      />

      {/* Market ticker */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 28, overflow: 'hidden',
        borderBottom: '1px solid rgba(0,212,161,0.08)',
        background: 'rgba(5,8,9,0.7)',
        display: 'flex', alignItems: 'center',
      }}>
        <motion.div
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap' }}
        >
          {[...TICKERS, ...TICKERS, ...TICKERS, ...TICKERS].map((t, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 20px', borderRight: '1px solid rgba(0,212,161,0.06)' }}>
              <span style={{ fontSize: 9, color: 'rgba(122,143,133,0.7)', fontFamily: 'var(--font-mono)', letterSpacing: '1px' }}>{t.label}</span>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: t.up === true ? '#00D4A1' : t.up === false ? '#E05252' : 'rgba(232,240,236,0.5)' }}>{t.val}</span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Main content */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        style={{ position: 'relative', textAlign: 'center', zIndex: 10 }}
      >
        {/* Glow ring */}
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3], scale: [1, 1.1, 1] }}
          transition={{ duration: 3, repeat: Infinity }}
          style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -70%)',
            width: 130, height: 130, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,212,161,0.20) 0%, transparent 70%)',
            filter: 'blur(10px)', pointerEvents: 'none',
          }}
        />

        {/* Logo */}
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25, duration: 0.8 }}
          style={{ display: 'inline-block', marginBottom: 20, position: 'relative' }}>
          <LienzoLogoImage size={76} />
        </motion.div>

        {/* Wordmark */}
        <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.7 }}
          style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 300, letterSpacing: '-1px', marginBottom: 6, color: 'var(--text-primary)' }}>
          Lien<span style={{ color: 'var(--jade)', fontWeight: 500 }}>Pay</span>
        </motion.h1>

        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65, duration: 0.7 }}
          style={{ fontSize: 8, letterSpacing: '4.5px', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 36 }}>
          WEALTH-BACKED CREDIT
        </motion.p>

        {/* ── ALL 4 words highlighted ── */}
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.6 }}
          style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 40 }}>
          {['Pledge', 'Borrow', 'Repay', 'Repeat'].map((w, i) => (
            <motion.span key={w}
              initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.85 + i * 0.07 }}
              style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: 'var(--jade)',
                padding: '4px 10px',
                border: '1px solid rgba(0,212,161,0.35)',
                borderRadius: 4,
                letterSpacing: '0.5px',
                background: 'rgba(0,212,161,0.06)',
              }}>
              {w}
            </motion.span>
          ))}
        </motion.div>
      </motion.div>

      {/* Loading bar */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        style={{ position: 'absolute', bottom: 52, width: 100, height: 2, background: 'rgba(0,212,161,0.12)', borderRadius: 2, overflow: 'hidden' }}>
        <motion.div
          initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 2.6, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
          style={{ height: '100%', background: 'linear-gradient(90deg, var(--jade), var(--jade-bright))', borderRadius: 2 }}
        />
      </motion.div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.35 }} transition={{ delay: 1 }}
        style={{ position: 'absolute', bottom: 24, fontSize: 8, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '2px' }}>
        BY ARTHASTRA INNOVATIONS
      </motion.p>
    </div>
  )
}
