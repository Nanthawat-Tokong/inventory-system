-- Migration: add replacement shipment flow for disputed requisitions
-- Run once on an existing database:
--   mysql -u root -p inventory_db < migration_add_replacement_shipments.sql

CREATE TABLE IF NOT EXISTS replacement_shipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requisition_id INT NOT NULL,
  status ENUM('preparing','shipped','received') NOT NULL DEFAULT 'preparing',
  note TEXT,
  created_by INT NOT NULL,
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
