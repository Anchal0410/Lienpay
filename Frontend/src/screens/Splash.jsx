import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { LiquidBlob } from '../components/LiquidUI'
import { LienzoLogoImage } from '../components/Logo'

export default function Splash({ onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 2800)
    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-void)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      {/* Liquid blobs */}
      <LiquidBlob size={300} color="var(--jade)" top="-80px" left="-60px" />
      <LiquidBlob size={200} color="var(--jade)" bottom="100px" right="-40px" delay={2} />

      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        style={{ position: 'relative', textAlign: 'center' }}
      >
        {/* Logo mark */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
          style={{ display: 'inline-block', marginBottom: 24 }}
        >
          <LienzoLogoImage size={72} />
        </motion.div>

        {/* Wordmark */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          style={{
            fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 400,
            letterSpacing: '-0.5px',
          }}
        >
          Lien<span style={{ color: 'var(--jade)' }}>Pay</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          style={{
            fontSize: 9, letterSpacing: '4px', textTransform: 'uppercase',
            color: 'var(--text-muted)', marginTop: 8, fontFamily: 'var(--font-mono)', fontWeight: 500,
          }}
        >
          WEALTH-BACKED CREDIT
        </motion.p>
      </motion.div>

      {/* Loading bar */}
      <motion.div style={{
        position: 'absolute', bottom: 56,
        width: 80, height: 1, background: 'var(--bg-elevated)', borderRadius: 1, overflow: 'hidden',
      }}>
        <motion.div
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 2.4, ease: 'easeInOut' }}
          style={{ height: '100%', background: 'linear-gradient(90deg, var(--jade), var(--jade-bright))' }}
        />
      </motion.div>
    </div>
  )
}
