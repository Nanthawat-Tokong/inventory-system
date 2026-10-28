-- Centralized Inventory Management System - Database Schema
-- Run: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS inventory_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE inventory_db;

-- 1. branches
CREATE TABLE IF NOT EXISTS branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  location VARCHAR(255),
  is_warehouse TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = สาขานี้คือคลังหลัก/สต๊อกใหญ่ ที่รับใบขอเบิกจากสาขาอื่น
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,    -- 1 = ลบแบบซ่อน (เก็บประวัติไว้)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. users
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 0,  -- 1 = ต้องเปลี่ยนรหัสก่อนใช้งาน
  role ENUM('admin', 'main_manager', 'staff', 'shipper') NOT NULL DEFAULT 'staff',  -- shipper = พนักงานจัดส่ง (สังกัดคลังหลัก)
  branch_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL
);

-- 3. products
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  sku VARCHAR(50) UNIQUE NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'ชิ้น',
  low_stock_threshold INT NOT NULL DEFAULT 50,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. transactions
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
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tx_product_branch (product_id, branch_id)
);

-- 5. alerts
CREATE TABLE IF NOT EXISTS alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  branch_id INT NOT NULL,
  min_quantity INT NOT NULL DEFAULT 10,          -- เกณฑ์ขั้นต่ำเฉพาะสาขานี้ (แทนค่ากลาง products.low_stock_threshold)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_alert_product_branch (product_id, branch_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

-- 6. requisitions (ใบขอเบิก) — สร้างโดยสาขา, พิจารณาโดยคลังหลัก (branches.is_warehouse = 1)
CREATE TABLE IF NOT EXISTS requisitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,                 -- สาขาที่ขอเบิก
  status ENUM('pending','rejected','approved','shipped','disputed','completed')
    NOT NULL DEFAULT 'pending',
  -- สถานะย่อยตอน disputed: รอคลังหลักตอบ / กำลังจัดส่งใหม่ / สต๊อกไม่พอรอของเข้า / คลังหลักขอปิดเคส รอสาขายืนยัน
  dispute_state ENUM('awaiting_response','reshipping','awaiting_stock','close_proposed') NULL DEFAULT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  note TEXT,
  reject_reason TEXT,
  approved_by INT DEFAULT NULL,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (branch_id)   REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by)  REFERENCES users(id)    ON DELETE CASCADE,
  FOREIGN KEY (approved_by) REFERENCES users(id)    ON DELETE SET NULL
);

-- 7. requisition_items — รายการสินค้าในแต่ละใบขอเบิก
CREATE TABLE IF NOT EXISTS requisition_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT NOT NULL,
  product_id INT NOT NULL,
  requested_qty INT NOT NULL,
  approved_qty INT DEFAULT NULL,
  shipped_qty INT DEFAULT NULL,
  received_qty INT DEFAULT NULL,      -- ได้รับสภาพดี (เข้าสต๊อก) สะสมทุกรอบ
  defective_qty INT DEFAULT NULL,     -- ได้รับแต่ชำรุด/บกพร่อง (ไม่เข้าสต๊อก)
  FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)     REFERENCES products(id)     ON DELETE CASCADE
);

-- 8. shipments — การจัดส่งของใบขอเบิกที่อนุมัติแล้ว (1 ใบขอเบิก : 1 shipment)
CREATE TABLE IF NOT EXISTS shipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT NOT NULL,
  shipped_at TIMESTAMP NULL DEFAULT NULL,
  received_at TIMESTAMP NULL DEFAULT NULL,
  status ENUM('preparing','shipped','received_ok','received_issue')
    NOT NULL DEFAULT 'preparing',
  note TEXT,
  issue_note TEXT,
  shipped_by INT DEFAULT NULL,
  received_by INT DEFAULT NULL,
  FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY (shipped_by)     REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (received_by)    REFERENCES users(id) ON DELETE SET NULL
);

