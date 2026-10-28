-- Migration: เพิ่ม soft delete support ในตาราง products
-- รัน 1 ครั้งบนฐานข้อมูลที่มีอยู่แล้ว:
--   mysql -u root -p inventory_db < migration_add_soft_delete.sql

ALTER TABLE products
  ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0
  AFTER low_stock_threshold;

-- Safety: อัปเดตแถวเก่าที่อาจมี is_deleted = NULL
-- (เกิดขึ้นได้ถ้า MySQL version เก่าไม่ backfill DEFAULT อัตโนมัติ)
UPDATE products SET is_deleted = 0 WHERE is_deleted IS NULL;

-- ตรวจสอบผล:
-- DESCRIBE products;
-- ต้องเห็น is_deleted | tinyint(1) | NO | | 0 |
-- SELECT id, name, is_deleted FROM products;
-- ทุกแถวต้องมี is_deleted = 0 (ไม่ใช่ NULL)
