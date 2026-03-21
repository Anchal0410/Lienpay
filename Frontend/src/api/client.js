import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'https://lienpay-production.up.railway.app'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// ── REQUEST INTERCEPTOR ────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('lp_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ── RESPONSE INTERCEPTOR ───────────────────────
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.error || error.message || 'Something went wrong'
    if (error.response?.status === 401) {
      localStorage.removeItem('lp_token')
      localStorage.removeItem('lp_user')
      window.location.href = '/auth'
    }
    return Promise.reject(new Error(message))
  }
)

// ── AUTH ───────────────────────────────────────
export const sendOTP   = (mobile)        => api.post('/api/auth/send-otp', { mobile })
export const verifyOTP = (mobile, otp)   => api.post('/api/auth/verify-otp', { mobile, otp })
export const logout    = ()              => api.post('/api/auth/logout')

// ── KYC ───────────────────────────────────────
export const submitKYCProfile   = (data)        => api.post('/api/kyc/profile', data)
export const sendAadhaarOTP     = (data)        => api.post('/api/kyc/aadhaar/send-otp', data)
export const verifyAadhaarOTP   = (data)        => api.post('/api/kyc/aadhaar/verify-otp', data)
export const submitCKYC         = ()            => api.post('/api/kyc/ckyc', {})
export const submitBureau       = ()            => api.post('/api/kyc/bureau', { consent_given: true })

// ── PORTFOLIO ─────────────────────────────────
export const initiateAAConsent  = ()            => api.post('/api/portfolio/aa/consent', {})
export const fetchPortfolio     = (consent_id)  => api.post('/api/portfolio/fetch', { consent_id })
export const getPortfolioSummary= ()            => api.get('/api/portfolio/summary')

// ── RISK ──────────────────────────────────────
export const evaluateRisk       = ()            => api.post('/api/risk/evaluate', {})
export const getRiskDecision    = ()            => api.get('/api/risk/decision')
export const getLTVHealth       = ()            => api.get('/api/risk/ltv-health')

// ── PLEDGE ────────────────────────────────────
export const validatePledge     = (folios)      => api.post('/api/pledge/validate', { selected_folios: folios })
export const initiatePledge     = (folios)      => api.post('/api/pledge/initiate', { selected_folios: folios })
export const confirmPledgeOTP   = (pledge_id, otp) => api.post('/api/pledge/confirm-otp', { pledge_id, otp })
export const notifyNBFC         = (pledge_ids)  => api.post('/api/pledge/notify-nbfc', { pledge_ids })
export const getPledgeStatus    = ()            => api.get('/api/pledge/status')

// ── CREDIT ────────────────────────────────────
export const requestSanction    = ()            => api.post('/api/credit/sanction', {})
export const getKFS             = (params)      => api.get('/api/credit/kfs', { params })
export const acceptKFS          = (data)        => api.post('/api/credit/kfs/accept', data)
export const activateCredit     = ()            => api.post('/api/credit/activate', {})
export const getCreditStatus    = ()            => api.get('/api/credit/status')
export const setupPIN           = ()            => api.post('/api/txn/pin/setup', {})

// ── TRANSACTIONS ──────────────────────────────
export const initiatePayment    = (data)        => api.post('/api/txn/initiate', data)
export const mockSettle         = (txn_id)      => api.post('/api/txn/mock-settle', { txn_id })
export const getTxnHistory      = (params)      => api.get('/api/txn/history', { params })
export const decodeQR           = (qr_string)   => api.post('/api/txn/decode-qr', { qr_string })

// ── BILLING ───────────────────────────────────
export const getStatements      = ()            => api.get('/api/billing/statements')
export const getStatement       = (id)          => api.get(`/api/billing/statements/${id}`)
export const mockRepay          = (amount)      => api.post('/api/billing/repay/mock', { amount })

export default api
