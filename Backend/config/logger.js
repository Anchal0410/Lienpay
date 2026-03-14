const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'lienpay-backend' },
  transports: [
    // Console — pretty in dev, JSON in prod
    new winston.transports.Console({
      format: process.env.NODE_ENV === 'development'
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : winston.format.json()
    }),
    // File — all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'lienpay.log'),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
    }),
    // File — errors only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
    }),
  ],
});

// Compliance audit logger — separate file, immutable append-only
const auditLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      maxsize: 50 * 1024 * 1024,
      maxFiles: 50, // Keep 50 rotating files
      tailable: false, // Don't overwrite — append only
    }),
  ],
});

// Audit log helper — for compliance events
const audit = (event, userId, data = {}) => {
  auditLogger.info({
    event,
    user_id: userId,
    timestamp: new Date().toISOString(),
    ...data,
  });
};

module.exports = { logger, audit };
