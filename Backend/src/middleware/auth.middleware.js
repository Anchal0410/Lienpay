const jwt     = require('jsonwebtoken');
const { query }    = require('../../config/database');
const { isTokenBlacklisted } = require('../../config/redis');
const { unauthorized, forbidden } = require('../utils/response');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// Protects routes by validating JWT and checking:
// 1. Token is valid and not expired
// 2. Token is not blacklisted (logout)
// 3. Session exists in DB and is active
// 4. User account is not deleted
// ─────────────────────────────────────────────────────────────
const authenticate = async (req, res, next) => {
  try {
    // 1. Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return unauthorized(res, 'No authentication token provided');
    }
    const token = authHeader.split(' ')[1];

    // 2. Verify JWT signature and expiry
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return unauthorized(res, 'Session expired. Please login again.');
      }
      return unauthorized(res, 'Invalid authentication token');
    }

    // 3. Check if token is blacklisted (user logged out)
    const isBlacklisted = await isTokenBlacklisted(decoded.jti);
    if (isBlacklisted) {
      return unauthorized(res, 'Session invalidated. Please login again.');
    }

    // 4. Verify session in DB
    const sessionRes = await query(`
      SELECT s.*, u.account_status, u.kyc_status, u.deleted_at
      FROM sessions s
      JOIN users u ON s.user_id = u.user_id
      WHERE s.jwt_jti = $1 AND s.is_active = true
    `, [decoded.jti]);

    if (!sessionRes.rows.length) {
      return unauthorized(res, 'Session not found. Please login again.');
    }

    const session = sessionRes.rows[0];

    // 5. Check user is not deleted
    if (session.deleted_at) {
      return forbidden(res, 'Account has been deactivated. Please contact support.');
    }

    // 6. Update last_active_at (non-blocking, best effort)
    query(
      'UPDATE sessions SET last_active_at = NOW() WHERE jwt_jti = $1',
      [decoded.jti]
    ).catch(() => {});

    // 7. Attach user and session to request
    req.user    = { user_id: decoded.user_id, ...session };
    req.session = session;
    req.token   = decoded;

    next();
  } catch (err) {
    logger.error('Auth middleware error:', err);
    return unauthorized(res, 'Authentication failed');
  }
};

// ─────────────────────────────────────────────────────────────
// KYC REQUIRED MIDDLEWARE
// Ensures user has completed KYC before accessing certain routes
// ─────────────────────────────────────────────────────────────
const requireKYC = (req, res, next) => {
  if (req.user.kyc_status !== 'VERIFIED') {
    return forbidden(res, 'KYC verification required to access this feature. Please complete your KYC first.');
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// ACTIVE ACCOUNT MIDDLEWARE
// Ensures credit line is active before transactional routes
// ─────────────────────────────────────────────────────────────
const requireActiveAccount = (req, res, next) => {
  const allowedStatuses = ['CREDIT_ACTIVE', 'OVERDUE'];
  if (!allowedStatuses.includes(req.user.account_status)) {
    return forbidden(res, 'Credit line is not active. Please complete onboarding first.');
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// DEVICE FINGERPRINT MIDDLEWARE
// Captures device info for fraud detection
// ─────────────────────────────────────────────────────────────
const captureDevice = (req, res, next) => {
  req.deviceInfo = {
    device_id:  req.headers['x-device-id']  || null,
    device_os:  req.headers['x-device-os']  || null,
    app_version: req.headers['x-app-version'] || null,
    ip_address: req.ip || req.connection.remoteAddress,
    user_agent: req.headers['user-agent'] || null,
  };
  next();
};

module.exports = {
  authenticate,
  requireKYC,
  requireActiveAccount,
  captureDevice,
};
