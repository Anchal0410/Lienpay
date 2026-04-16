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

// ── CORS ─────────────────────────────────────────────────────
// Allows:
//   - Any *.vercel.app URL (covers all preview + production deployments)
//   - localhost (dev)
//   - Any value set in FRONTEND_URL env var
app.use(cors({
  origin: function (origin, callback) {
    // No origin = Postman / server-to-server / curl — always allow
    if (!origin) return callback(null, true);

    const allowed =
      origin.endsWith('.vercel.app') ||           // any Vercel deployment
      origin.includes('localhost') ||              // local dev
      origin.includes('127.0.0.1') ||             // local dev
      origin === (process.env.FRONTEND_URL || ''); // explicit env override

    if (allowed) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization',
    'x-device-id', 'x-device-os', 'x-app-version',
    'x-admin-token', 'x-lender-token', 'x-internal-key',
  ],
}));

app.use(compression());

// ── REQUEST PARSING ───────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── LOGGING ───────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ── GLOBAL RATE LIMITER ───────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max:      parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500,
  message:  { success: false, error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders:   false,
});
app.use(globalLimiter);
app.use(helmet());

// ── HEALTH CHECK ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'lienpay-backend', version: '1.0.0' });
});

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/auth',        require('./src/auth/auth.routes'));
app.use('/api/kyc',         require('./src/kyc/kyc.routes'));
app.use('/api/portfolio',   require('./src/portfolio/portfolio.routes'));
app.use('/api/risk',        require('./src/risk/risk.routes'));
app.use('/api/pledge',      require('./src/pledge/pledge.routes'));
app.use('/api/credit',      require('./src/credit/credit.routes'));
app.use('/api/transactions',require('./src/transactions/transaction.routes'));
app.use('/api/billing',     require('./src/billing/billing.routes'));
app.use('/api/admin',       require('./src/admin/admin.routes'));
app.use('/api/lender',      require('./src/lender/lender.routes'));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ── GLOBAL ERROR HANDLER ──────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error('Unhandled error: ' + err.message, {
    stack: err.stack, url: req.url, method: req.method,
  });
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'CORS: origin not allowed' });
  }
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// ── START ─────────────────────────────────────────────────────
const start = async () => {
  try {
    await testConnection();
    await connectRedis();
    const { startCronJobs } = require('./src/monitoring/cron.scheduler');
    startCronJobs();
    app.listen(PORT, () => {
      logger.info(`🚀 LienPay backend running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

start();
