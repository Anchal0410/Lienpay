const cron = require('node-cron');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CRON SCHEDULER
//
// All automated background jobs for LienPay.
// Uses node-cron for scheduling.
//
// Schedule overview:
// - 11:30pm daily  → Fetch AMFI NAVs + LTV monitoring
// - 1st of month   → Generate monthly statements
// - 2nd of month   → Generate LSP invoice
// - Every 2 hours  → Resolve stuck transactions
// - Daily 9am      → Reconciliation
// ─────────────────────────────────────────────────────────────

const startCronJobs = () => {
  logger.info('⏰ Starting cron jobs...');

  // ── NAV MONITORING: Daily at 11:30pm ─────────────────────
  // AMFI updates NAVs after 11pm, so we run at 11:30pm
  cron.schedule('30 23 * * *', async () => {
    logger.info('⏰ CRON: Daily NAV monitoring triggered');
    try {
      const { runDailyNAVMonitoring } = require('./nav.monitor');
      const result = await runDailyNAVMonitoring();
      logger.info('✅ CRON: NAV monitoring complete', result);
    } catch (err) {
      logger.error('❌ CRON: NAV monitoring failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── MONTHLY STATEMENTS: 1st of every month at 1am ────────
  cron.schedule('0 1 1 * *', async () => {
    logger.info('⏰ CRON: Monthly statement generation triggered');
    try {
      const { runMonthlyStatements } = require('../billing/statement.service');
      const result = await runMonthlyStatements();
      logger.info('✅ CRON: Statements generated', result);
    } catch (err) {
      logger.error('❌ CRON: Statement generation failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── LSP INVOICE: 2nd of every month at 2am ───────────────
  cron.schedule('0 2 2 * *', async () => {
    logger.info('⏰ CRON: LSP invoice generation triggered');
    try {
      const { generateMonthlyInvoice } = require('../billing/invoice.service');
      const now    = new Date();
      const month  = now.getMonth() === 0 ? 12 : now.getMonth(); // previous month
      const year   = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
      const result = await generateMonthlyInvoice(month, year);
      logger.info('✅ CRON: Invoice generated', { invoice: result.invoice_number });
    } catch (err) {
      logger.error('❌ CRON: Invoice generation failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── STUCK TRANSACTIONS: Every 2 hours ────────────────────
  cron.schedule('0 */2 * * *', async () => {
    try {
      const { resolveStuckTransactions } = require('../transactions/reconciliation/reconciliation.engine');
      const result = await resolveStuckTransactions();
      if (result.resolved_count > 0) {
        logger.info('✅ CRON: Stuck transactions resolved', result);
      }
    } catch (err) {
      logger.error('❌ CRON: Stuck transaction resolution failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── DAILY RECONCILIATION: Every day at 9am ────────────────
  cron.schedule('0 9 * * *', async () => {
    logger.info('⏰ CRON: Daily reconciliation triggered');
    try {
      const { runDailyReconciliation, reconcileCreditBalances } = require('../transactions/reconciliation/reconciliation.engine');
      const yesterday = new Date(Date.now() - 86400000);
      const [recon, balances] = await Promise.all([
        runDailyReconciliation(yesterday),
        reconcileCreditBalances(),
      ]);
      logger.info('✅ CRON: Reconciliation complete', {
        matched:   recon.matched,
        mismatches: recon.mismatches.length,
        balances_fixed: balances.mismatches_fixed,
      });
    } catch (err) {
      logger.error('❌ CRON: Reconciliation failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  logger.info('✅ All cron jobs scheduled');
};

module.exports = { startCronJobs };
