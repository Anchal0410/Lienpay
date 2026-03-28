const express    = require('express');
const router     = express.Router();
const { body }   = require('express-validator');
const controller = require('./portfolio.controller');
const { authenticate, requireKYC } = require('../middleware/auth.middleware');

router.use(authenticate);
router.use(requireKYC);

/**
 * POST /api/portfolio/aa/consent
 * Step 1: Initiate AA consent flow.
 * Mock mode: returns a mock consent_id instantly (no redirect needed).
 * Real mode: returns a redirect_url to the AA app for user approval.
 */
router.post('/aa/consent', controller.initiateConsent);

/**
 * POST /api/portfolio/fetch
 * Step 2: Fetch and process portfolio after AA consent is approved.
 * Backend handles: AA data fetch → live NAV lookup → classify → LTV → save to DB.
 * Both mock and real flows go through this same path.
 * Body: { consent_id }
 */
router.post('/fetch',
  [body('consent_id').notEmpty().withMessage('consent_id is required')],
  controller.fetchPortfolio
);

/**
 * POST /api/portfolio/save-holdings
 * ⚠ DEV / DEMO ONLY — disabled in production (NODE_ENV=production).
 * Allows seeding holdings directly without going through the AA consent flow.
 * Used during development and investor demos.
 * Body: { holdings: [...] }
 */
router.post('/save-holdings',
  [body('holdings').isArray({ min: 1 }).withMessage('holdings array required')],
  controller.saveHoldings
);

/**
 * GET /api/portfolio/summary
 * Get current portfolio summary + all holdings for the authenticated user.
 */
router.get('/summary', controller.getSummary);

module.exports = router;
