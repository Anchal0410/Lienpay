const { body } = require('express-validator');

const profileValidation = [
  body('pan')
    .trim().notEmpty().withMessage('PAN is required')
    .toUpperCase()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).withMessage('Invalid PAN format (e.g. ABCDE1234F)'),
  body('full_name')
    .trim().notEmpty().withMessage('Full name is required')
    .isLength({ min: 2, max: 255 }).withMessage('Name must be 2-255 characters'),
  body('date_of_birth')
    .notEmpty().withMessage('Date of birth is required')
    .isISO8601().withMessage('Date must be YYYY-MM-DD')
    .custom(dob => {
      const age = (Date.now() - new Date(dob)) / (365.25 * 24 * 3600 * 1000);
      if (age < 18) throw new Error('Must be at least 18 years old');
      if (age > 100) throw new Error('Invalid date of birth');
      return true;
    }),
  body('email').optional().trim().isEmail().withMessage('Invalid email'),
];

const aadhaarOTPValidation = [
  body('aadhaar_last4')
    .trim().notEmpty().withMessage('Last 4 digits of Aadhaar required')
    .isLength({ min: 4, max: 4 }).withMessage('Must be exactly 4 digits')
    .isNumeric().withMessage('Must be numeric'),
  body('consent_given')
    .equals('true').withMessage('Aadhaar KYC consent is required'),
];

const aadhaarVerifyValidation = [
  body('txn_id').notEmpty().withMessage('Transaction ID is required'),
  body('otp')
    .trim().notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must be numeric'),
];

module.exports = { profileValidation, aadhaarOTPValidation, aadhaarVerifyValidation };
