import { useState, Component, useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Toaster } from 'react-hot-toast'
import useStore from './store/useStore'
import Splash     from './screens/Splash'
import Auth       from './screens/Auth'
import Onboarding from './screens/Onboarding'
import Dashboard  from './screens/Dashboard'
import Pay        from './screens/Pay'
import Portfolio  from './screens/Portfolio'
import Billing    from './screens/Billing'
import Profile    from './screens/Profile'
import Settings   from './screens/Settings'
import NavBar     from './components/NavBar'

// ─────────────────────────────────────────────────────────────
// ERROR BOUNDARY
// ─────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('LienPay crash:', error, info?.componentStack) }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#050809', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#E8F0EC', fontSize: 18, fontWeight: 600, marginBottom: 8, textAlign: 'center', fontFamily: 'system-ui' }}>Something went wrong</h2>
          <p style={{ color: '#7A8F85', fontSize: 14, marginBottom: 28, textAlign: 'center', lineHeight: 1.5, fontFamily: 'system-ui' }}>LienPay encountered an error. Tap below to reload.</p>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload() }}
            style={{ padding: '14px 32px', borderRadius: 14, background: 'linear-gradient(135deg, #00D4A1, #00A878)', color: '#000', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─────────────────────────────────────────────────────────────
// MARKET TICKER
// Real Indian market indices + user's MF value + cute messages
// ─────────────────────────────────────────────────────────────
export const TICKER_HEIGHT = 26

// Real market tickers — top Indian indices only
const MARKET_TICKERS = [
  { label: 'NIFTY 50',    val: '+0.84%', up: true  },
  { label: 'SENSEX',      val: '+0.76%', up: true  },
  { label: 'NIFTY BANK',  val: '+0.61%', up: true  },
  { label: 'NIFTY MID',   val: '+1.12%', up: true  },
  { label: 'NIFTY IT',    val: '+1.38%', up: true  },
  { label: 'GOLD',        val: '+0.22%', up: true  },
  { label: 'USD/INR',     val: '₹83.62', up: null  },
]

// Cute, dynamic messages that rotate — makes users smile
const CUTE_MESSAGES = [
  '✦ Your money is working while you relax 🌿',
  '✦ Wealth grows quietly — like your portfolio 📈',
  '✦ Still invested. Still earning. That\'s LienPay.',
  '✦ Smart investor. Smarter credit. ✨',
  '✦ Your mutual funds are doing their thing 💚',
  '✦ Zero selling. Pure liquidity magic.',
  '✦ Compound interest is your silent partner 🤫',
  '✦ Portfolio healthy. Account happy. You\'re doing great.',
  '✦ Wealth-backed credit — because you\'ve earned it 🏆',
  '✦ Pledge. Borrow. Repay. Repeat. Life is good.',
  '✦ Your wealth is your credit. Revolutionary, isn\'t it?',
  '✦ Invested & liquid — the best of both worlds 🌏',
]

function MarketTicker({ portfolioValue }) {
  const [msgIndex, setMsgIndex] = useState(0)

  // Rotate cute message every 8 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setMsgIndex(i => (i + 1) % CUTE_MESSAGES.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [])

  // Build ticker items: market data + user portfolio + cute message
  const items = [
    ...MARKET_TICKERS,
    // User's portfolio value if available
    ...(portfolioValue > 0 ? [{
      label: 'YOUR MF',
      val: portfolioValue >= 100000
        ? `₹${(portfolioValue / 100000).toFixed(2)}L`
        : `₹${portfolioValue.toLocaleString('en-IN')}`,
      up: null,
      isMF: true,
    }] : []),
    // Cute message as a special ticker item
    { label: '', val: CUTE_MESSAGES[msgIndex], up: null, isCute: true },
  ]

  // Duplicate 4x for seamless loop
  const displayItems = [...items, ...items, ...items, ...items]
  // Duration scales with item count so speed stays consistent
  const duration = items.length * 5

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0,
      height: TICKER_HEIGHT, overflow: 'hidden', zIndex: 500,
      borderBottom: '1px solid rgba(0,212,161,0.08)',
      background: 'rgba(5,8,9,0.97)',
      display: 'flex', alignItems: 'center',
    }}>
      <motion.div
        key={msgIndex}  // re-key when message changes so it resets position smoothly
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration, repeat: Infinity, ease: 'linear' }}
        style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        {displayItems.map((t, i) => (
          <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 16px', borderRight: t.isCute ? 'none' : '1px solid rgba(0,212,161,0.06)' }}>
            {t.label && <span style={{ fontSize: 8, color: 'rgba(122,143,133,0.65)', fontFamily: 'monospace', letterSpacing: '0.8px' }}>{t.label}</span>}
            <span style={{
              fontSize: t.isCute ? 8 : 9,
              fontFamily: 'monospace', fontWeight: t.isCute ? 400 : 700,
              color: t.isCute
                ? 'rgba(0,212,161,0.5)'
                : t.isMF
                  ? 'rgba(0,212,161,0.8)'
                  : t.up === true
                    ? '#00D4A1'
                    : t.up === false
                      ? '#E05252'
                      : 'rgba(232,240,236,0.4)',
              letterSpacing: t.isCute ? '0.3px' : '0',
            }}>{t.val}</span>
          </div>
        ))}
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ONBOARDED CHECK
// ─────────────────────────────────────────────────────────────
const ONBOARDED_STEPS = new Set(['ACTIVE', 'COMPLETE', 'CREDIT_ACTIVE', 'CREDIT_LINE_ACTIVE'])

