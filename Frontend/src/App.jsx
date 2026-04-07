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
// Catches any React render crash and shows a recovery screen
// instead of a black screen. Critical for production.
// ─────────────────────────────────────────────────────────────
class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    // Log to console so developer can see it
    console.error('LienPay crashed:', error, info?.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0,
          background: '#050809',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '24px',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ color: '#E8F0EC', fontSize: 18, fontWeight: 600, marginBottom: 8, textAlign: 'center' }}>
            Something went wrong
          </h2>
          <p style={{ color: '#7A8F85', fontSize: 14, marginBottom: 28, textAlign: 'center', lineHeight: 1.5 }}>
            LienPay encountered an error. Tap below to reload.
          </p>
          <button
            onClick={() => {
              // Clear any potentially corrupted state and reload
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            style={{
              padding: '14px 32px', borderRadius: 14,
              background: 'linear-gradient(135deg, #00D4A1, #00A878)',
              color: '#000', fontSize: 15, fontWeight: 700,
              border: 'none', cursor: 'pointer',
            }}
          >
            Reload App
          </button>
          {/* Show error in dev only */}
          {process.env.NODE_ENV !== 'production' && (
            <p style={{ color: '#E05252', fontSize: 11, marginTop: 20, maxWidth: 340, textAlign: 'center', wordBreak: 'break-all' }}>
              {this.state.error?.message}
            </p>
          )}
        </div>
      )
    }
    return this.props.children
  }
}

// ─────────────────────────────────────────────────────────────
// Determine if a user has completed onboarding.
// Backend onboarding_step values after activation:
//   'COMPLETE' (set by credit.service after activateCreditLine)
//   'CREDIT_ACTIVE' (set in some flows)
// We also accept 'ACTIVE' which we set from the frontend.
// ─────────────────────────────────────────────────────────────
const ONBOARDED_STEPS = new Set([
  'ACTIVE',
  'COMPLETE',
  'CREDIT_ACTIVE',
  'CREDIT_LINE_ACTIVE',
])

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.2 } },
}

function AppContent() {
  const { token, onboardingStep, activeTab, setActiveTab } = useStore()
  const [showSplash, setShowSplash] = useState(true)
  const [showPay, setShowPay]       = useState(false)

  const isAuthenticated = !!token
  // ── FIX: expanded check — handles all backend step values ──
  const isOnboarded = ONBOARDED_STEPS.has(onboardingStep)

  const handleSplashComplete  = () => setShowSplash(false)
  const handleOnboardComplete = () => {}

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
        toastOptions={{
          style: {
            background:  '#1A1A24',
            color:       '#F0F0F5',
            border:      '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            fontSize:    14,
            fontFamily:  'Manrope, system-ui, sans-serif',
          },
          success: { iconTheme: { primary: '#00C896', secondary: '#000' } },
          error:   { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
        }}
      />

      {/* Splash */}
      <AnimatePresence>
        {showSplash && (
          <motion.div
            key="splash"
            exit={{ opacity: 0, scale: 1.05 }}
            transition={{ duration: 0.4 }}
            style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
          >
            <Splash onComplete={handleSplashComplete} />
          </motion.div>
        )}
      </AnimatePresence>

      {!showSplash && (
        <AnimatePresence mode="wait">
          {/* Not authenticated */}
          {!isAuthenticated && (
            <motion.div key="auth" {...pageVariants} style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
              <Auth />
            </motion.div>
          )}

          {/* Authenticated but not onboarded */}
          {isAuthenticated && !isOnboarded && (
            <motion.div key="onboarding" {...pageVariants} style={{ position: 'fixed', inset: 0, zIndex: 100 }}>
              <Onboarding onComplete={handleOnboardComplete} />
            </motion.div>
          )}

          {/* Fully onboarded — main app */}
          {isAuthenticated && isOnboarded && (
            <motion.div key="app" {...pageVariants} style={{ position: 'fixed', inset: 0 }}>
              <AnimatePresence mode="wait">
                {renderActiveTab()}
              </AnimatePresence>
              {!showPay && <NavBar />}
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Pay overlay */}
      <AnimatePresence>
        {showPay && isAuthenticated && isOnboarded && (
          <motion.div
            key="pay"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            style={{ position: 'fixed', inset: 0, zIndex: 200 }}
          >
            <Pay
              onBack={() => setShowPay(false)}
              onSuccess={() => { setShowPay(false); setActiveTab('home') }}
            />
          </motion.div>
        )}
      </AnimatePresence>
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
