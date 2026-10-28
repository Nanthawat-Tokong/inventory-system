-- Migration: add branch_products table (branch ↔ product availability mapping)
-- Run once on an existing database:
--   mysql -u root -p inventory_db < migration_add_branch_products.sql

CREATE TABLE IF NOT EXISTS branch_products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  branch_id INT NOT NULL,
  product_id INT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uniq_branch_product (branch_id, product_id),
  FOREIGN KEY (branch_id)  REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

-- Backfill: mark every existing product as active for every existing branch,
-- so staff requisition forms/product lists keep showing what they already see today.
-- main_manager can narrow this down per branch afterwards via the branch-products screen.
INSERT INTO branch_products (branch_id, product_id, is_active)
SELECT b.id, p.id, 1
FROM branches b
JOIN products p ON 1=1
ON DUPLICATE KEY UPDATE is_active = is_active;
