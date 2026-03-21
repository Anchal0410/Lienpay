import { motion } from 'framer-motion'
import useStore from '../store/useStore'
import { logout } from '../api/client'
import toast from 'react-hot-toast'

export default function Profile() {
  const { user, creditAccount, riskDecision, clearAuth, setOnboardingStep } = useStore()

  const handleLogout = async () => {
    try {
      await logout()
    } catch (_) {}
    clearAuth()
    setOnboardingStep('AUTH')
    toast.success('Logged out')
  }

  const items = [
    { icon: '📱', label: 'Mobile', value: user?.mobile ? `+91 ${user.mobile}` : '—' },
    { icon: '💳', label: 'UPI VPA', value: creditAccount?.upi_vpa || '—' },
    { icon: '🏦', label: 'PSP Bank', value: creditAccount?.psp_bank || '—' },
    { icon: '⚡', label: 'Risk Tier', value: riskDecision?.risk_tier ? `Tier ${riskDecision.risk_tier}` : '—' },
    { icon: '📊', label: 'APR', value: creditAccount?.apr ? `${creditAccount.apr}%` : '—' },
    { icon: '🛡️', label: 'Credit Limit', value: creditAccount?.credit_limit
        ? `₹${parseFloat(creditAccount.credit_limit).toLocaleString('en-IN')}`
        : '—' },
  ]

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 0' }}>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', marginBottom: 28,
            paddingTop: 8,
          }}
        >
          <div style={{
            width: 72, height: 72, borderRadius: 22,
            background: 'linear-gradient(135deg, var(--jade-dim), rgba(201,164,73,0.1))',
            border: '1px solid var(--border-jade)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, marginBottom: 12,
          }}>
            👤
          </div>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, fontWeight: 400, marginBottom: 4 }}>
            {user?.full_name || 'Account'}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            LienPay Member
          </p>
        </motion.div>

        {/* Account Details */}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: 10 }}>
          ACCOUNT DETAILS
        </p>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            overflow: 'hidden',
            marginBottom: 20,
          }}
        >
          {items.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '14px 18px',
                borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <span style={{ fontSize: 16, marginRight: 14, width: 24 }}>{item.icon}</span>
              <p style={{ flex: 1, fontSize: 14, color: 'var(--text-secondary)' }}>{item.label}</p>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{item.value}</p>
            </div>
          ))}
        </motion.div>

        {/* About LienPay */}
        <p style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: 10 }}>
          ABOUT
        </p>
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 18,
          overflow: 'hidden',
          marginBottom: 20,
        }}>
          {[
            { icon: '📄', label: 'Terms & Conditions' },
            { icon: '🔒', label: 'Privacy Policy' },
            { icon: '❓', label: 'Help & Support' },
            { icon: '🏛️', label: 'Grievance Officer' },
          ].map((item, i, arr) => (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center',
                padding: '14px 18px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: 16, marginRight: 14 }}>{item.icon}</span>
              <p style={{ flex: 1, fontSize: 14, color: 'var(--text-secondary)' }}>{item.label}</p>
              <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
            </div>
          ))}
        </div>

        {/* Compliance info */}
        <div style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 16,
          padding: '14px 18px',
          marginBottom: 20,
        }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Regulated Product
          </p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Credit line issued by our NBFC lending partner. LienPay is the technology platform (LSP).
            All mutual fund pledges managed via CAMS & KFintech.
            Regulated by RBI & SEBI.
          </p>
        </div>

        {/* Logout */}
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={handleLogout}
          style={{
            width: '100%', height: 52, borderRadius: 16,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            color: '#EF4444',
            fontSize: 15, fontWeight: 600,
            fontFamily: 'var(--font-sans)',
            marginBottom: 8,
          }}
        >
          Log Out
        </motion.button>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8 }}>
          LienPay v1.0 • Arthastra Innovations Pvt Ltd
        </p>
      </div>
    </div>
  )
}
