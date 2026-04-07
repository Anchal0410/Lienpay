import { useState, Component } from 'react'
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
        <div style={{ position: 'fixed', inset: 0, background: '#050809', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#E8F0EC', fontSize: 18, fontWeight: 600, marginBottom: 8, textAlign: 'center' }}>Something went wrong</h2>
          <p style={{ color: '#7A8F85', fontSize: 14, marginBottom: 28, textAlign: 'center', lineHeight: 1.5 }}>LienPay encountered an error. Tap below to reload.</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload() }}
            style={{ padding: '14px 32px', borderRadius: 14, background: 'linear-gradient(135deg, #00D4A1, #00A878)', color: '#000', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer' }}>
            Reload App
          </button>
          {process.env.NODE_ENV !== 'production' && (
            <p style={{ color: '#E05252', fontSize: 11, marginTop: 20, maxWidth: 340, textAlign: 'center', wordBreak: 'break-all' }}>{this.state.error?.message}</p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}

// ─────────────────────────────────────────────────────────────
// MARKET TICKER — persistent on all main app screens
// ─────────────────────────────────────────────────────────────
const TICKERS = [
  { label: 'NIFTY 50', val: '+0.84%', up: true },
  { label: 'SENSEX', val: '+0.76%', up: true },
  { label: 'LTV CAP', val: '40%', up: null },
  { label: 'PLEDGE', val: 'SECURE', up: null },
  { label: 'APR', val: '12%', up: null },
  { label: 'GOLD', val: '+0.22%', up: true },
  { label: 'DEBT LTV', val: '80%', up: null },
  { label: 'NIFTY BANK', val: '+0.61%', up: true },
  { label: 'MF PLEDGE', val: 'ACTIVE', up: null },
]

function MarketTicker() {
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 500,
      height: 26, overflow: 'hidden',
      borderBottom: '1px solid rgba(0,212,161,0.08)',
      background: 'rgba(5,8,9,0.96)',
      display: 'flex', alignItems: 'center',
    }}>
      <motion.div
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
        style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        {[...TICKERS, ...TICKERS, ...TICKERS, ...TICKERS].map((t, i) => (
          <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 18px', borderRight: '1px solid rgba(0,212,161,0.06)' }}>
            <span style={{ fontSize: 8, color: 'rgba(122,143,133,0.7)', fontFamily: 'monospace', letterSpacing: '0.8px' }}>{t.label}</span>
            <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: t.up === true ? '#00D4A1' : t.up === false ? '#E05252' : 'rgba(232,240,236,0.45)' }}>{t.val}</span>
          </div>
        ))}
      </motion.div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ONBOARDED STEP VALUES
// ─────────────────────────────────────────────────────────────
const ONBOARDED_STEPS = new Set(['ACTIVE', 'COMPLETE', 'CREDIT_ACTIVE', 'CREDIT_LINE_ACTIVE'])

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.2 } },
}

// Add 26px top padding to all main screens to clear the ticker
const TICKER_HEIGHT = 26

function AppContent() {
  const { token, onboardingStep, activeTab, setActiveTab } = useStore()
  const [showSplash, setShowSplash] = useState(true)
  const [showPay, setShowPay]       = useState(false)

  const isAuthenticated = !!token
  const isOnboarded     = ONBOARDED_STEPS.has(onboardingStep)

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
        containerStyle={{ top: TICKER_HEIGHT + 8 }}
        toastOptions={{
          style: { background: '#1A1A24', color: '#F0F0F5', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, fontSize: 14, fontFamily: 'Manrope, system-ui, sans-serif' },
          success: { iconTheme: { primary: '#00C896', secondary: '#000' } },
          error:   { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
        }}
      />

      {/* Splash */}
      <AnimatePresence>
        {showSplash && (
          <motion.div key="splash" exit={{ opacity: 0, scale: 1.05 }} transition={{ duration: 0.4 }} style={{ position: 'fixed', inset: 0, zIndex: 1000 }}>
            <Splash onComplete={() => setShowSplash(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Market ticker — shown on all non-splash screens */}
      {!showSplash && <MarketTicker />}

      {!showSplash && (
        // Add top padding to clear the ticker bar
        <div style={{ paddingTop: TICKER_HEIGHT, position: 'fixed', inset: 0 }}>
          <AnimatePresence mode="wait">
            {!isAuthenticated && (
              <motion.div key="auth" {...pageVariants} style={{ position: 'absolute', inset: 0, zIndex: 100 }}>
                <Auth />
              </motion.div>
            )}
            {isAuthenticated && !isOnboarded && (
              <motion.div key="onboarding" {...pageVariants} style={{ position: 'absolute', inset: 0, zIndex: 100 }}>
                <Onboarding onComplete={() => {}} />
              </motion.div>
            )}
            {isAuthenticated && isOnboarded && (
              <motion.div key="app" {...pageVariants} style={{ position: 'absolute', inset: 0 }}>
                <AnimatePresence mode="wait">
                  {renderActiveTab()}
                </AnimatePresence>
                {!showPay && <NavBar />}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Pay overlay */}
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
