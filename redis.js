const { createClient } = require('redis');

let client;

const connectRedis = async () => {
  client = createClient({
    socket: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
    },
    password: process.env.REDIS_PASSWORD || undefined,
  });

  client.on('error', (err) => console.error('Redis error:', err));
  client.on('connect', () => console.log('✅ Redis connected'));

  await client.connect();
  return client;
};

const getRedis = () => {
  if (!client) throw new Error('Redis not initialised. Call connectRedis() first.');
  return client;
};

// OTP helpers
const setOTP = async (mobile, otpHash, expirySeconds = 600) => {
  const key = `otp:${mobile}`;
  await getRedis().setEx(key, expirySeconds, otpHash);
};

const getOTP = async (mobile) => {
  return await getRedis().get(`otp:${mobile}`);
};

const deleteOTP = async (mobile) => {
  await getRedis().del(`otp:${mobile}`);
};

// OTP attempt counter
const incrementOTPAttempts = async (mobile) => {
  const key = `otp:attempts:${mobile}`;
  const count = await getRedis().incr(key);
  if (count === 1) await getRedis().expire(key, 900); // 15 min window
  return count;
};

const getOTPAttempts = async (mobile) => {
  const val = await getRedis().get(`otp:attempts:${mobile}`);
  return parseInt(val) || 0;
};

const resetOTPAttempts = async (mobile) => {
  await getRedis().del(`otp:attempts:${mobile}`);
};

// OTP daily request counter
const incrementOTPRequests = async (mobile) => {
  const key = `otp:daily:${mobile}`;
  const count = await getRedis().incr(key);
  if (count === 1) {
    // Expire at midnight (get seconds until midnight)
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ttl = Math.floor((midnight - now) / 1000);
    await getRedis().expire(key, ttl);
  }
  return count;
};

const getOTPRequests = async (mobile) => {
  const val = await getRedis().get(`otp:daily:${mobile}`);
  return parseInt(val) || 0;
};

// Session blacklist (for logout)
const blacklistToken = async (jti, expirySeconds) => {
  await getRedis().setEx(`blacklist:${jti}`, expirySeconds, '1');
};

const isTokenBlacklisted = async (jti) => {
  const val = await getRedis().get(`blacklist:${jti}`);
  return val === '1';
};

// Cache helpers
const setCache = async (key, value, ttlSeconds = 300) => {
  await getRedis().setEx(`cache:${key}`, ttlSeconds, JSON.stringify(value));
};

const getCache = async (key) => {
  const val = await getRedis().get(`cache:${key}`);
  return val ? JSON.parse(val) : null;
};

const deleteCache = async (key) => {
  await getRedis().del(`cache:${key}`);
};

module.exports = {
  connectRedis,
  getRedis,
  setOTP, getOTP, deleteOTP,
  incrementOTPAttempts, getOTPAttempts, resetOTPAttempts,
  incrementOTPRequests, getOTPRequests,
  blacklistToken, isTokenBlacklisted,
  setCache, getCache, deleteCache,
};
