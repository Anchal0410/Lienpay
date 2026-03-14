const axios  = require('axios');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// SMS SERVICE
// Mode controlled by SMS_MODE env var: "mock" | "real"
// To go live: set SMS_MODE=real and add MSG91_API_KEY in .env
// ─────────────────────────────────────────────────────────────

const TEMPLATES = {
  OTP_SEND: {
    id:      process.env.MSG91_TEMPLATE_OTP,
    message: (otp) => `${otp} is your LienPay OTP. Valid for 10 minutes. Do not share with anyone. - LNPAY`,
  },
  TXN_SUCCESS: {
    id:      process.env.MSG91_TEMPLATE_TXN_SUCCESS,
    message: (data) => `LienPay: Rs ${data.amount} paid to ${data.merchant}. Available credit: Rs ${data.available}. Ref: ${data.utr}`,
  },
  PAYMENT_DUE_7D: {
    id:      process.env.MSG91_TEMPLATE_PAYMENT_DUE,
    message: (data) => `LienPay: Rs ${data.amount} due on ${data.date}. Pay in full to keep interest-free period. Pay: lienpay.app/repay`,
  },
  PAYMENT_DUE_1D: {
    id:      process.env.MSG91_TEMPLATE_PAYMENT_DUE,
    message: (data) => `LienPay: Rs ${data.amount} due TOMORROW (${data.date}). Pay now to avoid interest. - LNPAY`,
  },
  MARGIN_CALL: {
    id:      process.env.MSG91_TEMPLATE_MARGIN_CALL,
    message: (data) => `LienPay ALERT: Portfolio value dropped. Margin call issued. Action required by ${data.deadline}. Login to LienPay immediately.`,
  },
  PLEDGE_INVOCATION_NOTICE: {
    id:      process.env.MSG91_TEMPLATE_MARGIN_CALL,
    message: (data) => `LienPay: Formal notice — pledge invocation in ${data.days} business days if dues unpaid. Outstanding: Rs ${data.amount}. Login now.`,
  },
  NPA_WARNING: {
    id:      process.env.MSG91_TEMPLATE_MARGIN_CALL,
    message: (data) => `LienPay: Account overdue ${data.days} days. Credit bureau reporting on ${data.date}. Pay Rs ${data.amount} immediately.`,
  },
  KYC_VERIFIED: {
    id:      process.env.MSG91_TEMPLATE_OTP,
    message: () => `LienPay: Your KYC has been successfully verified. Proceed to link your mutual fund portfolio. - LNPAY`,
  },
  CREDIT_ACTIVATED: {
    id:      process.env.MSG91_TEMPLATE_OTP,
    message: (data) => `LienPay: Credit line of Rs ${data.limit} is now active. UPI ID: ${data.vpa}. Scan any QR to pay. - LNPAY`,
  },
};

// ── MOCK SMS (development) ────────────────────────────────────
const sendMock = async (mobile, templateKey, variables = {}) => {
  const template = TEMPLATES[templateKey];
  const message  = template ? template.message(variables) : `LienPay notification to ${mobile}`;

  logger.info('📱 [SMS MOCK]', {
    to:       mobile,
    template: templateKey,
    message,
  });

  // In development, also log OTP to console so you can test
  if (templateKey === 'OTP_SEND' && variables.otp) {
    console.log('\n' + '─'.repeat(50));
    console.log(`📱 OTP for ${mobile}: ${variables.otp}`);
    console.log('─'.repeat(50) + '\n');
  }

  return { success: true, mock: true, message_id: `MOCK_${Date.now()}` };
};

// ── REAL SMS via MSG91 ────────────────────────────────────────
const sendReal = async (mobile, templateKey, variables = {}) => {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown SMS template: ${templateKey}`);

  try {
    // MSG91 API v5
    const response = await axios.post(
      'https://api.msg91.com/api/v5/flow',
      {
        template_id: template.id,
        sender:      process.env.MSG91_SENDER_ID || 'LNPAY',
        short_url:   '0',
        mobiles:     `91${mobile}`,
        ...variables,
      },
      {
        headers: {
          authkey:        process.env.MSG91_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    logger.info('SMS sent via MSG91', {
      mobile,
      template: templateKey,
      response: response.data,
    });

    return { success: true, message_id: response.data?.request_id };
  } catch (err) {
    logger.error('MSG91 SMS failed', { mobile, templateKey, error: err.message });
    throw new Error(`SMS delivery failed: ${err.message}`);
  }
};

// ── PUBLIC SEND FUNCTION ──────────────────────────────────────
const sendSMS = async (mobile, templateKey, variables = {}) => {
  const mode = process.env.SMS_MODE || 'mock';

  try {
    const result = mode === 'real'
      ? await sendReal(mobile, templateKey, variables)
      : await sendMock(mobile, templateKey, variables);

    audit('SMS_SENT', null, {
      mobile:   mobile.slice(-4).padStart(10, '*'), // mask mobile
      template: templateKey,
      mode,
      success:  result.success,
    });

    return result;
  } catch (err) {
    logger.error('SMS send failed', { mobile, templateKey, error: err.message });
    return { success: false, error: err.message };
  }
};

module.exports = { sendSMS, TEMPLATES };
