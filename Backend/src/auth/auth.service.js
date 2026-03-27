const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query }      = require('../../config/database');
const {
  setOTP, getOTP, deleteOTP,
  incrementOTPAttempts, getOTPAttempts, resetOTPAttempts,
  incrementOTPRequests, getOTPRequests,
  blacklistToken,
} = require('../../config/redis');
const { sendSMS }    = require('../utils/sms.service');
const { hash }       = require('../utils/encryption');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CONSTANTS (from env or system_config defaults)
// ─────────────────────────────────────────────────────────────
const OTP_EXPIRY_SECONDS  = parseInt(process.env.OTP_EXPIRY_SECONDS)  || 600;  // 10 min
const OTP_MAX_ATTEMPTS    = parseInt(process.env.OTP_MAX_ATTEMPTS)    || 3;
const OTP_MAX_DAILY       = parseInt(process.env.OTP_MAX_PER_MOBILE_PER_DAY) || 5;
const OTP_LOCKOUT_MINUTES = parseInt(process.env.OTP_LOCKOUT_MINUTES) || 15;
const JWT_SECRET          = process.env.JWT_SECRET;
const JWT_EXPIRES_IN      = process.env.JWT_EXPIRES_IN || '7d';

// ─────────────────────────────────────────────────────────────
// GENERATE & SEND OTP
// ─────────────────────────────────────────────────────────────
const sendOTP = async ({ mobile, ipAddress, deviceId }) => {
  // 1. Daily rate limit — max 5 OTP requests per mobile per day
  const dailyCount = await getOTPRequests(mobile);
  if (dailyCount >= OTP_MAX_DAILY) {
    throw { statusCode: 429, message: `Maximum ${OTP_MAX_DAILY} OTP requests allowed per day. Try again tomorrow.` };
  }

  // 2. Check attempt lockout (too many wrong attempts earlier)
  const attempts = await getOTPAttempts(mobile);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    throw { statusCode: 429, message: `OTP locked due to too many failed attempts. Try again in ${OTP_LOCKOUT_MINUTES} minutes.` };
  }

  // 3. Generate OTP
  // DEV MODE: Use fixed OTP 123456 until real SMS (MSG91) is connected
  // Set OTP_MODE=random in Railway to use random OTPs with real SMS
  const otpMode = process.env.OTP_MODE || 'dev';
  const otp = otpMode === 'dev' ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
  const otpHash = await bcrypt.hash(otp, 10);

  // 4. Store hash in Redis with expiry
  await setOTP(mobile, otpHash, OTP_EXPIRY_SECONDS);
  await incrementOTPRequests(mobile);

  // 5. Log to DB for audit (hash only, never plaintext)
  await query(`
    INSERT INTO otp_logs (mobile, otp_type, otp_hash, max_attempts, ip_hash, expires_at)
    VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '${OTP_EXPIRY_SECONDS} seconds')
  `, [mobile, 'MOBILE_VERIFY', otpHash, OTP_MAX_ATTEMPTS, hash(ipAddress)]);

  // 6. Send SMS
  await sendSMS(mobile, 'OTP_SEND', { otp });

  audit('OTP_SENT', null, {
    mobile:   mobile.slice(-4).padStart(10, '*'),
    ip_hash:  hash(ipAddress),
    device_id: deviceId,
  });

  return {
    message:     `OTP sent to +91 XXXXX${mobile.slice(-5)}`,
    expires_in:  OTP_EXPIRY_SECONDS,
    resend_after: 60,
    ...(otpMode === 'dev' ? { dev_otp: otp, dev_hint: 'Use 123456 — dev mode active' } : {}),
  };
};