-- 9. branch_products — กำหนดว่าสินค้าตัวไหนเปิดใช้งาน (active) ให้สาขาไหนบ้าง
-- main_manager เป็นคนกำหนด mapping นี้ (เพิ่ม/เอาออกสินค้าจากสาขา) โดยไม่กระทบ catalog กลาง
-- สาขา (staff) จะเห็น/ขอเบิกได้เฉพาะสินค้าที่ is_active = 1 ของสาขาตัวเองเท่านั้น, admin เห็นสินค้าทั้งหมดเสมอ
CREATE TABLE IF NOT EXISTS branch_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,
  product_id INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_branch_product (branch_id, product_id),
  FOREIGN KEY (branch_id)  REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- 10. replacement_shipments — จัดส่งชดเชยสำหรับใบขอเบิกที่สถานะ disputed (ได้รับไม่ครบ/เสียหายระหว่างขนส่ง)
-- สร้างโดย admin/main_manager ของคลังหลัก ครอบคลุมจำนวนที่ "ขาด" (shipped - received) ของรอบก่อนหน้า
-- 1 ใบขอเบิกมีได้หลาย replacement_shipments (เผื่อกรณีชดเชยแล้วยังขาดอีก)
CREATE TABLE IF NOT EXISTS replacement_shipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT NOT NULL,
  status ENUM('preparing','shipped','received') NOT NULL DEFAULT 'preparing',
  note TEXT,
  created_by INT NOT NULL,              -- ผู้สร้างรายการชดเชย (admin/main_manager)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  shipped_at TIMESTAMP NULL DEFAULT NULL,
  shipped_by INT DEFAULT NULL,
  received_at TIMESTAMP NULL DEFAULT NULL,
  received_by INT DEFAULT NULL,
  FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by)     REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (shipped_by)     REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (received_by)    REFERENCES users(id) ON DELETE SET NULL
);

-- 11. replacement_shipment_items — รายการสินค้าต่อ replacement_shipment
-- replacement_qty บันทึกตอนสร้าง (<= จำนวนที่ขาด ณ ขณะนั้น), received_qty บันทึกตอนสาขายืนยันรับของชดเชย
CREATE TABLE IF NOT EXISTS replacement_shipment_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  replacement_shipment_id INT NOT NULL,
  requisition_item_id INT NOT NULL,
  product_id INT NOT NULL,
  replacement_qty INT NOT NULL,
  received_qty INT DEFAULT NULL,
  FOREIGN KEY (replacement_shipment_id) REFERENCES replacement_shipments(id) ON DELETE CASCADE,
  FOREIGN KEY (requisition_item_id)     REFERENCES requisition_items(id)     ON DELETE CASCADE,
  FOREIGN KEY (product_id)              REFERENCES products(id)              ON DELETE CASCADE
);

-- 12. requisition_events — ไทม์ไลน์/ข้อความโต้ตอบระหว่างสาขากับคลังหลักของใบขอเบิกแต่ละใบ
CREATE TABLE IF NOT EXISTS requisition_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT NOT NULL,
  user_id INT NULL,
  type VARCHAR(40) NOT NULL,
  message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_req_events (requisition_id, id),
  FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)        REFERENCES users(id)        ON DELETE SET NULL
);

-- 13. defect_records — ของชำรุดที่สาขาแจ้ง ถูกตัดทิ้งที่สาขา หรือส่งคืนคลังหลัก (ไม่กระทบยอดสต๊อก)
CREATE TABLE IF NOT EXISTS defect_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT NOT NULL,
  requisition_item_id INT NOT NULL,
  product_id INT NOT NULL,
  branch_id INT NOT NULL,
  qty INT NOT NULL,
  action ENUM('write_off','return') NOT NULL,
  status ENUM('pending','done') NOT NULL DEFAULT 'pending',
  note TEXT,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  done_by INT NULL,
  done_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_defect_req (requisition_id),
  FOREIGN KEY (requisition_id)      REFERENCES requisitions(id)      ON DELETE CASCADE,
  FOREIGN KEY (requisition_item_id) REFERENCES requisition_items(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)          REFERENCES products(id),
  FOREIGN KEY (branch_id)           REFERENCES branches(id),
  FOREIGN KEY (created_by)          REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (done_by)             REFERENCES users(id) ON DELETE SET NULL
);

