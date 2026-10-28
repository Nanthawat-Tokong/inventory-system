-- Migration: เพิ่มบทบาท "พนักงานจัดส่ง" (shipper)
-- แยกหน้าที่: admin/main_manager คลังหลัก = อนุมัติ, shipper (ต้องสังกัดคลังหลัก) = จัดส่ง / ส่งของชดเชย
--   mysql -u root -p inventory_db < migration_add_shipper_role.sql
ALTER TABLE users
  MODIFY role ENUM('admin', 'main_manager', 'staff', 'shipper') NOT NULL DEFAULT 'staff';
