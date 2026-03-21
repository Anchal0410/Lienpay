import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const DOCS = {
  terms: {
    title: 'Terms & Conditions',
    content: `Last updated: March 2026

1. ACCEPTANCE OF TERMS
By using LienPay, you agree to these terms. LienPay is operated by Arthastra Innovations Pvt Ltd (CIN: U62099DL2025PTC456961), acting as a Lending Service Provider (LSP).

2. CREDIT LINE
Your credit line is issued by our NBFC lending partner, not by LienPay. LienPay facilitates the application and technology platform. The credit line is backed by your mutual fund holdings as collateral.

3. MUTUAL FUND PLEDGE
When you pledge mutual fund units, a lien is marked on those units via CAMS or KFintech. You retain ownership. Units are released when your outstanding balance is cleared.

4. PAYMENTS
All payments are processed via UPI (Unified Payments Interface) on NPCI rails. Transactions are subject to NPCI's terms and applicable RBI guidelines.

5. INTEREST & CHARGES
Interest is charged at your agreed APR on outstanding balances after the 30-day interest-free period. A minimum amount due (MAD) is payable each billing cycle.

6. MARGIN CALLS
If your portfolio value drops significantly, we may issue a margin call requiring you to add more collateral or repay outstanding balance within 3 business days.

7. DATA PRIVACY
We collect and process your data as per our Privacy Policy and the DPDP Act 2023. You may exercise your data rights by contacting grievance@lienpay.in.

8. GOVERNING LAW
These terms are governed by Indian law. Disputes are subject to the jurisdiction of courts in New Delhi.`,
  },
  privacy: {
    title: 'Privacy Policy',
    content: `Last updated: March 2026

1. DATA WE COLLECT
We collect your mobile number, PAN, Aadhaar details (last 4 digits only), date of birth, and mutual fund portfolio data (via Account Aggregator with your consent).

2. HOW WE USE YOUR DATA
Your data is used to: verify your identity (KYC), calculate your credit eligibility, facilitate payments, generate statements, and comply with RBI/SEBI regulations.

3. DATA SHARING
We share your data with: our NBFC lending partner (for credit sanction), CAMS/KFintech (for pledge management), credit bureaus (soft pull only), and regulatory bodies as required by law.

4. DATA RETENTION
We retain your data for 7 years post account closure as required by RBI guidelines.

5. YOUR RIGHTS (DPDP ACT 2023)
You have the right to: access your data, correct inaccurate data, and nominate a person to exercise data rights on your behalf. Contact: privacy@lienpay.in

6. COOKIES
Our web app uses local storage to maintain your session. No third-party tracking cookies are used.

7. SECURITY
Data is encrypted in transit (TLS) and sensitive fields (PAN) are encrypted at rest using AES-256.`,
  },
  help: {
    title: 'Help & Support',
    content: `FREQUENTLY ASKED QUESTIONS

Q: How is my credit limit calculated?
A: Your credit limit is based on the value of your pledged mutual funds, multiplied by the applicable LTV ratio (40% for equity, 80% for debt funds).

Q: What happens if markets fall?
A: If your portfolio value drops and the LTV ratio crosses 80%, you'll receive an amber alert. At 90%, a margin call is issued — you have 3 business days to add funds or repay.

Q: How do I make a payment?
A: Tap "Scan & Pay" on the home screen, allow camera access, and point at any UPI QR code. Or enter a UPI ID manually.

Q: When is interest charged?
A: You get 30 days interest-free from each payment date. After that, interest accrues at your APR on the outstanding amount for days used.

Q: How do I repay?
A: Go to Billing → tap your statement → choose Pay Minimum or Pay Full.

Q: How do I release my pledge?
A: Close your credit line (zero outstanding balance) and contact support. Pledges are released within 2 business days.

CONTACT SUPPORT
Email: support@lienpay.in
Hours: 9 AM – 6 PM, Monday to Saturday

ESCALATION
If your issue is unresolved within 7 days, escalate to our Grievance Officer.`,
  },
  grievance: {
    title: 'Grievance Officer',
    content: `GRIEVANCE REDRESSAL

As per RBI Digital Lending Guidelines 2022, we have appointed a Grievance Officer to handle complaints.

GRIEVANCE OFFICER DETAILS
Name: Grievance Officer, LienPay
Organization: Arthastra Innovations Pvt Ltd
Email: grievance@lienpay.in
Response Time: Within 30 days of complaint

HOW TO FILE A GRIEVANCE
1. Email grievance@lienpay.in with subject "Grievance: [Brief Description]"
2. Include your registered mobile number and transaction details
3. You will receive an acknowledgement within 24 hours

IF UNRESOLVED
If your complaint is not resolved within 30 days, you may escalate to:

RBI Ombudsman for Digital Transactions
cms.rbi.org.in

NBFC Ombudsman
(Contact details available on our NBFC partner's website)

We are committed to resolving all grievances fairly and promptly.`,
  },
}

