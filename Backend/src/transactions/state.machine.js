// ─────────────────────────────────────────────────────────────
// TRANSACTION STATE MACHINE
// Every state transition is logged immutably.
// No transaction can skip a state or go backwards.
// This is what NPCI auditors look for first.
// ─────────────────────────────────────────────────────────────

const { query } = require('../../config/database');
const { audit } = require('../../config/logger');

// ── VALID STATE TRANSITIONS ───────────────────────────────────
const VALID_TRANSITIONS = {
  INITIATED:       ['PRE_AUTHORISED', 'FAILED'],
  PRE_AUTHORISED:  ['PENDING', 'FAILED', 'REVERSED'],
  PENDING:         ['SETTLED', 'FAILED'],
  SETTLED:         ['REVERSED'],       // only for genuine reversals
  FAILED:          [],                  // terminal state
  REVERSED:        [],                  // terminal state
};

// ── TRANSITION METADATA ───────────────────────────────────────
const TRANSITION_METADATA = {
  INITIATED:      { description: 'Transaction created, pre-auth pending' },
  PRE_AUTHORISED: { description: 'NBFC pre-auth received, UPI PIN entry pending' },
  PENDING:        { description: 'UPI PIN entered, NPCI routing in progress' },
  SETTLED:        { description: 'NPCI confirmed settlement, UTR assigned' },
  FAILED:         { description: 'Transaction failed at any stage' },
  REVERSED:       { description: 'Settled transaction reversed/refunded' },
};

// ── TRANSITION: Move transaction to next state ────────────────
const transitionState = async (txnId, toState, metadata = {}) => {
  const txnRes = await query(
    'SELECT txn_id, status, user_id, amount, lsp_txn_ref FROM transactions WHERE txn_id = $1 FOR UPDATE',
    [txnId]
  );

  if (!txnRes.rows.length) {
    throw new Error(`Transaction ${txnId} not found`);
  }

  const txn       = txnRes.rows[0];
  const fromState = txn.status;

  // Validate the transition is allowed
  const allowedNext = VALID_TRANSITIONS[fromState];
  if (!allowedNext) {
    throw new Error(`Unknown state: ${fromState}`);
  }
  if (!allowedNext.includes(toState)) {
    throw new Error(`Invalid transition: ${fromState} → ${toState} for txn ${txnId}`);
  }

  // Build the UPDATE fields
  const now = new Date();
  const updateFields = { status: toState };

  switch (toState) {
    case 'PRE_AUTHORISED':
      updateFields.pre_authed_at   = metadata.timestamp || now;
      updateFields.nbfc_pre_auth_id = metadata.pre_auth_id || null;
      break;
    case 'PENDING':
      updateFields.pending_at = metadata.timestamp || now;
      break;
    case 'SETTLED':
      updateFields.settled_at      = metadata.timestamp || now;
      updateFields.utr              = metadata.utr;
      updateFields.settlement_date  = metadata.settlement_date || new Date(now.getTime() + 86400000);
      updateFields.nbfc_drawdown_id = metadata.drawdown_id || null;
      break;
    case 'FAILED':
      updateFields.failed_at      = metadata.timestamp || now;
      updateFields.failure_reason = metadata.reason || 'UNKNOWN';
      break;
    case 'REVERSED':
      updateFields.reversed_at     = metadata.timestamp || now;
      updateFields.reversal_reason = metadata.reason;
      updateFields.reversal_utr    = metadata.reversal_utr;
      break;
  }

  // Build SET clause dynamically
  const keys   = Object.keys(updateFields);
  const values = Object.values(updateFields);
  const set    = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');

  await query(
    `UPDATE transactions SET ${set} WHERE txn_id = $1`,
    [txnId, ...values]
  );

  // Immutable audit log of every state transition
  await query(`
    INSERT INTO audit_trail (
      user_id, event_type, entity_type, entity_id,
      old_values, new_values
    ) VALUES ($1, $2, 'transaction', $3, $4, $5)
  `, [
    txn.user_id,
    `TXN_STATE_${fromState}_TO_${toState}`,
    txnId,
    JSON.stringify({ status: fromState, amount: txn.amount }),
    JSON.stringify({ status: toState, ...metadata }),
  ]);

  audit(`TXN_${toState}`, txn.user_id, {
    txn_id:     txnId,
    lsp_ref:    txn.lsp_txn_ref,
    from_state: fromState,
    to_state:   toState,
    ...metadata,
  });

  return { txn_id: txnId, from: fromState, to: toState };
};

// ── GET CURRENT STATE ─────────────────────────────────────────
const getState = async (txnId) => {
  const res = await query('SELECT status FROM transactions WHERE txn_id = $1', [txnId]);
  return res.rows[0]?.status || null;
};

// ── CHECK IDEMPOTENCY ─────────────────────────────────────────
// Prevent double-processing of the same UTR
const isUTRProcessed = async (utr) => {
  const res = await query(
    'SELECT txn_id FROM transactions WHERE utr = $1',
    [utr]
  );
  return res.rows.length > 0;
};

module.exports = {
  transitionState,
  getState,
  isUTRProcessed,
  VALID_TRANSITIONS,
  TRANSITION_METADATA,
};
