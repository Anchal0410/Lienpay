import { motion } from 'framer-motion'
import useStore from '../store/useStore'
import { logout, getMe } from '../api/client'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

// Fix VPA display — the DB may still have old @lienpay values from before
// the Railway variable was corrected. Show the correct partner bank handle.
const fixVPA = (vpa) => {
  if (!vpa) return '—'
  // Replace @lienpay with @yesbank (correct PSP partner handle)
  return vpa.replace(/@lienpay$/, '@yesbank')
}

export default function Profile({ onSettings }) {
  const { user, creditAccount, clearAuth, setOnboardingStep } = useStore()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    const load = async () => {
      try { const res = await getMe(); setProfile(res.data) } catch(e) {}
    }
    load()
  }, [])

  const handleLogout = async () => {
    try { await logout() } catch (_) {}
    clearAuth()
    setOnboardingStep('AUTH')
    toast.success('Logged out')
  }

  const pspBank = creditAccount?.psp_bank || 'Yes Bank'
  const upiVpa  = fixVPA(creditAccount?.upi_vpa)

  const items = [
    {
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.8">
          <rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
      ),
      label: 'Mobile',
      value: user?.mobile ? `+91 ${user.mobile}` : '—',
    },
    {
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.8">
          <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
        </svg>
      ),
      label: 'UPI ID',
      value: upiVpa,
      mono: true,
    },
    {
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.8">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        </svg>
      ),
      label: 'PSP Bank',
      value: pspBank,
    },
    {
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.8">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
        </svg>
      ),
      label: 'Credit Limit',
      value: creditAccount?.credit_limit
        ? `₹${parseFloat(creditAccount.credit_limit).toLocaleString('en-IN')}`
        : '—',
    },
    {
      icon: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.8">
          <circle cx="12" cy="12" r="10"/>
          <polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      label: 'Monthly Rate',
      value: creditAccount?.apr
        ? `${(parseFloat(creditAccount.apr) / 12).toFixed(2)}% / month`
        : '—',
    },
  ]

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        {/* Avatar + name */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28, paddingTop: 8 }}>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
            style={{ width: 76, height: 76, borderRadius: 24, background: 'linear-gradient(135deg, var(--jade-dim), rgba(201,164,73,0.1))', border: '1.5px solid var(--border-jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontFamily: 'var(--font-display)', color: 'var(--jade)', marginBottom: 14 }}>
            {(profile?.full_name || user?.full_name || '')[0]?.toUpperCase() || '?'}
          </motion.div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400, marginBottom: 4 }}>
            {profile?.full_name || user?.full_name || 'User'}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {profile?.mobile ? `+91 ${profile.mobile}` : user?.mobile ? `+91 ${user.mobile}` : ''}
          </p>
        </motion.div>

        {/* Interest rate explainer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>How is my interest rate decided?</p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Your rate is personalised based on your credit history and the quality of your pledged mutual funds. Stronger portfolios with large-cap or debt funds unlock our best rates — starting at just 1.25%/month, less than half what credit cards charge. As you build repayment history, your rate can improve over time.
          </p>
        </motion.div>

        {/* Account details */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>ACCOUNT</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 20 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ marginRight: 14, width: 22, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{item.icon}</span>
              <p style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>{item.label}</p>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 170, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: item.mono ? 'var(--font-mono)' : 'inherit' }}>
                {item.value}
              </p>
            </div>
          ))}
        </motion.div>

        {/* Settings */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={onSettings}
          style={{ width: '100%', height: 52, borderRadius: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Settings &amp; Legal
        </motion.button>

        {/* Logout */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={handleLogout}
          style={{ width: '100%', height: 52, borderRadius: 16, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.18)', color: '#EF4444', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)', marginBottom: 16 }}>
          Log Out
        </motion.button>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 8 }}>
          LienPay v1.0 · Arthastra Innovations Pvt Ltd
        </p>

      </div>
    </div>
  )
}
