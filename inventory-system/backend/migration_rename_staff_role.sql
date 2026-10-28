-- Migration: rename branch_staff role to staff, tighten staff permissions
--   admin        — ทำได้ทุกอย่าง (ไม่เปลี่ยนแปลง)
--   main_manager — เหมือน admin แต่เฉพาะสาขาคลังหลัก (ไม่เปลี่ยนแปลง)
--   staff        — เดิมชื่อ branch_staff: สร้างใบขอเบิก + ยืนยันรับสินค้าของตัวเอง + ดูสต๊อกได้
--                  (ตัดสิทธิ์บันทึกรับ/ออกสินค้าโดยตรง — ต้องผ่านใบขอเบิกเท่านั้น ดู inventoryRoutes.js)
--
-- Run once:
--   mysql -u root -p inventory_db < migration_rename_staff_role.sql
--
-- IMPORTANT: back up first, e.g.
--   mysqldump -u root -p inventory_db > backup_pre_staff_rename.sql

-- Step 1: widen the ENUM to include both old and new values so existing rows
-- stay valid while we remap them (MySQL rejects/truncates values dropped from
-- an ENUM if any row still holds them).
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','main_manager','branch_staff','staff')
  NOT NULL DEFAULT 'staff';

-- Step 2: remap existing branch_staff users to staff
UPDATE users
SET role = 'staff'
WHERE role = 'branch_staff';

-- Step 3: narrow the ENUM to the final 3 values, default staff
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','main_manager','staff')
  NOT NULL DEFAULT 'staff';

-- Verification (run manually):
--   SELECT role, COUNT(*) FROM users GROUP BY role;
--   SHOW COLUMNS FROM users LIKE 'role';
