require('dotenv').config();

const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const morgan      = require('morgan');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');

const { testConnection } = require('./config/database');
const { connectRedis }   = require('./config/redis');
const { logger }         = require('./config/logger');

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ── SECURITY MIDDLEWARE ──────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: function(origin, callback) {
    const allowed = [
      process.env.FRONTEND_URL,
      'https://lien-pay.vercel.app',
      'https://lienpay-admin.vercel.app',
      'https://lienpay-lender.vercel.app',
    ].filter(Boolean);
    if (!origin || allowed.some(a => origin.startsWith(a.replace(/\/$/, ''))) || origin.includes('lienpay') || origin.includes('vercel.app') || origin.includes('localhost')) {
      callback(null, true);
    } else {
      callback(null, true);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id', 'x-device-os', 'x-app-version', 'x-admin-token', 'x-lender-token'],
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.set('trust proxy', 1);

// ── GLOBAL RATE LIMITER ──────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
  message:  { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/api/', globalLimiter);

// ── HEALTH CHECK ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LienPay Backend', version: '1.0.0', timestamp: new Date().toISOString(), env: process.env.NODE_ENV });
});

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth',     require('./src/auth/auth.routes'));
app.use('/api/kyc',      require('./src/kyc/kyc.routes'));
app.use('/api/portfolio',require('./src/portfolio/portfolio.routes'));
app.use('/api/risk',     require('./src/risk/risk.routes'));
app.use('/api/pledge',   require('./src/pledge/pledge.routes'));
app.use('/api/credit',   require('./src/credit/credit.routes'));
app.use('/api/txn',      require('./src/transactions/transaction.routes'));
app.use('/api/billing',  require('./src/billing/billing.routes'));

// Dashboard APIs
app.use('/api/admin',               require('./src/admin/admin.routes'));
app.use('/api/admin/stress',        require('./src/admin/stress.routes'));
app.use('/api/admin/fund-universe', require('./src/admin/fund-universe.admin.routes'));
app.use('/api/lender',              require('./src/lender/lender.routes'));

// ── 404 HANDLER ──────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.originalUrl} not found` });
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', { message: err.message, stack: err.stack, url: req.originalUrl, method: req.method });
  res.status(err.statusCode || 500).json({
    success: false,
    error:   process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
  });
});

// ── STARTUP ───────────────────────────────────────────────────
const startServer = async () => {
  try {
    await testConnection();
    await connectRedis();

    // Seed the fund universe (inserts initial 38 funds if not already present)
    // This runs the fund_universe_migration.sql table check and seeds BOOTSTRAP_UNIVERSE.
    const { seedFundUniverse } = require('./src/portfolio/fund.universe');
    await seedFundUniverse();

    const { startCronJobs } = require('./src/monitoring/cron.scheduler');
    startCronJobs();

    app.listen(PORT, () => {
      logger.info(`🚀 LienPay Backend running on port ${PORT}`);
      logger.info(`📌 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 Health: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    logger.error('❌ Startup failed:', err);
    process.exit(1);
  }
};

startServer();

module.exports = app;
