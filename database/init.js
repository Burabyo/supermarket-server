import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'supermarket.db');
const db = new sqlite3.Database(dbPath);

export const initializeDatabase = async () => {
  return new Promise((resolve, reject) => {
    db.serialize(async () => {
      // Users table
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          role TEXT CHECK(role IN ('admin', 'manager', 'cashier')) NOT NULL,
          avatar TEXT,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Products table
      db.run(`
        CREATE TABLE IF NOT EXISTS products (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          barcode TEXT UNIQUE NOT NULL,
          category TEXT NOT NULL,
          price DECIMAL(10,2) NOT NULL,
          stock INTEGER NOT NULL DEFAULT 0,
          min_stock INTEGER NOT NULL DEFAULT 0,
          expiry_date DATE,
          supplier TEXT,
          description TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Sales table
      db.run(`
        CREATE TABLE IF NOT EXISTS sales (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_number TEXT UNIQUE NOT NULL,
          cashier_id INTEGER NOT NULL,
          total DECIMAL(10,2) NOT NULL,
          payment_method TEXT CHECK(payment_method IN ('cash', 'card', 'debt', 'momo', 'airtel_money')) NOT NULL,
          customer_name TEXT,
          customer_phone TEXT,
          notes TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (cashier_id) REFERENCES users (id)
        )
      `);

      // Sale items table
      db.run(`
        CREATE TABLE IF NOT EXISTS sale_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          sale_id INTEGER NOT NULL,
          product_id INTEGER NOT NULL,
          quantity INTEGER NOT NULL,
          unit_price DECIMAL(10,2) NOT NULL,
          total_price DECIMAL(10,2) NOT NULL,
          FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
          FOREIGN KEY (product_id) REFERENCES products (id)
        )
      `);

      // Audit logs table
      db.run(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          action TEXT NOT NULL,
          table_name TEXT,
          record_id INTEGER,
          old_values TEXT,
          new_values TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users (id)
        )
      `);

      // Daily sales summary table
      db.run(`
        CREATE TABLE IF NOT EXISTS daily_sales_summary (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date DATE UNIQUE NOT NULL,
          total_sales DECIMAL(10,2) DEFAULT 0,
          cash_sales DECIMAL(10,2) DEFAULT 0,
          card_sales DECIMAL(10,2) DEFAULT 0,
          debt_sales DECIMAL(10,2) DEFAULT 0,
          momo_sales DECIMAL(10,2) DEFAULT 0,
          airtel_money_sales DECIMAL(10,2) DEFAULT 0,
          total_transactions INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Create default admin user
      const adminPassword = await bcrypt.hash('admin123', 10);
      db.run(`
        INSERT OR IGNORE INTO users (name, email, password, role) 
        VALUES ('System Admin', 'admin@supermarket.com', ?, 'admin')
      `, [adminPassword]);

      // Insert sample products
      const sampleProducts = [
        ['Coca Cola 500ml', '1234567890123', 'Beverages', 1.50, 100, 20, '2025-12-31', 'Coca Cola Company', 'Refreshing soft drink'],
        ['White Bread', '2345678901234', 'Bakery', 2.00, 50, 10, '2025-02-15', 'Local Bakery', 'Fresh white bread loaf'],
        ['Milk 1L', '3456789012345', 'Dairy', 3.50, 30, 5, '2025-02-10', 'Dairy Farm', 'Fresh whole milk'],
        ['Rice 5kg', '4567890123456', 'Pantry', 15.00, 25, 5, '2026-01-01', 'Rice Mills', 'Premium long grain rice'],
        ['Chicken Breast 1kg', '5678901234567', 'Meat', 12.00, 20, 3, '2025-01-25', 'Poultry Farm', 'Fresh chicken breast']
      ];

      const insertProduct = db.prepare(`
        INSERT OR IGNORE INTO products (name, barcode, category, price, stock, min_stock, expiry_date, supplier, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      sampleProducts.forEach(product => {
        insertProduct.run(product);
      });

      insertProduct.finalize();

      console.log('✅ Database initialized successfully');
      resolve();
    });
  });
};

export { db };