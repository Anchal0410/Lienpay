const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const crypto       = require('crypto');
const { testConnection } = require('./config/database');
const { connectRedis }   = require('./config/redis');
const { logger }         = require('./config/logger');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY HEADERS ─────────────────────────────────────────
// helmet sets: X-Content-Type-Options, X-Frame-Options, X-XSS-Protection,
// Strict-Transport-Security, Content-Security-Policy etc.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
    },
  },
  crossOriginEmbedderPolicy: false, // allow embedding in Vercel
}));

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = [
  'https://lien-pay.vercel.app',
  'https://lienpay-admin.vercel.app',
  'https://lienpay-lender.vercel.app',
  ...(process.env.EXTRA_ORIGINS ? process.env.EXTRA_ORIGINS.split(',') : []),
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3001', 'http://localhost:3002'] : []),
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (Railway health checks, mobile apps, Postman in dev)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    logger.warn(`CORS blocked: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:   [
    'Content-Type', 'Authorization', 'x-device-id', 'x-device-os',
    'x-app-version', 'x-admin-token', 'x-lender-token',
    'x-nbfc-api-key', 'x-webhook-secret', 'x-internal-key',
    'x-idempotency-key',
  ],
  credentials:      true,
  maxAge:           86400, // cache preflight for 24h
}));

// ── BODY PARSING ─────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ── TIMING-SAFE STATIC TOKEN MIDDLEWARE ──────────────────────
// Protects lender, admin, and NBFC dashboards from timing attacks.
// NEVER use === for secret comparison — timing attacks can brute-force it.
const timingSafeTokenMiddleware = (envVar, fallback) => (req, res, next) => {
  const header  = req.headers['x-admin-token']
    || req.headers['x-lender-token']
    || req.headers['x-nbfc-api-key'];

  const expected = process.env[envVar] || fallback;
  const provided = header || '';

  // Must be same length before compare — timingSafeEqual throws on length mismatch
  if (provided.length !== expected.length) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(provided,  'utf8'),
    Buffer.from(expected,  'utf8')
  );

  if (!match) {
    logger.warn(`Static token auth failure on ${req.path}`, { ip: req.ip });
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};

// ── NBFC WEBHOOK SIGNATURE VERIFICATION ──────────────────────
// Any incoming webhook from NBFC (settlement, status updates) must
// carry a valid HMAC-SHA256 signature in X-Webhook-Signature header.
// This prevents anyone from spoofing NBFC settlement webhooks.
const verifyNBFCWebhookSignature = (req, res, next) => {
  // Skip verification in mock mode (dev/testing)
  if (process.env.NBFC_MODE !== 'real') return next();

  const secret    = process.env.NBFC_WEBHOOK_SECRET;
  const signature = req.headers['x-webhook-signature'];

  if (!secret) {
    logger.warn('NBFC_WEBHOOK_SECRET not set — skipping verification');
    return next();
  }

  if (!signature) {
    return res.status(401).json({ success: false, error: 'Missing webhook signature' });
  }

  // Re-compute HMAC of raw body
  const rawBody  = JSON.stringify(req.body);
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const provided = signature.replace('sha256=', '');

  if (provided.length !== expected.length) {
    return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(provided,  'hex'),
    Buffer.from(expected,  'hex')
  );

  if (!match) {
    logger.warn('NBFC webhook signature mismatch', { ip: req.ip });
    return res.status(401).json({ success: false, error: 'Invalid webhook signature' });
  }

  next();
};

// ── GLOBAL RATE LIMITER ───────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs:    15 * 60 * 1000, // 15 minutes
  max:         100,
  message:     { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/api/', globalLimiter);

// Stricter limiter for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { success: false, error: 'Too many auth attempts. Please try again in 15 minutes.' },
});
app.use('/api/auth/', authLimiter);

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    service:   'LienPay Backend',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    env:       process.env.NODE_ENV,
  });
});

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',      require('./src/auth/auth.routes'));
app.use('/api/kyc',       require('./src/kyc/kyc.routes'));
app.use('/api/portfolio', require('./src/portfolio/portfolio.routes'));
app.use('/api/risk',      require('./src/risk/risk.routes'));
app.use('/api/pledge',    require('./src/pledge/pledge.routes'));
app.use('/api/credit',    require('./src/credit/credit.routes'));
app.use('/api/txn',       require('./src/transactions/transaction.routes'));
app.use('/api/billing',   require('./src/billing/billing.routes'));
app.use('/api/users',     require('./src/users/users.routes'));
app.use('/api/notifications', require('./src/notifications/notifications.routes'));

// ── NBFC SETTLEMENT WEBHOOK (signature-verified) ──────────────
// Called by NBFC when a UPI transaction settles on their side.
// Must be before the authenticated transaction routes.
app.post(
  '/api/txn/webhook/nbfc',
  verifyNBFCWebhookSignature,
  async (req, res) => {
    try {
      const { handleSettlementWebhook } = require('./src/transactions/transaction.service');
      const result = await handleSettlementWebhook(req.body);
      return res.json({ success: true, ...result });
    } catch (err) {
      logger.error('NBFC settlement webhook error:', err.message);
      return res.status(500).json({ success: false });
    }
  }
);

// ── DASHBOARD ROUTES (timing-safe token auth) ─────────────────
// Admin and lender dashboards use static tokens — always use
// timingSafeEqual, never ===.
app.use('/api/admin',        require('./src/admin/admin.routes'));
app.use('/api/admin/stress', require('./src/admin/stress.routes'));
app.use('/api/lender',       require('./src/lender/lender.routes'));

// NBFC programmatic API (machine-to-machine)
app.use('/api/nbfc',         require('./src/nbfc/nbfc.routes'));

// ── 404 HANDLER ──────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.originalUrl} not found` });
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack:   err.stack,
    url:     req.originalUrl,
    method:  req.method,
  });
  res.status(err.statusCode || 500).json({
    success: false,
    error:   process.env.NODE_ENV === 'production'
      ? 'An unexpected error occurred'
      : err.message,
  });
});

// ── STARTUP ───────────────────────────────────────────────────
const startServer = async () => {
  try {
    await testConnection();
    await connectRedis();

    const { startCronJobs } = require('./src/monitoring/cron.scheduler');
    startCronJobs();

    app.listen(PORT, () => {
      logger.info(`🚀 LienPay Backend running on port ${PORT}`);
      logger.info(`📌 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    logger.error('❌ Startup failed:', err);
    process.exit(1);
  }
};

startServer();
module.exports = app;
