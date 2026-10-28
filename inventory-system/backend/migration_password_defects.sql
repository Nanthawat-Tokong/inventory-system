-- Migration: เปลี่ยนรหัสผ่านเอง + บันทึกการจัดการของชำรุด
--   mysql -u root -p inventory_db < migration_password_defects.sql

-- 1 = ต้องเปลี่ยนรหัสผ่านก่อนใช้งาน (ตั้งเมื่อ admin สร้างบัญชี / รีเซ็ตรหัสให้)
ALTER TABLE users
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash;

-- ของชำรุดที่สาขาแจ้งตอนตรวจรับ ต้องมีบันทึกว่าไปไหน:
--   write_off = ตัดทิ้งที่สาขา (จบทันที)
--   return    = ให้สาขาส่งคืนคลังหลัก (รอคลังหลักยืนยันว่าได้รับคืน)
-- ของชำรุดไม่เคยเข้าสต๊อกใคร ตารางนี้จึงไม่กระทบยอดสต๊อก แค่บอกว่าของที่หายไปจากคลังหลักไปอยู่ที่ไหน
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
