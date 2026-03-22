import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

/* Liquid morphing background blob */
export function LiquidBlob({ size = 300, color = 'var(--jade)', top, left, right, bottom, delay = 0 }) {
  return (
    <div style={{
      position: 'absolute', width: size, height: size, top, left, right, bottom,
      background: `radial-gradient(circle at 40% 40%, ${color}20, ${color}05)`,
      filter: `blur(${Math.round(size / 3)}px)`, pointerEvents: 'none',
      animation: `float1 ${8 + delay}s ease-in-out infinite, liquidMorph ${12 + delay}s ease-in-out infinite`,
      animationDelay: `${delay}s`,
    }} />
  )
}

/* Card that fades/scales in as user scrolls to it */
export function ScrollReveal({ children, scrollY, triggerAt = 0, style = {} }) {
  const progress = Math.max(0, Math.min(1, (scrollY - triggerAt + 200) / 200))
  return (
    <div style={{
      opacity: progress,
      transform: `translateY(${(1 - progress) * 24}px) scale(${0.96 + progress * 0.04})`,
      transition: 'transform 0.08s linear, opacity 0.08s linear',
      willChange: 'transform, opacity',
      ...style,
    }}>
      {children}
    </div>
  )
}

/* Hook to track scroll position */
export function useScrollY(ref) {
  const [y, setY] = useState(0)
  useEffect(() => {
    const el = ref?.current
    if (!el) return
    const handler = () => setY(el.scrollTop)
    el.addEventListener('scroll', handler, { passive: true })
    return () => el.removeEventListener('scroll', handler)
  }, [ref])
  return y
}

/* Credit ring gauge */
export function CreditRing({ limit, available, size = 190 }) {
  const used = limit - available
  const pct = limit > 0 ? (used / limit) * 100 : 0
  const r = (size - 20) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ

  return (
    <div style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      {/* Pulse ring */}
      <div style={{
        position: 'absolute', inset: -20, borderRadius: '50%',
        border: '1px solid var(--jade)', opacity: 0.08,
        animation: 'pulseRing 3s ease-out infinite',
      }} />
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth="5" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--jade)" strokeWidth="5"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{
            '--circ': circ, '--offset': offset,
            animation: 'ringDraw 2s ease-out forwards',
          }} />
        <circle cx={size / 2} cy={size / 2} r={r - 16} fill="none" stroke="var(--border)" strokeWidth="0.5" />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
          AVAILABLE
        </span>
        <span style={{ fontSize: 26, fontFamily: 'var(--font-display)', fontWeight: 400, marginTop: 4 }}>
          ₹{parseFloat(available || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
          of ₹{available >= 100000 ? `${(limit / 100000).toFixed(2)}L` : limit.toLocaleString('en-IN')}
        </span>
      </div>
    </div>
  )
}
