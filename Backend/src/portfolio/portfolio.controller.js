const { validationResult } = require('express-validator');
const portfolioService = require('./portfolio.service');
const { success, error, validationError, serverError } = require('../utils/response');
const { hash } = require('../utils/encryption');
const { logger } = require('../../config/logger');

// POST /api/portfolio/aa/consent
const initiateConsent = async (req, res) => {
  try {
    const user   = await require('../../config/database').query(
      'SELECT mobile FROM users WHERE user_id=$1', [req.user.user_id]
    );
    const result = await portfolioService.initiateAAConsent({
      userId: req.user.user_id,
      mobile: user.rows[0]?.mobile,
      ipHash: hash(req.ip),
    });
    return success(res, result, 'Account Aggregator consent initiated');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('initiateConsent error:', err);
    return serverError(res);
  }
};

// POST /api/portfolio/fetch
const fetchPortfolio = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());
  try {
    const result = await portfolioService.fetchAndProcessPortfolio({
      userId:    req.user.user_id,
      consentId: req.body.consent_id,
    });
    return success(res, result, 'Portfolio fetched and processed successfully');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('fetchPortfolio error:', err);
    return serverError(res);
  }
};

// POST /api/portfolio/save-holdings  (DEV/DEMO ONLY — blocked in production)
const saveHoldings = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return validationError(res, errors.array());
  try {
    const result = await portfolioService.saveBulkHoldings(req.user.user_id, req.body.holdings);
    return success(res, result, 'Holdings saved (dev mode)');
  } catch (err) {
    if (err.statusCode) return error(res, err.message, err.statusCode);
    logger.error('saveHoldings error:', err);
    return serverError(res);
  }
};

// GET /api/portfolio/summary
const getSummary = async (req, res) => {
  try {
    const result = await portfolioService.getPortfolioSummary(req.user.user_id);
    return success(res, result);
  } catch (err) {
    logger.error('getSummary error:', err);
    return serverError(res);
  }
};

module.exports = { initiateConsent, fetchPortfolio, saveHoldings, getSummary };