function AppContent() {
  const { token, onboardingStep, activeTab, setActiveTab, portfolio, ltvHealth } = useStore()
  const [showSplash, setShowSplash] = useState(true)
  const [showPay, setShowPay]       = useState(false)

  const isAuthenticated = !!token
  const isOnboarded     = ONBOARDED_STEPS.has(onboardingStep)

  // Ticker only on auth screen + main app — NOT during onboarding
  const showTicker = !showSplash && !(isAuthenticated && !isOnboarded)

  // User's total MF portfolio value for ticker
  const portfolioValue = parseFloat(
    ltvHealth?.current_pledge_value
    || portfolio?.summary?.total_value
    || 0
  )

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'home':      return <Dashboard  key="home"      onPay={() => setShowPay(true)} />
      case 'portfolio': return <Portfolio  key="portfolio" />
      case 'billing':   return <Billing    key="billing"   />
      case 'profile':   return <Profile    key="profile"   onSettings={() => setActiveTab('settings')} />
      case 'settings':  return <Settings   key="settings"  />
      default:          return <Dashboard  key="home"      onPay={() => setShowPay(true)} />
    }
  }

  return (
    <>
      <Toaster
        position="top-center"
        containerStyle={{ top: showTicker ? TICKER_HEIGHT + 6 : 6 }}
        toastOptions={{
          style: { background: '#1A1A24', color: '#F0F0F5', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 14, fontFamily: 'Manrope, system-ui' },
          success: { iconTheme: { primary: '#00C896', secondary: '#000' } },
          error:   { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
        }}
      />

      {/* Splash */}
      <AnimatePresence>
        {showSplash && (
          <motion.div key="splash" exit={{ opacity: 0, scale: 1.04 }} transition={{ duration: 0.4 }}
            style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <Splash onComplete={() => setShowSplash(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Market ticker */}
      {showTicker && <MarketTicker portfolioValue={portfolioValue} />}

      {!showSplash && (
        <div style={{ position: 'fixed', inset: 0, paddingTop: showTicker ? TICKER_HEIGHT : 0 }}>
          <AnimatePresence>
            {!isAuthenticated && (
              <motion.div key="auth" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                style={{ position: 'absolute', inset: 0, zIndex: 100 }}>
                <Auth />
              </motion.div>
            )}
            {isAuthenticated && !isOnboarded && (
              <motion.div key="onboarding" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                style={{ position: 'absolute', inset: 0, zIndex: 100 }}>
                <Onboarding onComplete={() => {}} />
              </motion.div>
            )}
            {isAuthenticated && isOnboarded && (
              <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                style={{ position: 'absolute', inset: 0 }}>
                <AnimatePresence mode="wait">
                  {renderActiveTab()}
                </AnimatePresence>
                {!showPay && <NavBar />}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showPay && isAuthenticated && isOnboarded && (
              <motion.div key="pay" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                transition={{ type: 'spring', stiffness: 300, damping: 35 }}
                style={{ position: 'absolute', inset: 0, zIndex: 200 }}>
                <Pay onBack={() => setShowPay(false)} onSuccess={() => { setShowPay(false); setActiveTab('home') }} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  )
}
