const { query }  = require('../../config/database');
const { audit }  = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CONSENT LOGGING SERVICE
// DPDP Act 2023: Every consent action must be logged
// immutably. This table is APPEND-ONLY — never update/delete.
// ─────────────────────────────────────────────────────────────

const CONSENT_TYPES = {
  BUREAU_PULL:        'BUREAU_PULL',
  CKYC_REGISTRATION:  'CKYC_REGISTRATION',
  AA_DATA_ACCESS:     'AA_DATA_ACCESS',
  PLEDGE_CREATION:    'PLEDGE_CREATION',
  KFS_ACCEPTANCE:     'KFS_ACCEPTANCE',
  AADHAAR_KYC:        'AADHAAR_KYC',
  T_AND_C:            'T_AND_C',
  MARKETING:          'MARKETING',
};

const CONSENT_ACTIONS = {
  GRANTED: 'GRANTED',
  REVOKED: 'REVOKED',
  UPDATED: 'UPDATED',
};

// Log a consent action — APPEND ONLY
const logConsent = async ({
  userId,
  consentType,
  action = CONSENT_ACTIONS.GRANTED,
  version = 'v1.0',
  kfsVersion = null,
  ipHash = null,
  deviceId = null,
  metadata = {},
}) => {
  const result = await query(`
    INSERT INTO consent_logs
      (user_id, consent_type, consent_action, consent_version,
       kfs_version, ip_hash, device_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING consent_id, created_at
  `, [
    userId, consentType, action, version,
    kfsVersion, ipHash, deviceId, JSON.stringify(metadata),
  ]);

  audit('CONSENT_LOGGED', userId, {
    consent_type: consentType,
    action,
    version,
    consent_id: result.rows[0].consent_id,
  });

  return result.rows[0];
};

// Log multiple consents at once (onboarding screen)
const logMultipleConsents = async (userId, consents, ipHash, deviceId) => {
  const results = [];
  for (const consent of consents) {
    const result = await logConsent({
      userId,
      consentType: consent.type,
      action:      consent.granted ? CONSENT_ACTIONS.GRANTED : CONSENT_ACTIONS.REVOKED,
      version:     consent.version || 'v1.0',
      kfsVersion:  consent.kfs_version || null,
      ipHash,
      deviceId,
      metadata:    consent.metadata || {},
    });
    results.push(result);
  }
  return results;
};

// Check if user has granted a specific consent
const hasConsent = async (userId, consentType) => {
  const result = await query(`
    SELECT consent_action
    FROM consent_logs
    WHERE user_id = $1 AND consent_type = $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId, consentType]);

  if (!result.rows.length) return false;
  return result.rows[0].consent_action === CONSENT_ACTIONS.GRANTED;
};

// Get all consents for a user
const getUserConsents = async (userId) => {
  const result = await query(`
    SELECT DISTINCT ON (consent_type)
      consent_type, consent_action, consent_version, created_at
    FROM consent_logs
    WHERE user_id = $1
    ORDER BY consent_type, created_at DESC
  `, [userId]);

  return result.rows;
};

module.exports = {
  logConsent,
  logMultipleConsents,
  hasConsent,
  getUserConsents,
  CONSENT_TYPES,
  CONSENT_ACTIONS,
};
