import express from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all users (admin and manager only)
router.get('/', requireRole(['admin', 'manager']), (req, res) => {
  db.all(
    'SELECT id, name, email, role, is_active, created_at FROM users ORDER BY created_at DESC',
    (err, users) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      res.json({
        success: true,
        data: users
      });
    }
  );
});

// Get user profile
router.get('/profile', (req, res) => {
  db.get(
    'SELECT id, name, email, role, created_at FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      res.json({
        success: true,
        data: user
      });
    }
  );
});

// Update user status (admin only)
router.patch('/:id/status', requireRole(['admin']), (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  db.run(
    'UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [is_active, id],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Log the action
      db.run(
        'INSERT INTO audit_logs (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)',
        [req.user.id, 'UPDATE_USER_STATUS', 'users', id]
      );

      res.json({
        success: true,
        message: 'User status updated successfully'
      });
    }
  );
});

export default router;