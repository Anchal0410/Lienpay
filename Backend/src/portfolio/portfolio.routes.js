const express    = require('express');
const router     = express.Router();
const { body }   = require('express-validator');
const controller = require('./portfolio.controller');
const { authenticate, requireKYC } = require('../middleware/auth.middleware');

router.use(authenticate);
router.use(requireKYC); // KYC must be complete before portfolio linking

/**
 * POST /api/portfolio/aa/consent
 * Initiate AA consent flow. Returns redirect URL to AA app.
 */
router.post('/aa/consent', controller.initiateConsent);

/**
 * POST /api/portfolio/fetch
 * Fetch portfolio data after user approves AA consent.
 * Body: { consent_id }
 */
router.post('/fetch',
  [body('consent_id').notEmpty().withMessage('consent_id is required')],
  controller.fetchPortfolio
);

/**
 * GET /api/portfolio/summary
 * Get current portfolio summary with eligible credit amounts.
 */
router.get('/summary', controller.getSummary);

module.exports = router;
