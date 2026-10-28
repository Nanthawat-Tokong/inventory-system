-- Migration: stock requisition workflow (ใบขอเบิก)
-- Adds a "main warehouse" flag to branches, plus requisitions / requisition_items / shipments.
-- All foreign keys use CASCADE or SET NULL (never RESTRICT) so every row stays
-- deletable by hand from phpMyAdmin without hitting a constraint error.
--
-- Run once:
--   mysql -u root -p inventory_db < migration_requisitions.sql

ALTER TABLE branches
  ADD COLUMN is_warehouse TINYINT(1) NOT NULL DEFAULT 0 AFTER location;

-- requisitions (ใบขอเบิก) — created by a branch, actioned by the main warehouse
CREATE TABLE IF NOT EXISTS requisitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,                 -- สาขาที่ขอเบิก
  status ENUM('pending','rejected','approved','shipped','issue_reported','completed')
    NOT NULL DEFAULT 'pending',
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

-- requisition_items — line items of a requisition
CREATE TABLE IF NOT EXISTS requisition_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT NOT NULL,
  product_id INT NOT NULL,
  requested_qty INT NOT NULL,
  approved_qty INT DEFAULT NULL,
  received_qty INT DEFAULT NULL,
  FOREIGN KEY (requisition_id) REFERENCES requisitions(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)     REFERENCES products(id)     ON DELETE CASCADE
);

-- shipments — one shipment per approved requisition
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

-- Mark the HQ / main branch as the warehouse that fulfils requisitions.
-- Adjust the WHERE clause if your main branch has a different name.
UPDATE branches SET is_warehouse = 1
WHERE name IN ('สาขาหลัก', 'สาขาสำนักงานใหญ่')
ORDER BY id LIMIT 1;
