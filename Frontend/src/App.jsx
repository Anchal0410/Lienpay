import { useState, useEffect } from 'react'
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

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.2 } },
}

export default function App() {
  const { token, onboardingStep, activeTab, setActiveTab } = useStore()
  const [showSplash, setShowSplash] = useState(true)
  const [showPay, setShowPay]       = useState(false)

  // Determine which screen to show
  const isAuthenticated = !!token
  const isOnboarded     = onboardingStep === 'ACTIVE' || onboardingStep === 'COMPLETE'

  const handleSplashComplete = () => setShowSplash(false)
  const handleAuthComplete   = () => {}
  const handleOnboardComplete = () => {}

  // Active screen content
  const renderActiveTab = () => {
    switch (activeTab) {
      case 'home':      return <Dashboard key="home"      onPay={() => setShowPay(true)} />
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
            fontFamily:  'Outfit, sans-serif',
          },
          success: { iconTheme: { primary: '#00C896', secondary: '#000' } },
          error:   { iconTheme: { primary: '#EF4444', secondary: '#fff' } },
        }}
      />

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
              {/* Tab content */}
              <AnimatePresence mode="wait">
                {renderActiveTab()}
              </AnimatePresence>

              {/* Bottom nav */}
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
              onSuccess={() => {
                setShowPay(false)
                setActiveTab('home')
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
