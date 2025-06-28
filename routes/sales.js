import express from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init.js';

const router = express.Router();

// Get all sales
router.get('/', (req, res) => {
  const { start_date, end_date, cashier_id, payment_method } = req.query;
  let query = `
    SELECT s.*, u.name as cashier_name 
    FROM sales s 
    JOIN users u ON s.cashier_id = u.id 
    WHERE 1=1
  `;
  const params = [];

  if (start_date) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(end_date);
  }

  if (cashier_id) {
    query += ' AND s.cashier_id = ?';
    params.push(cashier_id);
  }

  if (payment_method) {
    query += ' AND s.payment_method = ?';
    params.push(payment_method);
  }

  query += ' ORDER BY s.created_at DESC';

  db.all(query, params, (err, sales) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error' });
    }

    res.json({
      success: true,
      data: sales
    });
  });
});

// Get sale by ID with items
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT s.*, u.name as cashier_name 
     FROM sales s 
     JOIN users u ON s.cashier_id = u.id 
     WHERE s.id = ?`,
    [id],
    (err, sale) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!sale) {
        return res.status(404).json({ success: false, message: 'Sale not found' });
      }

      // Get sale items
      db.all(
        `SELECT si.*, p.name as product_name, p.barcode 
         FROM sale_items si 
         JOIN products p ON si.product_id = p.id 
         WHERE si.sale_id = ?`,
        [id],
        (err, items) => {
          if (err) {
            return res.status(500).json({ success: false, message: 'Database error' });
          }

          res.json({
            success: true,
            data: {
              ...sale,
              items
            }
          });
        }
      );
    }
  );
});

// Create new sale
router.post('/', [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.product_id').isInt().withMessage('Valid product ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('payment_method').isIn(['cash', 'card', 'debt', 'momo', 'airtel_money']).withMessage('Invalid payment method'),
  body('customer_name').optional().trim(),
  body('customer_phone').optional().trim()
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }

  const { items, payment_method, customer_name, customer_phone, notes } = req.body;

  // Generate receipt number
  const receiptNumber = `RCP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    let totalAmount = 0;
    let processedItems = 0;
    const saleItems = [];

    // Validate and calculate total
    items.forEach((item, index) => {
      db.get(
        'SELECT id, name, price, stock FROM products WHERE id = ?',
        [item.product_id],
        (err, product) => {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ success: false, message: 'Database error' });
          }

          if (!product) {
            db.run('ROLLBACK');
            return res.status(400).json({ 
              success: false, 
              message: `Product with ID ${item.product_id} not found` 
            });
          }

          if (product.stock < item.quantity) {
            db.run('ROLLBACK');
            return res.status(400).json({ 
              success: false, 
              message: `Insufficient stock for ${product.name}. Available: ${product.stock}, Requested: ${item.quantity}` 
            });
          }

          const itemTotal = product.price * item.quantity;
          totalAmount += itemTotal;

          saleItems.push({
            product_id: product.id,
            quantity: item.quantity,
            unit_price: product.price,
            total_price: itemTotal
          });

          processedItems++;

          // If all items processed, create the sale
          if (processedItems === items.length) {
            createSale();
          }
        }
      );
    });

    function createSale() {
      // Insert sale record
      db.run(
        `INSERT INTO sales (receipt_number, cashier_id, total, payment_method, customer_name, customer_phone, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [receiptNumber, req.user.id, totalAmount, payment_method, customer_name, customer_phone, notes],
        function(err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ success: false, message: 'Failed to create sale' });
          }

          const saleId = this.lastID;
          let itemsInserted = 0;

          // Insert sale items and update stock
          saleItems.forEach(saleItem => {
            // Insert sale item
            db.run(
              `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, total_price)
               VALUES (?, ?, ?, ?, ?)`,
              [saleId, saleItem.product_id, saleItem.quantity, saleItem.unit_price, saleItem.total_price],
              (err) => {
                if (err) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ success: false, message: 'Failed to create sale items' });
                }

                // Update product stock
                db.run(
                  'UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                  [saleItem.quantity, saleItem.product_id],
                  (err) => {
                    if (err) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ success: false, message: 'Failed to update stock' });
                    }

                    itemsInserted++;

                    // If all items processed, commit transaction
                    if (itemsInserted === saleItems.length) {
                      // Update daily sales summary
                      updateDailySummary(totalAmount, payment_method, () => {
                        db.run('COMMIT');

                        // Log the action
                        db.run(
                          'INSERT INTO audit_logs (user_id, action, table_name, record_id) VALUES (?, ?, ?, ?)',
                          [req.user.id, 'CREATE_SALE', 'sales', saleId]
                        );

                        res.status(201).json({
                          success: true,
                          message: 'Sale created successfully',
                          data: {
                            id: saleId,
                            receipt_number: receiptNumber,
                            total: totalAmount
                          }
                        });
                      });
                    }
                  }
                );
              }
            );
          });
        }
      );
    }

    function updateDailySummary(amount, paymentMethod, callback) {
      const today = new Date().toISOString().split('T')[0];
      const paymentColumn = `${paymentMethod}_sales`;

      db.run(
        `INSERT OR REPLACE INTO daily_sales_summary 
         (date, total_sales, ${paymentColumn}, total_transactions, updated_at)
         VALUES (
           ?,
           COALESCE((SELECT total_sales FROM daily_sales_summary WHERE date = ?), 0) + ?,
           COALESCE((SELECT ${paymentColumn} FROM daily_sales_summary WHERE date = ?), 0) + ?,
           COALESCE((SELECT total_transactions FROM daily_sales_summary WHERE date = ?), 0) + 1,
           CURRENT_TIMESTAMP
         )`,
        [today, today, amount, today, amount, today],
        callback
      );
    }
  });
});

// Get daily sales summary
router.get('/summary/daily', (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];

  db.get(
    'SELECT * FROM daily_sales_summary WHERE date = ?',
    [targetDate],
    (err, summary) => {
      if (err) {
        return res.status(500).json({ success: false, message: 'Database error' });
      }

      if (!summary) {
        // Return empty summary if no sales for the day
        summary = {
          date: targetDate,
          total_sales: 0,
          cash_sales: 0,
          card_sales: 0,
          debt_sales: 0,
          momo_sales: 0,
          airtel_money_sales: 0,
          total_transactions: 0
        };
      }

      res.json({
        success: true,
        data: summary
      });
    }
  );
});

export default router;