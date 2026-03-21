const { query }  = require('../../config/database');
const { getRedis } = require('../../config/redis');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// IDEMPOTENCY LAYER
// Prevents duplicate transactions from:
// - Network retries
// - Double-tap by user
// - Webhook replays from NBFC
// - System retries after failure
//
// Every payment request gets an idempotency key.
// Same key = same result, no double charge.
// This is critical for NPCI audit compliance.
// ─────────────────────────────────────────────────────────────

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours in seconds

// ── GENERATE IDEMPOTENCY KEY ──────────────────────────────────
// Key = hash of user + merchant + amount + timestamp (rounded to 30s)
const generateIdempotencyKey = (userId, merchantVPA, amount) => {
  const crypto = require('crypto');
  // Round timestamp to 30-second window to catch rapid retries
  const timeWindow = Math.floor(Date.now() / 30000);
  const raw = `${userId}:${merchantVPA}:${amount}:${timeWindow}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
};

// ── CHECK IF REQUEST IS DUPLICATE ────────────────────────────
const checkIdempotency = async (idempotencyKey) => {
  try {
    const redis  = getRedis();
    const cached = await redis.get(`idempotency:${idempotencyKey}`);
    if (cached) {
      return { isDuplicate: true, cachedResult: JSON.parse(cached) };
    }
    return { isDuplicate: false };
  } catch (err) {
    // Redis failure should NOT block transactions
    logger.error('Idempotency check failed (Redis):', err.message);
    return { isDuplicate: false };
  }
};

// ── STORE RESULT ──────────────────────────────────────────────
const storeIdempotencyResult = async (idempotencyKey, result) => {
  try {
    const redis = getRedis();
    await redis.setEx(
      `idempotency:${idempotencyKey}`,
      IDEMPOTENCY_TTL,
      JSON.stringify(result)
    );
  } catch (err) {
    logger.error('Idempotency store failed:', err.message);
    // Non-fatal — continue
  }
};

// ── CHECK UTR UNIQUENESS ──────────────────────────────────────
// UTR (Unique Transaction Reference) from NPCI must be globally unique
const checkUTRUniqueness = async (utr) => {
  const res = await query(
    'SELECT txn_id, status FROM transactions WHERE utr = $1',
    [utr]
  );
  if (res.rows.length > 0) {
    return { isUnique: false, existingTxn: res.rows[0] };
  }
  return { isUnique: true };
};

// ── CHECK LSP REF UNIQUENESS ──────────────────────────────────
const checkLSPRefUniqueness = async (lspTxnRef) => {
  const res = await query(
    'SELECT txn_id FROM transactions WHERE lsp_txn_ref = $1',
    [lspTxnRef]
  );
  return res.rows.length === 0;
};

module.exports = {
  generateIdempotencyKey,
  checkIdempotency,
  storeIdempotencyResult,
  checkUTRUniqueness,
  checkLSPRefUniqueness,
};
