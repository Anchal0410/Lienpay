const { query }  = require('../../../config/database');
const { logger, audit } = require('../../../config/logger');

// ─────────────────────────────────────────────────────────────
// SETTLEMENT RECONCILIATION ENGINE
//
// This is what makes World 1 NPCI-audit-ready.
// Every transaction must reconcile between:
// 1. LienPay DB (our record)
// 2. NBFC ledger (their record)
// 3. NPCI settlement (ground truth)
//
// Any mismatch = raised immediately for investigation.
// RBI expects reconciliation within T+1.
// ─────────────────────────────────────────────────────────────

// ── DAILY RECONCILIATION ──────────────────────────────────────
const runDailyReconciliation = async (reconciliationDate) => {
  const date = reconciliationDate || new Date(Date.now() - 86400000); // yesterday
  const dateStr = date.toISOString().split('T')[0];

  logger.info(`📊 Running reconciliation for ${dateStr}`);

  const results = {
    date:              dateStr,
    total_txns:        0,
    matched:           0,
    mismatches:        [],
    pending_timeout:   [],
    missing_in_nbfc:   [],
    missing_in_lienpay: [],
    total_settled_amt:  0,
    errors:            [],
  };

  try {
    // 1. Get all settled transactions for the date from our DB
    const ourTxns = await query(`
      SELECT txn_id, lsp_txn_ref, utr, amount, status,
             merchant_vpa, settled_at, user_id, account_id
      FROM transactions
      WHERE DATE(settled_at) = $1
        AND status IN ('SETTLED', 'FAILED', 'REVERSED')
    `, [dateStr]);

    results.total_txns = ourTxns.rows.length;

    // 2. Get NBFC's record for the same date (mock in dev)
    const nbfcLedger = await getNBFCLedger(dateStr);

    // 3. Cross-check each transaction
    for (const txn of ourTxns.rows) {
      const nbfcRecord = nbfcLedger.find(n => n.lsp_txn_ref === txn.lsp_txn_ref);

      if (!nbfcRecord) {
        // We have it, NBFC doesn't — serious issue
        results.missing_in_nbfc.push({
          txn_id:      txn.txn_id,
          lsp_txn_ref: txn.lsp_txn_ref,
          amount:      txn.amount,
          status:      txn.status,
        });
        continue;
      }

      // Amount mismatch
      if (parseFloat(nbfcRecord.amount) !== parseFloat(txn.amount)) {
        results.mismatches.push({
          txn_id:        txn.txn_id,
          lsp_txn_ref:   txn.lsp_txn_ref,
          our_amount:    txn.amount,
          nbfc_amount:   nbfcRecord.amount,
          type:          'AMOUNT_MISMATCH',
        });
        continue;
      }

      // Status mismatch
      if (nbfcRecord.status !== txn.status) {
        results.mismatches.push({
          txn_id:       txn.txn_id,
          lsp_txn_ref:  txn.lsp_txn_ref,
          our_status:   txn.status,
          nbfc_status:  nbfcRecord.status,
          type:         'STATUS_MISMATCH',
        });
        continue;
      }

      // UTR mismatch
      if (nbfcRecord.utr && txn.utr && nbfcRecord.utr !== txn.utr) {
        results.mismatches.push({
          txn_id:     txn.txn_id,
          our_utr:    txn.utr,
          nbfc_utr:   nbfcRecord.utr,
          type:       'UTR_MISMATCH',
        });
        continue;
      }

      // All good
      results.matched++;
      results.total_settled_amt += parseFloat(txn.amount);
    }

    // 4. Check NBFC has transactions we don't
    for (const nbfcTxn of nbfcLedger) {
      const ourRecord = ourTxns.rows.find(t => t.lsp_txn_ref === nbfcTxn.lsp_txn_ref);
      if (!ourRecord) {
        results.missing_in_lienpay.push({
          lsp_txn_ref: nbfcTxn.lsp_txn_ref,
          amount:      nbfcTxn.amount,
          utr:         nbfcTxn.utr,
        });
      }
    }

    // 5. Check for stuck PENDING transactions (> 2 hours old)
    const stuckTxns = await query(`
      SELECT txn_id, lsp_txn_ref, amount, pending_at
      FROM transactions
      WHERE status = 'PENDING'
        AND pending_at < NOW() - INTERVAL '2 hours'
    `);

    results.pending_timeout = stuckTxns.rows;

    // 6. Store reconciliation report
    await query(`
      INSERT INTO audit_trail (event_type, entity_type, new_values)
      VALUES ('DAILY_RECONCILIATION', 'system', $1)
    `, [JSON.stringify(results)]);

    // 7. Alert if mismatches found
    if (results.mismatches.length > 0 || results.missing_in_nbfc.length > 0) {
      logger.error('🚨 RECONCILIATION MISMATCHES FOUND', {
        date:             dateStr,
        mismatches:       results.mismatches.length,
        missing_in_nbfc:  results.missing_in_nbfc.length,
      });
      // In production: send alert to ops team via email/Slack
    }

    logger.info(`✅ Reconciliation complete for ${dateStr}`, {
      total:    results.total_txns,
      matched:  results.matched,
      issues:   results.mismatches.length + results.missing_in_nbfc.length,
    });

  } catch (err) {
    logger.error('Reconciliation engine error:', err);
    results.errors.push(err.message);
  }

  return results;
};

