const { createClient } = require('redis');

let client;

const isRedisEnabled = () => {
  const flag = (process.env.REDIS_ENABLED || '').toLowerCase();
  if (flag === 'false') return false;
  if (flag === 'true') return true;
  // If unset, enable when a URL is provided (prod) otherwise treat as disabled (local).
  return !!process.env.REDIS_URL;
};

// In-memory fallback for local/dev when Redis is disabled.
// Supports the subset of commands this codebase uses.
const memory = {
  kv: new Map(),          // key -> { value: string, expiresAtMs?: number }
  expiries: new Map(),    // key -> timeoutId
};

const memCleanupIfExpired = (key) => {
  const entry = memory.kv.get(key);
  if (!entry) return;
  if (entry.expiresAtMs && Date.now() >= entry.expiresAtMs) {
    memory.kv.delete(key);
    const t = memory.expiries.get(key);
    if (t) clearTimeout(t);
    memory.expiries.delete(key);
  }
};

const memSetEx = async (key, ttlSeconds, value) => {
  const expiresAtMs = Date.now() + ttlSeconds * 1000;
  memory.kv.set(key, { value: String(value), expiresAtMs });
  const existing = memory.expiries.get(key);
  if (existing) clearTimeout(existing);
  memory.expiries.set(
    key,
    setTimeout(() => {
      memory.kv.delete(key);
      memory.expiries.delete(key);
    }, ttlSeconds * 1000).unref?.()
  );
};

const memGet = async (key) => {
  memCleanupIfExpired(key);
  const entry = memory.kv.get(key);
  return entry ? entry.value : null;
};

const memDel = async (key) => {
  memory.kv.delete(key);
  const t = memory.expiries.get(key);
  if (t) clearTimeout(t);
  memory.expiries.delete(key);
};

const memIncr = async (key) => {
  memCleanupIfExpired(key);
  const current = parseInt((memory.kv.get(key)?.value ?? '0'), 10) || 0;
  const next = current + 1;
  const prev = memory.kv.get(key);
  memory.kv.set(key, { value: String(next), expiresAtMs: prev?.expiresAtMs });
  return next;
};

const memExpire = async (key, ttlSeconds) => {
  memCleanupIfExpired(key);
  const entry = memory.kv.get(key);
  if (!entry) return;
  await memSetEx(key, ttlSeconds, entry.value);
};

const connectRedis = async () => {
  if (!isRedisEnabled()) {
    console.log('ℹ️  Redis disabled — using in-memory store for dev.');
    return null;
  }
  // Railway provides REDIS_URL — use it if available
  const redisConfig = process.env.REDIS_URL
    ? { url: process.env.REDIS_URL }
    : {
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT) || 6379,
        },
        password: process.env.REDIS_PASSWORD || undefined,
      };

  client = createClient(redisConfig);
  client.on('error', (err) => console.error('Redis error:', err));
  client.on('connect', () => console.log('✅ Redis connected'));
  await client.connect();
  return client;
};

const getRedis = () => {
  if (!isRedisEnabled()) return null;
  if (!client) throw new Error('Redis not initialised. Call connectRedis() first.');
  return client;
};

const setOTP = async (mobile, otpHash, expirySeconds = 600) => {
  const r = getRedis();
  if (!r) return await memSetEx(`otp:${mobile}`, expirySeconds, otpHash);
  await r.setEx(`otp:${mobile}`, expirySeconds, otpHash);
};

const getOTP = async (mobile) => {
  const r = getRedis();
  if (!r) return await memGet(`otp:${mobile}`);
  return await r.get(`otp:${mobile}`);
};

const deleteOTP = async (mobile) => {
  const r = getRedis();
  if (!r) return await memDel(`otp:${mobile}`);
  await r.del(`otp:${mobile}`);
};

const incrementOTPAttempts = async (mobile) => {
  const key = `otp:attempts:${mobile}`;
  const r = getRedis();
  const count = r ? await r.incr(key) : await memIncr(key);
  if (count === 1) {
    if (r) await r.expire(key, 900);
    else await memExpire(key, 900);
  }
  return count;
};

const getOTPAttempts = async (mobile) => {
  const r = getRedis();
  const val = r ? await r.get(`otp:attempts:${mobile}`) : await memGet(`otp:attempts:${mobile}`);
  return parseInt(val) || 0;
};

const resetOTPAttempts = async (mobile) => {
  const r = getRedis();
  if (!r) return await memDel(`otp:attempts:${mobile}`);
  await r.del(`otp:attempts:${mobile}`);
};

const incrementOTPRequests = async (mobile) => {
  const key = `otp:daily:${mobile}`;
  const r = getRedis();
  const count = r ? await r.incr(key) : await memIncr(key);
  if (count === 1) {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ttl = Math.floor((midnight - now) / 1000);
    if (r) await r.expire(key, ttl);
    else await memExpire(key, ttl);
  }
  return count;
};

const getOTPRequests = async (mobile) => {
  const r = getRedis();
  const val = r ? await r.get(`otp:daily:${mobile}`) : await memGet(`otp:daily:${mobile}`);
  return parseInt(val) || 0;
};

const blacklistToken = async (jti, expirySeconds) => {
  const r = getRedis();
  if (!r) return await memSetEx(`blacklist:${jti}`, expirySeconds, '1');
  await r.setEx(`blacklist:${jti}`, expirySeconds, '1');
};

const isTokenBlacklisted = async (jti) => {
  const r = getRedis();
  const val = r ? await r.get(`blacklist:${jti}`) : await memGet(`blacklist:${jti}`);
  return val === '1';
};

const setCache = async (key, value, ttlSeconds = 300) => {
  const r = getRedis();
  const v = JSON.stringify(value);
  if (!r) return await memSetEx(`cache:${key}`, ttlSeconds, v);
  await r.setEx(`cache:${key}`, ttlSeconds, v);
};

const getCache = async (key) => {
  const r = getRedis();
  const val = r ? await r.get(`cache:${key}`) : await memGet(`cache:${key}`);
  return val ? JSON.parse(val) : null;
};

const deleteCache = async (key) => {
  const r = getRedis();
  if (!r) return await memDel(`cache:${key}`);
  await r.del(`cache:${key}`);
};

module.exports = {
  connectRedis, getRedis,
  setOTP, getOTP, deleteOTP,
  incrementOTPAttempts, getOTPAttempts, resetOTPAttempts,
  incrementOTPRequests, getOTPRequests,
  blacklistToken, isTokenBlacklisted,
  setCache, getCache, deleteCache,
};
