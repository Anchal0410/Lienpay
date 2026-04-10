const cron = require('node-cron');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CRON SCHEDULER
//
// All automated background jobs for LienPay.
//
// Schedule:
//   11:30pm daily      → Fetch NAVs + LTV monitoring + notorious check
//   1st of month 1am   → Generate monthly statements
//   1st of Jan/Apr/Jul/Oct 2am → LSP invoice (QUARTERLY not monthly)
//   Every 2 hours      → Resolve stuck transactions
//   Daily 9am          → Reconciliation
//
// NOTE ON LSP INVOICE:
//   Per founder instruction: LSP invoice is paid QUARTERLY.
//   Invoice dates: 1st Jan, 1st Apr, 1st Jul, 1st Oct.
//   Invoice covers: sourcing fee (1.8% of quarter's disbursements)
//   + tech fee (₹50,000/month × 3 = ₹1,50,000/quarter) + GST.
// ─────────────────────────────────────────────────────────────

const startCronJobs = () => {
  logger.info('⏰ Starting cron jobs...');

  if (process.env.NODE_ENV !== 'production') {
    logger.info('⚠️  Cron jobs disabled in development mode');
    logger.info('✅ Cron scheduler ready (dev mode — jobs not active)');
    return;
  }

  // ── NAV MONITORING + NOTORIOUS FUND CHECK: Daily 11:30pm IST ──
  // AMFI updates NAVs after 11pm, so we run at 11:30pm.
  // Also runs the notorious fund check to detect newly flagged funds.
  cron.schedule('30 23 * * *', async () => {
    logger.info('⏰ CRON: Daily NAV monitoring + notorious fund check triggered');
    try {
      const { runDailyNAVMonitoring } = require('./nav.monitor');
      const result = await runDailyNAVMonitoring();
      logger.info('✅ CRON: NAV monitoring complete', result);
    } catch (err) {
      logger.error('❌ CRON: NAV monitoring failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── NOTORIOUS FUND CHECK: Also runs at 9am for early detection ──
  // Runs separately from NAV monitoring so we catch morning SEBI announcements.
  cron.schedule('0 9 * * *', async () => {
    logger.info('⏰ CRON: Morning notorious fund check triggered');
    try {
      const { runNotoriousFundCheck } = require('../portfolio/notorious.service');
      const result = await runNotoriousFundCheck();
      logger.info('✅ CRON: Notorious fund check complete', result);
    } catch (err) {
      logger.error('❌ CRON: Notorious fund check failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── MONTHLY STATEMENTS: 1st of every month 1am IST ───────────
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

  // ── LSP INVOICE: QUARTERLY (1st Jan, Apr, Jul, Oct at 2am IST) ──
  // Per founder: LSP invoice is paid quarterly, not monthly.
  // Cron: "0 2 1 1,4,7,10 *" = 2am on the 1st of Jan, Apr, Jul, Oct
  cron.schedule('0 2 1 1,4,7,10 *', async () => {
    logger.info('⏰ CRON: Quarterly LSP invoice generation triggered');
    try {
      const { generateQuarterlyInvoice } = require('../billing/invoice.service');

      const now     = new Date();
      const month   = now.getMonth(); // 0=Jan, 3=Apr, 6=Jul, 9=Oct
      const year    = now.getFullYear();

      // Quarter that just ended
      const quarterMap = {
        0: { label: 'Q4', startMonth: 9, endMonth: 11, prevYear: year - 1 },
        3: { label: 'Q1', startMonth: 0, endMonth: 2,  prevYear: year     },
        6: { label: 'Q2', startMonth: 3, endMonth: 5,  prevYear: year     },
        9: { label: 'Q3', startMonth: 6, endMonth: 8,  prevYear: year     },
      };

      const q = quarterMap[month];
      if (!q) {
        logger.warn('CRON: Quarterly invoice triggered in unexpected month:', month);
        return;
      }

      const result = await generateQuarterlyInvoice({
        quarter_label:  q.label,
        start_month:    q.startMonth,
        end_month:      q.endMonth,
        year:           q.prevYear,
        // Invoice components:
        // 1. Sourcing fee: 1.8% of disbursements in the quarter
        // 2. Tech fee: ₹50,000/month × 3 = ₹1,50,000
        // 3. GST: 18% on both
        tech_fee_per_month: parseInt(process.env.LSP_TECH_FEE_MONTHLY || '50000'),
        sourcing_fee_pct:   parseFloat(process.env.LSP_SOURCING_FEE_PCT || '1.8'),
      });

      logger.info('✅ CRON: Quarterly invoice generated', result);
    } catch (err) {
      logger.error('❌ CRON: Quarterly invoice failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── STUCK TRANSACTIONS: Every 2 hours ─────────────────────────
  // Catches transactions stuck in PRE_AUTHORISED for >30 minutes
  cron.schedule('0 */2 * * *', async () => {
    try {
      const { query } = require('../../config/database');
      const stuck = await query(`
        UPDATE transactions
        SET status = 'FAILED', updated_at = NOW()
        WHERE status = 'PRE_AUTHORISED'
          AND initiated_at < NOW() - INTERVAL '30 minutes'
        RETURNING transaction_id
      `);
      if (stuck.rows.length > 0) {
        logger.warn(`🔧 CRON: Resolved ${stuck.rows.length} stuck transaction(s)`);
      }
    } catch (err) {
      logger.error('❌ CRON: Stuck transaction resolution failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  // ── DAILY RECONCILIATION: 9am IST ─────────────────────────────
  cron.schedule('0 9 * * *', async () => {
    logger.info('⏰ CRON: Daily reconciliation triggered');
    try {
      const { query }  = require('../../config/database');

      // Update overdue statements
      await query(`
        UPDATE statements
        SET status = 'OVERDUE', updated_at = NOW()
        WHERE status = 'GENERATED'
          AND due_date < CURRENT_DATE
      `).catch(() => {});

      // Update overdue accounts
      await query(`
        UPDATE users
        SET account_status = 'OVERDUE', updated_at = NOW()
        WHERE user_id IN (
          SELECT DISTINCT ca.user_id
          FROM credit_accounts ca
          JOIN statements s ON s.account_id = ca.account_id
          WHERE s.status = 'OVERDUE' AND ca.account_status = 'CREDIT_ACTIVE'
        )
      `).catch(() => {});

      logger.info('✅ CRON: Daily reconciliation complete');
    } catch (err) {
      logger.error('❌ CRON: Reconciliation failed:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });

  logger.info('✅ All cron jobs scheduled');
};

module.exports = { startCronJobs };
