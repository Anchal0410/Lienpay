const rateLimit = require('express-rate-limit');
const { error }  = require('../utils/response');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// VELOCITY & FRAUD CHECKS
// Protects onboarding from abuse and fraud
// ─────────────────────────────────────────────────────────────

// ── OTP-SPECIFIC RATE LIMITER ─────────────────────────────────
// Stricter than the global limiter — max 3 OTP requests per 15 min per IP
const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      3,
  keyGenerator: (req) => `${req.ip}:${req.body?.mobile || 'unknown'}`,
  handler: (req, res) => {
    logger.warn('OTP rate limit hit', { ip: req.ip, mobile: req.body?.mobile });
    return error(res, 'Too many OTP requests. Please wait 15 minutes before trying again.', 429);
  },
  standardHeaders: true,
  legacyHeaders:   false,
  skipSuccessfulRequests: false,
});

// ── VPN / PROXY DETECTION ─────────────────────────────────────
// Block known proxy headers and obviously spoofed IPs
// In production, integrate with an IP intelligence API
const detectSuspiciousIP = (req, res, next) => {
  const ip = req.ip || '';

  // Check for proxy/VPN headers (basic)
  const proxyHeaders = [
    'x-forwarded-for',
    'x-real-ip',
    'via',
    'x-proxy-id',
    'forwarded-for',
  ];

  // Log if proxy headers detected (don't block in dev)
  const hasProxyHeaders = proxyHeaders.some(h => req.headers[h] && process.env.NODE_ENV === 'production');
  if (hasProxyHeaders) {
    logger.warn('Proxy/VPN headers detected on onboarding request', {
      ip,
      headers: proxyHeaders.filter(h => req.headers[h]),
    });
    // In production, you might want to block — uncomment:
    // return error(res, 'VPN or proxy connections are not allowed during registration.', 403);
  }

  next();
};

// ── GEO-VELOCITY CHECK ────────────────────────────────────────
// Flags if same user_id appears from very different IPs in short time
// (Simplified — a production implementation uses IP geolocation)
const geoVelocityCheck = async (req, res, next) => {
  // This is a placeholder — integrate MaxMind or IP-API in production
  // For now just pass through and log
  next();
};

// ── DEVICE CONSISTENCY CHECK ──────────────────────────────────
// Flags if known user suddenly logs in from many new devices
const deviceConsistencyCheck = async (req, res, next) => {
  // Implemented in auth service — this middleware is a pass-through hook
  next();
};

module.exports = {
  otpRateLimiter,
  detectSuspiciousIP,
  geoVelocityCheck,
  deviceConsistencyCheck,
};