-- View: current stock per branch
CREATE OR REPLACE VIEW current_stock AS
SELECT
  product_id,
  branch_id,
  SUM(CASE WHEN type = 'receive' THEN quantity ELSE -quantity END) AS stock
FROM transactions
GROUP BY product_id, branch_id;

-- ─────────────────────────────────────────────
-- Seed data
-- ─────────────────────────────────────────────

-- Branches (สาขาสำนักงานใหญ่ ตั้งเป็นคลังหลักที่รับใบขอเบิกจากสาขาอื่น)
INSERT INTO branches (name, location, is_warehouse) VALUES
  ('สาขาสำนักงานใหญ่', 'กรุงเทพฯ', 1),
  ('สาขาเชียงใหม่', 'เชียงใหม่', 0),
  ('สาขาภูเก็ต', 'ภูเก็ต', 0);

-- Users  (passwords are all "password123" — bcrypt hash rounds=10)
INSERT INTO users (name, email, password_hash, role, branch_id) VALUES
  ('Admin User',   'admin@inventory.com',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin',        NULL),
  ('Manager HQ',   'manager@inventory.com', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'main_manager', 1),
  ('Staff HQ',     'staff@inventory.com',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'staff', 1);

-- Products
INSERT INTO products (name, sku, category, unit) VALUES
  ('กระดาษ A4 80g',       'PAP-A4-80',  'เครื่องเขียน',  'รีม'),
  ('ปากกาลูกลื่น สีน้ำเงิน', 'PEN-BALL-BL', 'เครื่องเขียน',  'ด้าม'),
  ('แฟ้มเอกสาร A4',        'FILE-A4',    'เครื่องเขียน',  'อัน'),
  ('หมึกพริ้นเตอร์ดำ',      'INK-BLK-01', 'อุปกรณ์สำนักงาน', 'ตลับ'),
  ('กระดาษโน้ต Post-it',   'NOTE-POST',  'เครื่องเขียน',  'แพ็ค');

-- Sample transactions (receive stock into HQ branch)
INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES
  (1, 1, 2, 'receive', 50,  50,  'รับสต็อกเริ่มต้น'),
  (2, 1, 2, 'receive', 100, 100, 'รับสต็อกเริ่มต้น'),
  (3, 1, 2, 'receive', 30,  30,  'รับสต็อกเริ่มต้น'),
  (4, 1, 2, 'receive', 20,  20,  'รับสต็อกเริ่มต้น'),
  (5, 1, 2, 'receive', 40,  40,  'รับสต็อกเริ่มต้น'),
  (1, 1, 3, 'issue',   5,   45,  'เบิกใช้งาน'),
  (2, 1, 3, 'issue',   10,  90,  'เบิกใช้งาน'),
  (1, 2, 2, 'receive', 25,  25,  'รับสต็อกสาขาเชียงใหม่'),
  (2, 2, 2, 'receive', 50,  50,  'รับสต็อกสาขาเชียงใหม่');

-- Alerts (low-stock thresholds)
INSERT INTO alerts (product_id, branch_id, min_quantity) VALUES
  (1, 1, 10),
  (2, 1, 20),
  (4, 1, 5),
  (1, 2, 5);

-- Branch products (ค่าเริ่มต้น: เปิดใช้งานสินค้าทั้งหมดให้ทุกสาขา — main_manager ปรับทีหลังได้)
INSERT INTO branch_products (branch_id, product_id, is_active)
SELECT b.id, p.id, 1 FROM branches b, products p;
