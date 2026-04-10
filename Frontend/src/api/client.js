// ─────────────────────────────────────────────────────────────
// LIENPAY API CLIENT
// All backend calls go through here.
// Base URL switches between prod (Railway) and local dev.
// Auth token read from localStorage on every call.
// ─────────────────────────────────────────────────────────────

const BASE = import.meta.env.VITE_API_URL
  || 'https://lienpay-production.up.railway.app';

// ── CORE REQUEST WRAPPER ──────────────────────────────────────
const request = async (method, path, body) => {
  const token = localStorage.getItem('lp_token');

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // Device fingerprint for fraud scoring
  const deviceId = localStorage.getItem('lp_device_id');
  if (deviceId) headers['x-device-id'] = deviceId;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  // Handle 401 globally — token expired or invalidated
  if (res.status === 401) {
    localStorage.removeItem('lp_token');
    localStorage.removeItem('lp_user');
    window.location.href = '/';
    throw new Error('Session expired. Please login again.');
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const get  = (path)        => request('GET',  path);
const post = (path, body)  => request('POST', path, body);

// ── AUTH ──────────────────────────────────────────────────────
export const sendOTP     = (mobile)          => post('/api/auth/send-otp',    { mobile });
export const verifyOTP   = (mobile, otp)     => post('/api/auth/verify-otp',  { mobile, otp });
export const logout      = ()                => post('/api/auth/logout',      {});
export const getMe       = ()                => get('/api/auth/me');

// ── KYC ───────────────────────────────────────────────────────
export const submitKYCProfile  = (data)       => post('/api/kyc/profile',             data);
export const sendAadhaarOTP    = (data)       => post('/api/kyc/aadhaar/send-otp',    data);
export const verifyAadhaarOTP  = (data)       => post('/api/kyc/aadhaar/verify-otp',  data);
export const submitCKYC        = ()           => post('/api/kyc/ckyc',                {});
// Bureau endpoint kept for API compatibility — returns KYC complete for LAMF
export const submitBureau      = ()           => post('/api/kyc/bureau',              { consent_given: true });

// ── PORTFOLIO ─────────────────────────────────────────────────
export const initiateAAConsent  = ()              => post('/api/portfolio/aa/consent', {});
export const fetchPortfolio     = (consent_id)    => post('/api/portfolio/fetch',      { consent_id });
export const getPortfolioSummary= ()              => get('/api/portfolio/summary');

// ── RISK ──────────────────────────────────────────────────────
export const evaluateRisk    = ()  => post('/api/risk/evaluate', {});
export const getRiskDecision = ()  => get('/api/risk/decision');
export const getLTVHealth    = ()  => get('/api/risk/ltv-health');

// ── PLEDGE ────────────────────────────────────────────────────
export const validatePledge   = (folios)          => post('/api/pledge/validate',     { selected_folios: folios });
export const initiatePledge   = (folios)          => post('/api/pledge/initiate',     { selected_folios: folios });
export const confirmPledgeOTP = (pledge_id, otp)  => post('/api/pledge/confirm-otp', { pledge_id, otp });
export const notifyNBFC       = (pledge_ids)      => post('/api/pledge/notify-nbfc', { pledge_ids });
export const getPledgeStatus  = ()               => get('/api/pledge/status');

// ── APR PRODUCT CHOICE ────────────────────────────────────────
// Called from APRChoiceStep during onboarding (before credit activation)
export const setAprProduct = (apr_product) => post('/api/users/apr-product', { apr_product });

// ── CREDIT ────────────────────────────────────────────────────
export const requestSanction = ()     => post('/api/credit/sanction',   {});
export const getKFS = (p)            => get(
  `/api/credit/kfs?sanction_id=${p.sanction_id}&approved_limit=${p.approved_limit}&apr=${p.apr}`
);
export const acceptKFS      = (data) => post('/api/credit/kfs/accept',  data);
export const activateCredit = ()     => post('/api/credit/activate',    {});
export const getCreditStatus= ()     => get('/api/credit/status');
export const setupPIN       = ()     => post('/api/txn/pin/setup',      {});

// ── TRANSACTIONS ──────────────────────────────────────────────
export const initiatePayment = (data)   => post('/api/txn/initiate',    data);
export const getTxnHistory   = (params) => get(
  `/api/txn/history?limit=${params?.limit || 20}&offset=${params?.offset || 0}`
);
export const decodeQR = (qr)           => post('/api/txn/decode-qr',   { qr_string: qr });

// Mock settle — dev only. Backend returns 403 in production.
export const mockSettle = (txn_id) => post('/api/txn/mock-settle', { txn_id });

// ── BILLING ───────────────────────────────────────────────────
export const getStatements  = ()       => get('/api/billing/statements');
export const getStatement   = (id)     => get(`/api/billing/statements/${id}`);
export const initiateRepay  = (amount) => post('/api/billing/repay/initiate', { amount });
export const mockRepay      = (amount) => post('/api/billing/repay/mock',     { amount });
export const getRepayments  = ()       => get('/api/billing/repayments');

// ── NOTIFICATIONS ─────────────────────────────────────────────
export const getNotifications   = ()   => get('/api/notifications');
export const markNotifRead      = (id) => post(`/api/notifications/${id}/read`, {});

// ── USER PROFILE ──────────────────────────────────────────────
export const getUserProfile = () => get('/api/users/profile');

export default { get, post };
