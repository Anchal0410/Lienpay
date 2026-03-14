const { body } = require('express-validator');

// ─────────────────────────────────────────────────────────────
// VALIDATION RULES
// Using express-validator for clean, declarative validation
// ─────────────────────────────────────────────────────────────

const sendOTPValidation = [
  body('mobile')
    .trim()
    .notEmpty().withMessage('Mobile number is required')
    .isLength({ min: 10, max: 10 }).withMessage('Mobile must be exactly 10 digits')
    .matches(/^[6-9][0-9]{9}$/).withMessage('Invalid Indian mobile number (must start with 6-9)'),
];

const verifyOTPValidation = [
  body('mobile')
    .trim()
    .notEmpty().withMessage('Mobile number is required')
    .isLength({ min: 10, max: 10 }).withMessage('Mobile must be exactly 10 digits')
    .matches(/^[6-9][0-9]{9}$/).withMessage('Invalid Indian mobile number'),

  body('otp')
    .trim()
    .notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must contain only numbers'),
];

const panValidation = [
  body('pan')
    .trim()
    .notEmpty().withMessage('PAN number is required')
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).withMessage('Invalid PAN format (e.g., ABCDE1234F)'),

  body('full_name')
    .trim()
    .notEmpty().withMessage('Full name is required')
    .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),

  body('date_of_birth')
    .notEmpty().withMessage('Date of birth is required')
    .isISO8601().withMessage('Date must be in YYYY-MM-DD format')
    .custom((dob) => {
      const birthDate = new Date(dob);
      const today     = new Date();
      const age = (today - birthDate) / (365.25 * 24 * 60 * 60 * 1000);
      if (age < 18) throw new Error('You must be at least 18 years old');
      if (age > 100) throw new Error('Invalid date of birth');
      return true;
    }),

  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Invalid email address')
    .normalizeEmail(),
];

module.exports = {
  sendOTPValidation,
  verifyOTPValidation,
  panValidation,
};