// ── GET NBFC LEDGER ───────────────────────────────────────────
const getNBFCLedger = async (date) => {
  const axios = require('axios');
  const mode  = process.env.NBFC_MODE || 'mock';

  if (mode === 'real') {
    const r = await axios.get(
      `${process.env.NBFC_API_URL}/settlement/ledger?date=${date}`,
      { headers: { Authorization: `Bearer ${process.env.NBFC_API_KEY}` }, timeout: 30000 }
    );
    return r.data.transactions || [];
  }

  // Mock: return our own settled transactions as NBFC ledger
  const res = await query(`
    SELECT lsp_txn_ref, utr, amount::text, status
    FROM transactions
    WHERE DATE(settled_at) = $1 AND status IN ('SETTLED', 'FAILED')
  `, [date]);

  return res.rows;
};

// ── CREDIT LINE BALANCE RECONCILIATION ───────────────────────
// Ensures credit_accounts.outstanding matches sum of all settled txns
const reconcileCreditBalances = async () => {
  const mismatches = [];

  const accounts = await query(`
    SELECT ca.account_id, ca.user_id,
           ca.outstanding as recorded_outstanding,
           ca.credit_limit, ca.available_credit
    FROM credit_accounts ca
    WHERE ca.status = 'ACTIVE'
  `);

  for (const account of accounts.rows) {
    // Calculate true outstanding from transactions
    const txnSum = await query(`
      SELECT COALESCE(SUM(amount), 0) as true_outstanding
      FROM transactions
      WHERE account_id = $1
        AND status = 'SETTLED'
        AND txn_id NOT IN (
          SELECT txn_id FROM transactions
          WHERE account_id = $1 AND status = 'REVERSED'
        )
    `, [account.account_id]);

    // Calculate true repayments
    const repaySum = await query(`
      SELECT COALESCE(SUM(amount), 0) as total_repaid
      FROM repayments
      WHERE account_id = $1 AND status = 'SUCCESS'
    `, [account.account_id]);

    const trueOutstanding = parseFloat(txnSum.rows[0].true_outstanding) -
                            parseFloat(repaySum.rows[0].total_repaid);
    const recordedOutstanding = parseFloat(account.recorded_outstanding);

    // Allow ₹1 rounding tolerance
    if (Math.abs(trueOutstanding - recordedOutstanding) > 1) {
      mismatches.push({
        account_id:           account.account_id,
        user_id:              account.user_id,
        recorded_outstanding: recordedOutstanding,
        true_outstanding:     trueOutstanding,
        difference:           trueOutstanding - recordedOutstanding,
      });

      // Auto-correct (with audit log)
      await query(`
        UPDATE credit_accounts SET
          outstanding      = $2,
          available_credit = credit_limit - $2,
          updated_at       = NOW()
        WHERE account_id = $1
      `, [account.account_id, Math.max(0, trueOutstanding)]);

      audit('BALANCE_RECONCILIATION_CORRECTION', account.user_id, {
        account_id:     account.account_id,
        old_outstanding: recordedOutstanding,
        new_outstanding: trueOutstanding,
        difference:     trueOutstanding - recordedOutstanding,
      });
    }
  }

  return { mismatches_fixed: mismatches.length, details: mismatches };
};

// ── HANDLE STUCK PENDING TRANSACTIONS ────────────────────────
const resolveStuckTransactions = async () => {
  const axios = require('axios');

  const stuckTxns = await query(`
    SELECT * FROM transactions
    WHERE status = 'PENDING'
      AND pending_at < NOW() - INTERVAL '2 hours'
    LIMIT 50
  `);

  const resolved = [];

  for (const txn of stuckTxns.rows) {
    try {
      // Query NBFC for actual status
      let nbfcStatus;
      if (process.env.NBFC_MODE === 'real') {
        const r = await axios.get(
          `${process.env.NBFC_API_URL}/txn/status/${txn.lsp_txn_ref}`,
          { headers: { Authorization: `Bearer ${process.env.NBFC_API_KEY}` } }
        );
        nbfcStatus = r.data.status;
      } else {
        // Mock: assume failed after 2 hours
        nbfcStatus = 'FAILED';
      }

      const { transitionState } = require('../state.machine');

      if (nbfcStatus === 'SETTLED' || nbfcStatus === 'SUCCESS') {
        await transitionState(txn.txn_id, 'SETTLED', {
          utr:    txn.utr || `RECOVERED_${Date.now()}`,
          reason: 'RECOVERED_FROM_STUCK',
        });
        // Credit outstanding
        await query(`
          UPDATE credit_accounts SET outstanding = outstanding + $2
          WHERE account_id = $1
        `, [txn.account_id, txn.amount]);
      } else {
        await transitionState(txn.txn_id, 'FAILED', {
          reason: 'TIMEOUT_NO_SETTLEMENT',
        });
        // Restore available credit
        await query(`
          UPDATE credit_accounts SET
            available_credit = available_credit + $2,
            updated_at       = NOW()
          WHERE account_id = $1
        `, [txn.account_id, txn.amount]);
      }

      resolved.push({ txn_id: txn.txn_id, resolution: nbfcStatus });
    } catch (err) {
      logger.error(`Failed to resolve stuck txn ${txn.txn_id}:`, err.message);
    }
  }

  return { resolved_count: resolved.length, details: resolved };
};

module.exports = {
  runDailyReconciliation,
  reconcileCreditBalances,
  resolveStuckTransactions,
};