// ─────────────────────────────────────────────────────────────
// VERIFY OTP
// ─────────────────────────────────────────────────────────────
const verifyOTP = async ({ mobile, otp, ipAddress, deviceId, userAgent }) => {
  // 1. Check attempt lockout
  const attempts = await getOTPAttempts(mobile);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    throw { statusCode: 429, message: `OTP locked. Too many failed attempts. Try again in ${OTP_LOCKOUT_MINUTES} minutes.` };
  }

  // 2. Get stored OTP hash from Redis
  const storedHash = await getOTP(mobile);
  if (!storedHash) {
    throw { statusCode: 400, message: 'OTP expired or not found. Please request a new OTP.' };
  }

  // 3. Compare
  const isMatch = await bcrypt.compare(String(otp), storedHash);
  if (!isMatch) {
    const newAttempts = await incrementOTPAttempts(mobile);
    const remaining   = OTP_MAX_ATTEMPTS - newAttempts;

    audit('OTP_FAILED', null, {
      mobile:    mobile.slice(-4).padStart(10, '*'),
      attempts:  newAttempts,
      remaining,
    });

    if (remaining <= 0) {
      throw { statusCode: 429, message: `OTP locked after ${OTP_MAX_ATTEMPTS} failed attempts. Try again in ${OTP_LOCKOUT_MINUTES} minutes.` };
    }
    throw { statusCode: 400, message: `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` };
  }

  // 4. OTP correct — clean up Redis
  await deleteOTP(mobile);
  await resetOTPAttempts(mobile);

  // 5. Update DB log
  await query(`
    UPDATE otp_logs SET status = 'VERIFIED', verified_at = NOW()
    WHERE mobile = $1 AND status = 'PENDING'
  `, [mobile]);

  // 6. Find or create user
  let user = await findUserByMobile(mobile);
  if (!user) {
    user = await createUserFromMobile(mobile, deviceId);
  } else {
    // Update mobile_verified and device
    await query(`
      UPDATE users
      SET mobile_verified = true,
          device_fingerprint = COALESCE($2, device_fingerprint),
          updated_at = NOW()
      WHERE user_id = $1
    `, [user.user_id, deviceId]);
  }

  // 7. Create session + issue JWT
  const { token, session } = await createSession({
    userId:    user.user_id,
    deviceId,
    ipAddress,
    userAgent,
  });

  audit('OTP_VERIFIED', user.user_id, {
    mobile:   mobile.slice(-4).padStart(10, '*'),
    ip_hash:  hash(ipAddress),
  });

  return {
    token,
    user: {
      user_id:          user.user_id,
      mobile:           `+91 XXXXX${mobile.slice(-5)}`,
      mobile_verified:  true,
      account_status:   user.account_status,
      onboarding_step:  user.onboarding_step || 'PAN_ENTRY',
      kyc_status:       user.kyc_status,
    },
  };
};

// ─────────────────────────────────────────────────────────────
// CREATE SESSION + JWT
// ─────────────────────────────────────────────────────────────
const createSession = async ({ userId, deviceId, ipAddress, userAgent }) => {
  const jti = uuidv4(); // unique JWT ID — used for blacklisting on logout

  const token = jwt.sign(
    {
      user_id: userId,
      jti,
      type: 'access',
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  // Decode to get expiry timestamp
  const decoded  = jwt.decode(token);
  const expiresAt = new Date(decoded.exp * 1000);

  // Store session in DB
  const res = await query(`
    INSERT INTO sessions
      (user_id, jwt_jti, device_id, ip_hash, user_agent, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *
  `, [userId, jti, deviceId, hash(ipAddress), userAgent, expiresAt]);

  return { token, session: res.rows[0] };
};

// ─────────────────────────────────────────────────────────────
// LOGOUT — blacklist JWT
// ─────────────────────────────────────────────────────────────
const logout = async (userId, jti, expiresAt) => {
  const now     = Math.floor(Date.now() / 1000);
  const expiry  = Math.floor(new Date(expiresAt).getTime() / 1000);
  const ttl     = Math.max(expiry - now, 1);

  await blacklistToken(jti, ttl);

  await query(`
    UPDATE sessions
    SET is_active = false, revoked_at = NOW(), revoke_reason = 'USER_LOGOUT'
    WHERE jwt_jti = $1
  `, [jti]);

  audit('USER_LOGOUT', userId, { jti });
  return { message: 'Logged out successfully' };
};

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
const findUserByMobile = async (mobile) => {
  const res = await query(
    'SELECT * FROM users WHERE mobile = $1 AND deleted_at IS NULL',
    [mobile]
  );
  return res.rows[0] || null;
};

const createUserFromMobile = async (mobile, deviceId) => {
  // Check again right before insert (race condition guard)
  const existing = await query('SELECT * FROM users WHERE mobile = $1', [mobile]);
  if (existing.rows.length) {
    // User exists (maybe soft-deleted or race condition) — return existing
    if (existing.rows[0].deleted_at) {
      // Reactivate soft-deleted user
      await query('UPDATE users SET deleted_at = NULL, mobile_verified = true, device_fingerprint = $2, updated_at = NOW() WHERE user_id = $1', [existing.rows[0].user_id, deviceId]);
    }
    return existing.rows[0];
  }

  const res = await query(`
    INSERT INTO users (mobile, mobile_verified, device_fingerprint, account_status, onboarding_step)
    VALUES ($1, true, $2, 'ONBOARDING', 'PAN_ENTRY')
    ON CONFLICT (mobile) DO UPDATE SET
      mobile_verified = true,
      device_fingerprint = COALESCE($2, users.device_fingerprint),
      updated_at = NOW()
    RETURNING *
  `, [mobile, deviceId]);

  audit('USER_CREATED', res.rows[0].user_id, {
    mobile: mobile.slice(-4).padStart(10, '*'),
  });

  return res.rows[0];
};

const getUserById = async (userId) => {
  const res = await query(
    'SELECT * FROM users WHERE user_id = $1 AND deleted_at IS NULL',
    [userId]
  );
  return res.rows[0] || null;
};

module.exports = {
  sendOTP,
  verifyOTP,
  createSession,
  logout,
  getUserById,
  findUserByMobile,
};
