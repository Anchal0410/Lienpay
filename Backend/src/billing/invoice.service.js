const { query }  = require('../../config/database');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// LSP INVOICE SERVICE
//
// LienPay earns commission from NBFC as an LSP:
// - Sourcing commission: ~1.8% of each drawdown
// - Monthly tech fee: ₹50,000 fixed
//
// Invoice raised to NBFC at end of each month.
// GST: 18% on commission income.
// ─────────────────────────────────────────────────────────────

const GST_RATE      = 0.18;
const TECH_FEE      = 50000; // ₹50,000/month fixed
const COMMISSION_RATE = 0.018; // 1.8% of drawdowns

// ── GENERATE MONTHLY LSP INVOICE ─────────────────────────────
const generateMonthlyInvoice = async (month, year) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0);

  logger.info(`📄 Generating LSP invoice for ${month}/${year}`);

  // Get all settled transactions for the month
  const txnRes = await query(`
    SELECT
      COUNT(*) as txn_count,
      COALESCE(SUM(amount), 0) as total_drawdowns
    FROM transactions
    WHERE status = 'SETTLED'
      AND settled_at BETWEEN $1 AND $2
  `, [startDate, endDate]);

  // Get new accounts activated this month
  const newAccounts = await query(`
    SELECT COUNT(*) as count
    FROM credit_accounts
    WHERE status = 'ACTIVE'
      AND activated_at BETWEEN $1 AND $2
  `, [startDate, endDate]);

  const totalDrawdowns  = parseFloat(txnRes.rows[0].total_drawdowns);
  const txnCount        = parseInt(txnRes.rows[0].txn_count);
  const sourcingCommission = totalDrawdowns * COMMISSION_RATE;
  const subtotal        = sourcingCommission + TECH_FEE;
  const gst             = subtotal * GST_RATE;
  const totalAmount     = subtotal + gst;

  // Generate invoice number
  const invoiceNumber = `LP-INV-${year}-${String(month).padStart(2, '0')}-001`;

  // Store invoice
  const invoiceRes = await query(`
    INSERT INTO lsp_invoices (
      invoice_number, invoice_date, period_start, period_end,
      total_transactions, total_drawdown_value,
      sourcing_commission_rate, sourcing_commission_amount,
      tech_fee, subtotal, gst_rate, gst_amount,
      total_amount, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'GENERATED')
    ON CONFLICT (invoice_number) DO UPDATE SET
      total_transactions       = EXCLUDED.total_transactions,
      total_drawdown_value     = EXCLUDED.total_drawdown_value,
      sourcing_commission_amount = EXCLUDED.sourcing_commission_amount,
      total_amount             = EXCLUDED.total_amount,
      updated_at               = NOW()
    RETURNING invoice_id
  `, [
    invoiceNumber,
    new Date(),
    startDate, endDate,
    txnCount, totalDrawdowns,
    COMMISSION_RATE, sourcingCommission,
    TECH_FEE, subtotal,
    GST_RATE, gst,
    totalAmount,
  ]);

  audit('LSP_INVOICE_GENERATED', 'system', {
    invoice_number: invoiceNumber,
    total_amount:   totalAmount,
    month, year,
  });

  return {
    invoice_id:      invoiceRes.rows[0].invoice_id,
    invoice_number:  invoiceNumber,
    period:          `${startDate.toLocaleDateString('en-IN')} - ${endDate.toLocaleDateString('en-IN')}`,
    transactions:    txnCount,
    total_drawdowns: Math.round(totalDrawdowns),
    sourcing_commission: parseFloat(sourcingCommission.toFixed(2)),
    tech_fee:        TECH_FEE,
    subtotal:        parseFloat(subtotal.toFixed(2)),
    gst:             parseFloat(gst.toFixed(2)),
    total_amount:    parseFloat(totalAmount.toFixed(2)),
    new_accounts:    parseInt(newAccounts.rows[0].count),
  };
};

// ── GET INVOICE HISTORY ───────────────────────────────────────
const getInvoiceHistory = async () => {
  const result = await query(`
    SELECT invoice_id, invoice_number, invoice_date,
           period_start, period_end, total_transactions,
           total_drawdown_value, total_amount, status
    FROM lsp_invoices
    ORDER BY invoice_date DESC
    LIMIT 12
  `);
  return result.rows;
};

module.exports = { generateMonthlyInvoice, getInvoiceHistory };
