import express from 'express';
import { db } from '../database/init.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get audit logs (admin only)
router.get('/', requireRole(['admin']), (req, res) => {
  const { limit = 50, offset = 0, user_id, action, start_date, end_date } = req.query;
  
  let query = `
    SELECT al.*, u.name as user_name, u.email as user_email
    FROM audit_logs al
    JOIN users u ON al.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (user_id) {
    query += ' AND al.user_id = ?';
    params.push(user_id);
  }

  if (action) {
    query += ' AND al.action LIKE ?';
    params.push(`%${action}%`);
  }

  if (start_date) {
    query += ' AND DATE(al.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(al.created_at) <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, logs) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM audit_logs al
      WHERE 1=1
    `;
    const countParams = [];

    if (user_id) {
      countQuery += ' AND al.user_id = ?';
      countParams.push(user_id);
    }

    if (action) {
      countQuery += ' AND al.action LIKE ?';
      countParams.push(`%${action}%`);
    }

    if (start_date) {
      countQuery += ' AND DATE(al.created_at) >= ?';
      countParams.push(start_date);
    }

    if (end_date) {
      countQuery += ' AND DATE(al.created_at) <= ?';
      countParams.push(end_date);
    }

    db.get(countQuery, countParams, (err, countResult) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            total: countResult.total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            hasMore: countResult.total > parseInt(offset) + parseInt(limit)
          }
        }
      });
    });
  });
});

export default router;