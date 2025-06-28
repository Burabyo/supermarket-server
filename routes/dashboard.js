import express from 'express';
import { db } from '../database/init.js';

const router = express.Router();

// Get dashboard statistics
router.get('/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const queries = {
    totalProducts: 'SELECT COUNT(*) as count FROM products',
    lowStockProducts: 'SELECT COUNT(*) as count FROM products WHERE stock <= min_stock',
    expiringProducts: `SELECT COUNT(*) as count FROM products WHERE DATE(expiry_date) <= DATE('now', '+7 days')`,
    todaySales: `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) = ?`,
    weekSales: `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) >= ?`,
    monthSales: `SELECT COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) >= ?`,
    totalSales: 'SELECT COALESCE(SUM(total), 0) as total FROM sales'
  };

  const stats = {};
  let completedQueries = 0;
  const totalQueries = Object.keys(queries).length;

  Object.entries(queries).forEach(([key, query]) => {
    const params = [];
    if (key === 'todaySales') params.push(today);
    else if (key === 'weekSales') params.push(weekAgo);
    else if (key === 'monthSales') params.push(monthAgo);

    db.get(query, params, (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      stats[key] = result.count !== undefined ? result.count : result.total;
      completedQueries++;

      if (completedQueries === totalQueries) {
        res.json({
          success: true,
          data: stats
        });
      }
    });
  });
});

// Get recent sales
router.get('/recent-sales', (req, res) => {
  const limit = req.query.limit || 10;

  db.all(
    `SELECT s.*, u.name as cashier_name 
     FROM sales s 
     JOIN users u ON s.cashier_id = u.id 
     ORDER BY s.created_at DESC 
     LIMIT ?`,
    [limit],
    (err, sales) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      res.json({
        success: true,
        data: sales
      });
    }
  );
});

// Get low stock products
router.get('/low-stock', (req, res) => {
  db.all(
    'SELECT * FROM products WHERE stock <= min_stock ORDER BY stock ASC',
    (err, products) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      res.json({
        success: true,
        data: products
      });
    }
  );
});

// Get expiring products
router.get('/expiring', (req, res) => {
  db.all(
    `SELECT * FROM products 
     WHERE DATE(expiry_date) <= DATE('now', '+7 days') 
     AND DATE(expiry_date) >= DATE('now')
     ORDER BY expiry_date ASC`,
    (err, products) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      res.json({
        success: true,
        data: products
      });
    }
  );
});

// Get sales by payment method (for charts)
router.get('/sales-by-payment', (req, res) => {
  const { period = '30' } = req.query;
  const daysAgo = new Date(Date.now() - parseInt(period) * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  db.all(
    `SELECT payment_method, COUNT(*) as count, SUM(total) as total
     FROM sales 
     WHERE DATE(created_at) >= ?
     GROUP BY payment_method`,
    [daysAgo],
    (err, results) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      res.json({
        success: true,
        data: results
      });
    }
  );
});

export default router;