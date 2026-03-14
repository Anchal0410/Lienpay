const crypto = require('crypto');

// ─────────────────────────────────────────────────────────────
// ENCRYPTION UTILITY
// AES-256-CBC for PAN, full Aadhaar (temp only), and other PII
// Keys must be set in .env — never hardcoded
// ─────────────────────────────────────────────────────────────

const ALGORITHM = 'aes-256-cbc';

// Get key and IV from env, or generate deterministic ones for dev
const getKey = () => {
  const key = process.env.ENCRYPTION_KEY;
  if (key) return Buffer.from(key, 'hex');
  // Dev fallback — NEVER use in production
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be set in production');
  }
  return crypto.scryptSync('lienpay_dev_key', 'salt', 32);
};

const getIV = () => {
  // Each encryption uses a fresh IV stored alongside ciphertext
  return crypto.randomBytes(16);
};

// ── ENCRYPT ───────────────────────────────────────────────────
// Returns: "iv_hex:encrypted_hex"
const encrypt = (plaintext) => {
  if (!plaintext) return null;
  try {
    const key = getKey();
    const iv  = getIV();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (err) {
    throw new Error(`Encryption failed: ${err.message}`);
  }
};

// ── DECRYPT ───────────────────────────────────────────────────
const decrypt = (ciphertext) => {
  if (!ciphertext) return null;
  try {
    const [ivHex, encrypted] = ciphertext.split(':');
    const key    = getKey();
    const iv     = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    throw new Error(`Decryption failed: ${err.message}`);
  }
};

// ── HASH (one-way, for IPs and device IDs) ────────────────────
const hash = (value) => {
  if (!value) return null;
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET || 'dev_hash_secret')
    .update(String(value))
    .digest('hex');
};

// ── MASK PAN for display ──────────────────────────────────────
// ABCDE1234F → ABCXX1234X
const maskPAN = (pan) => {
  if (!pan || pan.length !== 10) return 'XXXXXXXXXX';
  return pan.slice(0, 3) + 'XX' + pan.slice(5, 9) + 'X';
};

// ── MASK MOBILE for display ───────────────────────────────────
// 9876543210 → +91 XXXXX 43210
const maskMobile = (mobile) => {
  if (!mobile) return 'XXXXXXXXXX';
  return `+91 XXXXX ${mobile.slice(-5)}`;
};

// ── MASK AADHAAR for display ──────────────────────────────────
// Only last 4 digits ever stored — this just formats them
const maskAadhaar = (last4) => {
  return `XXXX XXXX ${last4}`;
};

module.exports = { encrypt, decrypt, hash, maskPAN, maskMobile, maskAadhaar };
