import { motion } from 'framer-motion'
import useStore from '../store/useStore'
import { logout } from '../api/client'
import toast from 'react-hot-toast'

const TIER_LABELS = {
  A: { label: 'Premium Member', color: 'var(--gold)', sub: 'Best rates, highest trust' },
  B: { label: 'Standard Member', color: 'var(--jade)', sub: 'Great rates, growing trust' },
  C: { label: 'New Member', color: 'var(--text-secondary)', sub: 'Building credit history' },
}

export default function Profile({ onSettings }) {
  const { user, creditAccount, riskDecision, clearAuth, setOnboardingStep } = useStore()

  const tier      = riskDecision?.risk_tier || 'B'
  const tierInfo  = TIER_LABELS[tier] || TIER_LABELS['B']

  const handleLogout = async () => {
    try { await logout() } catch (_) {}
    clearAuth()
    setOnboardingStep('AUTH')
    toast.success('Logged out')
  }

  const items = [
    { icon: '📱', label: 'Mobile',       value: user?.mobile ? `+91 ${user.mobile}` : '—' },
    { icon: '💳', label: 'UPI ID',       value: creditAccount?.upi_vpa || '—' },
    { icon: '🏦', label: 'PSP Bank',     value: creditAccount?.psp_bank || '—' },
    { icon: '💰', label: 'Credit Limit', value: creditAccount?.credit_limit ? `₹${parseFloat(creditAccount.credit_limit).toLocaleString('en-IN')}` : '—' },
    { icon: '📊', label: 'Interest Rate', value: creditAccount?.apr ? `${creditAccount.apr}% APR` : '—' },
  ]

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28, paddingTop: 8 }}>
          {/* Avatar */}
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
            style={{ width: 76, height: 76, borderRadius: 24, background: 'linear-gradient(135deg, var(--jade-dim), rgba(201,164,73,0.1))',
              border: '1.5px solid var(--border-jade)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 32, marginBottom: 14 }}>
            👤
          </motion.div>

          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, fontWeight: 400, marginBottom: 6 }}>
            {user?.full_name || user?.mobile ? `+91 ${user?.mobile}` : 'Account'}
          </h2>

          {/* Tier badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderRadius: 20,
            background: `${tierInfo.color}12`, border: `1px solid ${tierInfo.color}30` }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: tierInfo.color }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: tierInfo.color }}>{tierInfo.label}</span>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{tierInfo.sub}</p>
        </motion.div>

        {/* What is my tier? */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
            What is my member tier?
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Your tier is based on your credit bureau score and portfolio quality.
            Higher tiers get lower interest rates — Tier A (14.99%), Tier B (15.99%), Tier C (17.99%).
            Your tier improves automatically as you use and repay on time.
          </p>
        </motion.div>

        {/* Account details */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10 }}>ACCOUNT</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 20 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px',
              borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 16, marginRight: 14, width: 24 }}>{item.icon}</span>
              <p style={{ flex: 1, fontSize: 14, color: 'var(--text-secondary)' }}>{item.label}</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 160, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.value}
              </p>
            </div>
          ))}
        </motion.div>

        {/* Settings button */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={onSettings}
          style={{ width: '100%', height: 52, borderRadius: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-sans)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>⚙️</span>
          Settings & Legal
        </motion.button>

        {/* Logout */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={handleLogout}
          style={{ width: '100%', height: 52, borderRadius: 16, background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.18)', color: '#EF4444',
            fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)', marginBottom: 16 }}>
          Log Out
        </motion.button>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          LienPay v1.0 • Arthastra Innovations Pvt Ltd
        </p>

      </div>
    </div>
  )
}
