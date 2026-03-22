import { useEffect, useState, useRef } from 'react'
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion'
import { getCreditStatus, getLTVHealth, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import { CreditRing, LiquidBlob, ScrollReveal, useScrollY } from '../components/LiquidUI'
import { LienzoLogoImage } from '../components/Logo'
import toast from 'react-hot-toast'

const fmt = (n) => parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })
const fmtL = (n) => { const v = parseFloat(n||0); return v >= 100000 ? `${(v/100000).toFixed(2)}L` : fmt(v) }

const getGreeting = () => {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return 'Good morning'
  if (h >= 12 && h < 17) return 'Good afternoon'
  if (h >= 17 && h < 21) return 'Good evening'
  return 'Good night'
}

export default function Dashboard({ onPay }) {
  const { creditAccount, setCreditAccount, ltvHealth, setLTVHealth,
          setTransactions, transactions, riskDecision, activeTab, setActiveTab } = useStore()
  const [loading, setLoading] = useState(!creditAccount)
  const scrollRef = useRef(null)
  const scrollY = useScrollY(scrollRef)

  useEffect(() => {
    const load = async () => {
      try {
        const [creditRes, ltvRes, txnRes] = await Promise.all([
          getCreditStatus(), getLTVHealth(), getTxnHistory({ limit: 5 }),
        ])
        setCreditAccount(creditRes.data)
        setLTVHealth(ltvRes.data)
        setTransactions(txnRes.data?.transactions || [])
      } catch (err) { /* silent */ }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const account = creditAccount
  const available = parseFloat(account?.available_credit || 0)
  const creditLimit = parseFloat(account?.credit_limit || 0)
  const outstanding = parseFloat(account?.outstanding || 0)
  const ltv = ltvHealth
  const ltvRatio = ltv?.ltv_ratio || 0
  const ltvColor = ltv?.status === 'RED' ? 'var(--red)' : ltv?.status === 'AMBER' ? 'var(--amber)' : 'var(--jade)'

  // Scroll-driven transforms
  const ringScale = Math.max(0.88, 1 - scrollY / 500)
  const ringOpacity = Math.max(0.4, 1 - scrollY / 350)
  const headerY = Math.min(0, -scrollY * 0.12)

  if (loading) return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-void)' }}>
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        style={{ width: 36, height: 36, border: '2px solid var(--bg-elevated)', borderTopColor: 'var(--jade)', borderRadius: '50%' }} />
    </div>
  )

  return (
    <div ref={scrollRef} className="screen">
      {/* Liquid blobs — parallax with scroll */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <LiquidBlob size={320} color="var(--jade)" top={`${-100 - scrollY * 0.2}px`} right="-80px" />
        <LiquidBlob size={200} color="var(--jade)" top={`${400 - scrollY * 0.1}px`} left="-60px" delay={3} />
        <LiquidBlob size={160} color="#4DA8FF" top={`${700 - scrollY * 0.15}px`} right="-30px" delay={5} />
      </div>

      <div style={{ position: 'relative', zIndex: 1, padding: '0 22px' }}>
        {/* Header — parallax shift */}
        <div style={{ paddingTop: 20, paddingBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', transform: `translateY(${headerY}px)` }}>
          <div>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '3px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>LIENPAY</p>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, marginTop: 4, letterSpacing: '-0.5px' }}>{getGreeting()}</h1>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => setActiveTab('settings')} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
            </button>
          </div>
        </div>

        {/* Credit Ring — scales on scroll */}
        <div style={{ transform: `scale(${ringScale})`, opacity: ringOpacity, transformOrigin: 'center top', marginBottom: 8, transition: 'transform 0.05s linear, opacity 0.05s linear' }}>
          <CreditRing limit={creditLimit} available={available} />
        </div>

        {/* CLOU badge */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--jade)', animation: 'breathe 3s ease-in-out infinite' }} />
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--jade)', letterSpacing: '1.5px' }}>CLOU ACTIVE</span>
          </div>
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Closed credit line · Only inside LienPay</p>
        </div>

        {/* Stats */}
        <ScrollReveal scrollY={scrollY} triggerAt={0}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
            {[
              { l: 'OUTSTANDING', v: `₹${fmtL(outstanding)}`, c: outstanding > 0 ? 'var(--amber)' : 'var(--text-secondary)' },
              { l: 'LTV RATIO', v: `${ltvRatio.toFixed(1)}%`, c: ltvColor },
              { l: 'APR', v: `${account?.apr || '15.99'}%`, c: 'var(--text-secondary)' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 12px', textAlign: 'center' }}>
                <p style={{ fontSize: 8, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 6 }}>{s.l}</p>
                <p style={{ fontSize: 16, fontWeight: 600, color: s.c, fontFamily: 'var(--font-mono)' }}>{s.v}</p>
              </div>
            ))}
          </div>
        </ScrollReveal>

        {/* LTV health bar */}
        <AnimatePresence>
          {ltv && ltv.status !== 'GREEN' && (
            <ScrollReveal scrollY={scrollY} triggerAt={60}>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ background: ltv.status === 'RED' ? 'var(--red-dim)' : 'var(--amber-dim)',
                  border: `1px solid ${ltv.status === 'RED' ? 'rgba(224,82,82,0.25)' : 'rgba(224,160,48,0.25)'}`,
                  borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: ltv.status === 'RED' ? 'var(--red)' : 'var(--amber)', marginBottom: 4 }}>
                  {ltv.status === 'RED' ? '⚠️ Margin Call' : '⚡ Alert'}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{ltv.message}</p>
              </motion.div>
            </ScrollReveal>
          )}
        </AnimatePresence>

        {/* Pay CTA */}
        <ScrollReveal scrollY={scrollY} triggerAt={120}>
          <motion.button
            whileHover={{ scale: 1.02, boxShadow: '0 16px 48px rgba(0,212,161,0.35)' }}
            whileTap={{ scale: 0.96 }}
            onClick={onPay}
            style={{
              width: '100%', height: 62, borderRadius: 16, position: 'relative', overflow: 'hidden',
              background: 'linear-gradient(135deg, var(--jade) 0%, #00A878 60%, #007A58 100%)',
              color: 'var(--bg-void)', fontSize: 16, fontWeight: 700, letterSpacing: '-0.3px',
              boxShadow: '0 12px 40px rgba(0,212,161,0.2)', marginBottom: 28,
            }}>
            <motion.div animate={{ x: ['-120%', '220%'] }} transition={{ duration: 2.5, repeat: Infinity, repeatDelay: 1.5, ease: 'linear' }}
              style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)', transform: 'skewX(-20deg)' }} />
            <span style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              Scan & Pay
            </span>
          </motion.button>
        </ScrollReveal>

        {/* 30-day explainer */}
        <ScrollReveal scrollY={scrollY} triggerAt={180}>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 16, padding: '16px 18px', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--jade)', fontWeight: 700 }}>0%</span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600 }}>30 days interest-free on every payment</span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              After that, just {((parseFloat(account?.apr || 15.99)) / 12).toFixed(2)}%/month. Credit cards charge 3%+.
            </p>
          </div>
        </ScrollReveal>

        {/* Transactions */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.3px' }}>Recent</h2>
            <button style={{ fontSize: 10, color: 'var(--jade)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>View all</button>
          </div>

          {transactions.length === 0 ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '36px 20px', textAlign: 'center' }}>
              <p style={{ fontSize: 40, marginBottom: 10 }}>💳</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600 }}>No payments yet</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>Scan any UPI QR to pay</p>
            </motion.div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {transactions.map((txn, i) => (
                <ScrollReveal key={txn.txn_id} scrollY={scrollY} triggerAt={250 + i * 50}>
                  <motion.div
                    initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 16, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 14, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                        🏪
                      </div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{txn.merchant_name || txn.merchant_vpa}</p>
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {new Date(txn.initiated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          {txn.is_in_free_period && <span style={{ color: 'var(--jade)', marginLeft: 6, fontWeight: 700 }}>· Free</span>}
                        </p>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <p style={{ fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>−₹{fmt(txn.amount)}</p>
                      <p style={{ fontSize: 9, color: txn.status === 'SETTLED' ? 'var(--jade)' : 'var(--text-muted)', letterSpacing: '0.5px', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                        {txn.status}
                      </p>
                    </div>
                  </motion.div>
                </ScrollReveal>
              ))}
            </div>
          )}
        </div>

        {/* Portfolio health peek */}
        <ScrollReveal scrollY={scrollY} triggerAt={500}>
          <div style={{ background: 'linear-gradient(135deg, var(--jade-glow), transparent)', border: '1px solid var(--jade-border)', borderRadius: 18, padding: '18px', marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>PORTFOLIO</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: ltvColor }} />
                <span style={{ fontSize: 10, color: ltvColor, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{ltv?.status || 'GREEN'}</span>
              </div>
            </div>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400 }}>
              ₹{fmtL(ltv?.current_pledge_value || 0)}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Pledged portfolio value</p>
          </div>
        </ScrollReveal>
      </div>
    </div>
  )
}
