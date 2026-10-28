-- Migration: redesign role system
--   admin        — ทำได้ทุกอย่าง (อนุมัติ/ปฏิเสธใบขอเบิก, เพิ่มสินค้า, จัดการผู้ใช้)
--   main_manager — เหมือน admin แต่เฉพาะสาขาคลังหลัก (branches.is_warehouse = 1):
--                  เพิ่มสินค้าได้, อนุมัติ/ปฏิเสธใบขอเบิกได้, จัดการผู้ใช้ไม่ได้
--   branch_staff — สร้างใบขอเบิกและบันทึกรับสินค้าให้สาขาตัวเองเท่านั้น, เพิ่มสินค้าไม่ได้
--
-- Run once:
--   mysql -u root -p inventory_db < migration_role_redesign.sql
--
-- IMPORTANT: back up first, e.g.
--   mysqldump -u root -p inventory_db > backup_pre_role_migration.sql

-- Step 1: widen the ENUM to include both old and new values so existing rows
-- stay valid while we remap them (MySQL rejects/truncates values dropped from
-- an ENUM if any row still holds them).
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','manager','staff','main_manager','branch_staff')
  NOT NULL DEFAULT 'staff';

-- Step 2: 'manager' users at the main-warehouse branch become main_manager
UPDATE users u
  JOIN branches b ON b.id = u.branch_id
SET u.role = 'main_manager'
WHERE u.role = 'manager' AND b.is_warehouse = 1;

-- Step 3: every remaining 'manager' or 'staff' user becomes branch_staff
UPDATE users
SET role = 'branch_staff'
WHERE role IN ('manager', 'staff');

-- Step 4: narrow the ENUM to the final 3 values, default branch_staff
ALTER TABLE users
  MODIFY COLUMN role ENUM('admin','main_manager','branch_staff')
  NOT NULL DEFAULT 'branch_staff';

-- Note: `branches.is_warehouse` is the single source of truth for "main branch"
-- (not a hardcoded branch id). There is no DB constraint forcing exactly one
-- warehouse branch — enforced at the application layer instead (branchController
-- clears the flag on every other branch when one is set), since a partial/unique
-- index for a single boolean flag is more machinery than the invariant needs.

-- Verification (run manually):
--   SELECT role, COUNT(*) FROM users GROUP BY role;
--   SELECT COUNT(*) FROM branches WHERE is_warehouse = 1;  -- should be exactly 1
--   SHOW COLUMNS FROM users LIKE 'role';
