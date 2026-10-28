-- DEPRECATED: this copy is stale (missing is_warehouse, requisitions/requisition_items/
-- shipments, low_stock_threshold, is_deleted, and the current role ENUM). Do not use to
-- provision a database — use backend/schema.sql instead.

CREATE DATABASE IF NOT EXISTS inventory_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE inventory_db;

CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'manager', 'staff') DEFAULT 'staff',
  branch_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  sku VARCHAR(50) UNIQUE NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'ชิ้น',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  branch_id INT NOT NULL,
  user_id INT NOT NULL,
  type ENUM('receive', 'issue') NOT NULL,
  quantity INT NOT NULL,
  stock_after INT NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  branch_id INT NOT NULL,
  min_quantity INT NOT NULL DEFAULT 10,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id)
);

CREATE OR REPLACE VIEW current_stock AS
SELECT
  product_id,
  branch_id,
  SUM(CASE WHEN type = 'receive' THEN quantity ELSE -quantity END) AS stock
FROM transactions
GROUP BY product_id, branch_id;
