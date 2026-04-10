const express = require('express');
const router  = express.Router();
const { query }  = require('../../config/database');
const { success, error, serverError } = require('../utils/response');
const { authenticate } = require('../middleware/auth.middleware');
const { logger, audit } = require('../../config/logger');

router.use(authenticate);

/**
 * POST /api/users/apr-product
 * Store user's APR product choice during onboarding.
 * Called from APRChoiceStep.jsx before credit activation.
 * Body: { apr_product: 'STANDARD' | 'REVOLVING' }
 */
router.post('/apr-product', async (req, res) => {
  try {
    const { apr_product } = req.body;
    const valid = ['STANDARD', 'REVOLVING'];

    if (!apr_product || !valid.includes(apr_product)) {
      return error(res, `apr_product must be one of: ${valid.join(', ')}`, 400);
    }

    await query(
      `UPDATE users SET apr_product_choice = $2, updated_at = NOW() WHERE user_id = $1`,
      [req.user.user_id, apr_product]
    );

    audit('APR_PRODUCT_CHOSEN', req.user.user_id, { apr_product });

    return success(res, {
      apr_product,
      apr:     apr_product === 'REVOLVING' ? 18.00 : 12.00,
      message: `APR product set to ${apr_product}`,
    }, 'APR product saved');
  } catch (err) {
    logger.error('setAprProduct error:', err);
    return serverError(res);
  }
});

/**
 * GET /api/users/profile
 * Get current user's profile including APR product choice.
 */
router.get('/profile', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.user_id, u.mobile, u.full_name, u.pan_last4,
             u.kyc_status, u.account_status, u.onboarding_step,
             u.apr_product_choice, u.ckyc_id,
             ca.credit_limit, ca.available_credit, ca.outstanding,
             ca.apr, ca.apr_product, ca.upi_vpa, ca.status as credit_status,
             ca.ltv_ratio, ca.ltv_alert_level, ca.upi_active
      FROM users u
      LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      WHERE u.user_id = $1
    `, [req.user.user_id]);

    if (!result.rows.length) return error(res, 'User not found', 404);

    const user = result.rows[0];

    // Mask mobile for display
    user.mobile_masked = `+91 XXXXX${user.mobile?.slice(-5) || ''}`;
    delete user.mobile;

    return success(res, user);
  } catch (err) {
    logger.error('getProfile error:', err);
    return serverError(res);
  }
});

module.exports = router;
