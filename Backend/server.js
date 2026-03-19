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
app.set('trust proxy', 1); // Required for Railway deployment
const PORT = process.env.PORT || 3000;

// ── SECURITY MIDDLEWARE ──────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-device-id', 'x-device-os', 'x-app-version'],
}));
app.use(compression());

// ── REQUEST PARSING ──────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOGGING ───────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) }
}));

// ── TRUST PROXY (required for Railway / any reverse proxy) ───
app.set('trust proxy', 1);

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

// ── API ROUTES ────────────────────────────────────────────────
app.use('/api/auth', require('./src/auth/auth.routes'));
app.use('/api/kyc',       require('./src/kyc/kyc.routes'));
app.use('/api/portfolio', require('./src/portfolio/portfolio.routes'));
app.use('/api/risk',      require('./src/risk/risk.routes'));

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
    // 1. Connect to database
    await testConnection();

    // 2. Connect to Redis
    await connectRedis();

    // 4. Start server
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
