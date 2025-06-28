import express from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init.js';
import { requireRole } from '../middleware/auth.js';

const router = express.Router();

// Get all products
router.get('/', (req, res) => {
  const { search, category, low_stock } = req.query;
  let query = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (name LIKE ? OR barcode LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }

  if (low_stock === 'true') {
    query += ' AND stock <= min_stock';
  }

  query += ' ORDER BY name';

  db.all(query, params, (err, products) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    res.json({
      success: true,
      data: products
    });
  });
});

// Get product by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM products WHERE id = ?', [id], (err, product) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    res.json({
      success: true,
      data: product
    });
  });
});

// Create new product (admin and manager only)
router.post('/', requireRole(['admin', 'manager']), [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('barcode').trim().notEmpty().withMessage('Barcode is required'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('stock').isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  body('min_stock').isInt({ min: 0 }).withMessage('Minimum stock must be a non-negative integer')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { name, barcode, category, price, stock, min_stock, expiry_date, supplier, description } = req.body;

  db.run(
    `INSERT INTO products (name, barcode, category, price, stock, min_stock, expiry_date, supplier, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, barcode, category, price, stock, min_stock, expiry_date, supplier, description],
    function(err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          return res.status(400).json({ 
            success: false, 
            message: 'Product with this barcode already exists' 
          });
        }
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      // Log the action
      db.run(
        'INSERT INTO audit_logs (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)',
        [req.user.id, 'CREATE_PRODUCT', 'products', this.lastID]
      );

      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: { id: this.lastID }
      });
    }
  );
});

// Update product (admin and manager only)
router.put('/:id', requireRole(['admin', 'manager']), [
  body('name').trim().notEmpty().withMessage('Product name is required'),
  body('category').trim().notEmpty().withMessage('Category is required'),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('stock').isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),
  body('min_stock').isInt({ min: 0 }).withMessage('Minimum stock must be a non-negative integer')
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { id } = req.params;
  const { name, category, price, stock, min_stock, expiry_date, supplier, description } = req.body;

  db.run(
    `UPDATE products 
     SET name = ?, category = ?, price = ?, stock = ?, min_stock = ?, 
         expiry_date = ?, supplier = ?, description = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name, category, price, stock, min_stock, expiry_date, supplier, description, id],
    function(err) {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Product not found' });
      }

      // Log the action
      db.run(
        'INSERT INTO audit_logs (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)',
        [req.user.id, 'UPDATE_PRODUCT', 'products', id]
      );

      res.json({
        success: true,
        message: 'Product updated successfully'
      });
    }
  );
});

// Delete product (admin only)
router.delete('/:id', requireRole(['admin']), (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM products WHERE id = ?', [id], function(err) {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    if (this.changes === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Log the action
    db.run(
      'INSERT INTO audit_logs (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)',
      [req.user.id, 'DELETE_PRODUCT', 'products', id]
    );

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  });
});

export default router;