export default function Settings() {
  const [openDoc, setOpenDoc] = useState(null)
  const [notifications, setNotifications] = useState({
    payments: true,
    alerts: true,
    statements: true,
    marketing: false,
  })

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>Settings</h1>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Preferences & information</p>
        </motion.div>

        {/* Notifications */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10 }}>NOTIFICATIONS</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 24 }}>
          {[
            { key: 'payments', label: 'Payment confirmations', sub: 'SMS & push for every payment' },
            { key: 'alerts',   label: 'LTV & margin alerts',  sub: 'Amber and red portfolio alerts' },
            { key: 'statements', label: 'Statement ready',    sub: 'Monthly billing notification' },
            { key: 'marketing', label: 'Offers & updates',    sub: 'Product news and promotions' },
          ].map((item, i, arr) => (
            <div key={item.key} onClick={() => setNotifications(prev => ({ ...prev, [item.key]: !prev[item.key] }))}
              style={{ display: 'flex', alignItems: 'center', padding: '16px 18px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>{item.label}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</p>
              </div>
              <motion.div animate={{ background: notifications[item.key] ? 'var(--jade)' : 'var(--bg-elevated)' }}
                style={{ width: 44, height: 24, borderRadius: 12, border: `1px solid ${notifications[item.key] ? 'var(--jade)' : 'var(--border)'}`,
                  display: 'flex', alignItems: 'center', padding: '0 3px', flexShrink: 0 }}>
                <motion.div animate={{ x: notifications[item.key] ? 20 : 0 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.3)' }} />
              </motion.div>
            </div>
          ))}
        </motion.div>

        {/* Legal documents */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10 }}>LEGAL & SUPPORT</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 24 }}>
          {[
            { key: 'terms',     icon: '📄', label: 'Terms & Conditions' },
            { key: 'privacy',   icon: '🔒', label: 'Privacy Policy' },
            { key: 'help',      icon: '❓', label: 'Help & Support' },
            { key: 'grievance', icon: '🏛️', label: 'Grievance Officer' },
          ].map((item, i, arr) => (
            <motion.div key={item.key} whileTap={{ background: 'var(--bg-elevated)' }}
              onClick={() => setOpenDoc(item.key)}
              style={{ display: 'flex', alignItems: 'center', padding: '16px 18px',
                borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none', cursor: 'pointer' }}>
              <span style={{ fontSize: 18, marginRight: 14, width: 26 }}>{item.icon}</span>
              <p style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{item.label}</p>
              <span style={{ color: 'var(--text-muted)', fontSize: 18 }}>›</span>
            </motion.div>
          ))}
        </motion.div>

        {/* App info */}
        <div style={{ textAlign: 'center', paddingBottom: 20 }}>
          <p style={{ fontSize: 22, marginBottom: 6 }}>
            Lien<span style={{ color: 'var(--jade)' }}>Pay</span>
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Version 1.0.0</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Arthastra Innovations Pvt Ltd</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>CIN: U62099DL2025PTC456961</p>
        </div>

      </div>

      {/* Document Modal */}
      <AnimatePresence>
        {openDoc && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 500, display: 'flex', alignItems: 'flex-end' }}
            onClick={() => setOpenDoc(null)}>
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 35 }}
              onClick={e => e.stopPropagation()}
              style={{ background: 'var(--bg-surface)', borderRadius: '24px 24px 0 0', padding: '20px', width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>{DOCS[openDoc]?.title}</h2>
                <button onClick={() => setOpenDoc(null)}
                  style={{ width: 32, height: 32, borderRadius: 10, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'var(--text-secondary)' }}>
                  ✕
                </button>
              </div>
              <div style={{ overflow: 'auto', flex: 1 }}>
                <pre style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-sans)' }}>
                  {DOCS[openDoc]?.content}
                </pre>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
