const express = require('express');
const router  = express.Router();
const { query }  = require('../../config/database');
const { success, error, serverError } = require('../utils/response');
const { authenticate } = require('../middleware/auth.middleware');
const { logger } = require('../../config/logger');

router.use(authenticate);

/**
 * GET /api/notifications
 * Returns the last 20 in-app notifications for the user,
 * newest first. Used by the notification bell in the app header.
 */
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT notification_id, type, channel, status,
             content_preview, sent_at, created_at,
             read_at
      FROM notifications
      WHERE user_id = $1
        AND channel = 'PUSH'
      ORDER BY created_at DESC
      LIMIT 20
    `, [req.user.user_id]);

    // Count unread
    const unread = result.rows.filter(n => !n.read_at).length;

    return success(res, {
      notifications: result.rows,
      unread_count:  unread,
    });
  } catch (err) {
    logger.error('getNotifications error:', err);
    return serverError(res);
  }
});

/**
 * POST /api/notifications/:id/read
 * Mark a single notification as read.
 */
router.post('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;

    await query(`
      UPDATE notifications
      SET read_at = NOW()
      WHERE notification_id = $1
        AND user_id = $2
        AND read_at IS NULL
    `, [id, req.user.user_id]);

    return success(res, { read: true });
  } catch (err) {
    return serverError(res);
  }
});

/**
 * POST /api/notifications/read-all
 * Mark all notifications as read.
 */
router.post('/read-all', async (req, res) => {
  try {
    await query(`
      UPDATE notifications
      SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL
    `, [req.user.user_id]);

    return success(res, { read: true });
  } catch (err) {
    return serverError(res);
  }
});

module.exports = router;
