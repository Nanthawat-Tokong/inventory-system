-- Migration: add low_stock_threshold to products table
-- Run once on an existing database:
--   mysql -u root -p inventory_db < migration_add_low_stock_threshold.sql

ALTER TABLE products
  ADD COLUMN low_stock_threshold INT NOT NULL DEFAULT 50
  AFTER unit;
