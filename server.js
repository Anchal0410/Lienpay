require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const compression = require('compression');
const rateLimit  = require('express-rate-limit');

const { testConnection } = require('./config/database');
const { connectRedis }   = require('./config/redis');
const { logger }         = require('./config/logger');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── SECURITY MIDDLEWARE ──────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());

// ── REQUEST PARSING ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOGGING ───────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) }
}));

// ── GLOBAL RATE LIMITER ──────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message:  { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use('/api/', globalLimiter);

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

// ── API ROUTES (added as each System is built) ────────────────
// System 2: Authentication
app.use('/api/auth', require('./src/auth/auth.routes'));

// System 3: KYC
// app.use('/api/kyc',       require('./src/kyc/routes'));

// System 4: MF Portfolio
// app.use('/api/portfolio', require('./src/portfolio/routes'));

// System 5: Risk Engine
// app.use('/api/risk',      require('./src/risk/routes'));

// System 6: Pledge
// app.use('/api/pledge',    require('./src/pledge/routes'));

// System 7: Credit
// app.use('/api/credit',    require('./src/credit/routes'));

// System 8: Transactions
// app.use('/api/txn',       require('./src/transactions/routes'));

// System 9: Billing
// app.use('/api/billing',   require('./src/billing/routes'));

// System 10: NAV Monitor
// app.use('/api/nav',       require('./src/nav/routes'));

// ── 404 HANDLER ──────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error:   `Route ${req.originalUrl} not found`,
  });
});

// ── GLOBAL ERROR HANDLER ─────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack:   err.stack,
    url:     req.originalUrl,
    method:  req.method,
  });

  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
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

    app.listen(PORT, () => {
      logger.info(`🚀 LienPay Backend running on port ${PORT}`);
      logger.info(`📌 Environment: ${process.env.NODE_ENV}`);
      logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
    });
  } catch (err) {
    logger.error('❌ Startup failed:', err);
    process.exit(1);
  }
};

startServer();

module.exports = app; // for testing
