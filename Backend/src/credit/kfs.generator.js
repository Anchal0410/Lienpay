const PDFDocument = require('pdfkit');
const { query }   = require('../../config/database');

// ─────────────────────────────────────────────────────────────
// KFS PDF GENERATOR
// Key Fact Statement — RBI mandated for all digital lending
// Must include: lender name, limit, APR, all fees, cooling-off
// Generated on NBFC letterhead
// ─────────────────────────────────────────────────────────────

const generateKFS = async (userId, sanctionData) => {
  return new Promise(async (resolve, reject) => {
    try {
      const user = await query(
        'SELECT full_name, pan_last4, date_of_birth FROM users WHERE user_id = $1',
        [userId]
      );
      const u = user.rows[0];

      const doc    = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ── HEADER ──────────────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold')
         .text(process.env.NBFC_NAME || 'FinServNBFC Ltd.', { align: 'center' });
      doc.fontSize(14).font('Helvetica-Bold')
         .text('KEY FACT STATEMENT (KFS)', { align: 'center' });
      doc.fontSize(10).font('Helvetica')
         .text('(As per RBI Digital Lending Guidelines, 2022)', { align: 'center' });
      doc.moveDown(0.5);

      // ── DIVIDER ──────────────────────────────────────────────
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);

      // ── BORROWER DETAILS ─────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('BORROWER DETAILS');
      doc.moveDown(0.3);
      addRow(doc, 'Name',           u.full_name || 'As per KYC');
      addRow(doc, 'PAN',            `XXXXXX${u.pan_last4 || 'XXXX'}`);
      addRow(doc, 'KFS Date',       new Date().toLocaleDateString('en-IN'));
      addRow(doc, 'KFS Version',    process.env.KFS_VERSION || 'v1.0');
      doc.moveDown(0.5);

      // ── LOAN DETAILS ─────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('CREDIT LINE DETAILS');
      doc.moveDown(0.3);
      addRow(doc, 'Product Name',         'Loan Against Mutual Funds — Overdraft (OD)');
      addRow(doc, 'Lender Name',          process.env.NBFC_NAME || 'FinServNBFC Ltd.');
      addRow(doc, 'LSP Name',             'Lienzo (Arthastra Innovations Pvt Ltd)');
      addRow(doc, 'Sanction ID',          sanctionData.sanction_id);
      addRow(doc, 'Sanctioned Limit',     `₹${sanctionData.approved_limit?.toLocaleString('en-IN')}`);
      addRow(doc, 'Credit Line Type',     'Revolving Overdraft (OD)');
      addRow(doc, 'Tenure',               'Open-ended (subject to annual review)');
      doc.moveDown(0.5);

      // ── INTEREST DETAILS ─────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('INTEREST & CHARGES');
      doc.moveDown(0.3);
      addRow(doc, 'Annual Percentage Rate (APR)', `${sanctionData.apr}% per annum`);
      addRow(doc, 'Interest-Free Period',          '30 days from each drawdown (if repaid in full)');
      addRow(doc, 'Interest Calculation',          'Daily reducing balance (simple interest)');
      addRow(doc, 'Interest Charged On',           'Amount utilised × days used × (APR/365)');
      addRow(doc, 'Processing Fee',                '₹0 (Nil)');
      addRow(doc, 'Annual Maintenance Fee',        '₹0 (Nil)');
      addRow(doc, 'Prepayment Penalty',            'Nil — repay anytime without charges');
      addRow(doc, 'Late Payment Fee',              '₹500 per month after due date');
      addRow(doc, 'Penal Interest',                '2% per month on overdue amount');
      doc.moveDown(0.5);

      // ── COLLATERAL DETAILS ───────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('COLLATERAL (PLEDGE)');
      doc.moveDown(0.3);
      addRow(doc, 'Type of Collateral',   'Mutual Fund Units (lien marked)');
      addRow(doc, 'LTV — Equity Funds',   '40% of current NAV value');
      addRow(doc, 'LTV — Debt Funds',     '80% of current NAV value');
      addRow(doc, 'Margin Call Trigger',  'When LTV breaches 90% of sanctioned limit');
      addRow(doc, 'Margin Call Notice',   '3 business days to restore LTV');
      addRow(doc, 'Pledge Invocation',    'After 3 business days without resolution');
      doc.moveDown(0.5);

      // ── COOLING-OFF PERIOD ───────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('COOLING-OFF PERIOD (RBI Mandate)');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica')
         .text('You have 3 days from today to cancel this credit line without any charges. No questions asked. To cancel, go to LienPay app → Profile → Cancel Credit Line or call our grievance helpline.', {
           width: 495, align: 'justify',
         });
      addRow(doc, 'Cooling-Off Expires', new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN'));
      doc.moveDown(0.5);

      // ── GRIEVANCE ────────────────────────────────────────────
      doc.fontSize(11).font('Helvetica-Bold').text('GRIEVANCE REDRESSAL');
      doc.moveDown(0.3);
      addRow(doc, 'LSP Helpline',         'support@lienpay.in | 1800-XXX-XXXX');
      addRow(doc, 'NBFC Grievance',       `grievance@${(process.env.NBFC_NAME || 'finservnbfc').toLowerCase().replace(/\s/g,'')}.com`);
      addRow(doc, 'Nodal Officer',        'Available on NBFC website');
      addRow(doc, 'RBI Ombudsman',        'cms.rbi.org.in');
      addRow(doc, 'Resolution Timeline',  '30 days from complaint date');
      doc.moveDown(0.5);

      // ── DECLARATION ──────────────────────────────────────────
      doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica').fillColor('#666666')
         .text('I/We have read and understood the above Key Fact Statement. I/We accept the terms and conditions of the credit facility.', {
           width: 495, align: 'justify',
         });
      doc.moveDown(1.5);
      doc.text('Borrower Signature: ____________________          Date: ____________');
      doc.moveDown(2);
      doc.fontSize(8).fillColor('#999999')
         .text(`Generated by LienPay (Lienzo / Arthastra Innovations Pvt Ltd) | KFS v${process.env.KFS_VERSION || '1.0'} | ${new Date().toISOString()}`, { align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};

// Helper to add a label:value row
const addRow = (doc, label, value) => {
  const startY = doc.y;
  doc.fontSize(10).font('Helvetica-Bold').text(`${label}:`, 50, startY, { width: 200, continued: false });
  doc.fontSize(10).font('Helvetica').text(value || 'N/A', 260, startY, { width: 280 });
  doc.moveDown(0.2);
};

module.exports = { generateKFS };
