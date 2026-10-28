-- Migration: workflow ใบขอเบิก v2 + ลบสาขาแบบซ่อน
-- รัน 1 ครั้งบนฐานข้อมูลที่มีอยู่แล้ว:
--   mysql -u root -p inventory_db < migration_workflow_v2.sql
--
-- 1) branches.is_deleted — ลบสาขาแบบซ่อน (ไม่ลบประวัติรับ/ออก/ใบขอเบิกทิ้ง)
-- 2) requisition_items.defective_qty — จำนวนที่ได้รับแต่ชำรุด/บกพร่อง (ไม่เข้าสต๊อก)
-- 3) requisitions.dispute_state — สถานะย่อยของเคสที่มีปัญหา (status = 'disputed')
--      awaiting_response : สาขาแจ้งปัญหาแล้ว รอคลังหลักตอบกลับ
--      reshipping        : คลังหลักแจ้งว่ากำลังจัดส่งใหม่
--      awaiting_stock    : คลังหลักแจ้งว่าสต๊อกยังไม่พอ รอสินค้าเข้า
--      close_proposed    : คลังหลักขอปิดเคส รอสาขายืนยัน
--    ไม่มีฝ่ายไหนปิดเคสเองได้ฝ่ายเดียว — ต้องคลังหลักตอบกลับก่อน แล้วสาขายืนยันปิด
--    (หรือปิดอัตโนมัติเมื่อสาขารับของชดเชยครบ)
-- 4) requisition_events — ไทม์ไลน์/ข้อความโต้ตอบของใบขอเบิกแต่ละใบ
-- 5) index สำหรับคำนวณสต๊อกเร็วขึ้นเมื่อสินค้าเยอะ

ALTER TABLE branches
  ADD COLUMN is_deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER is_warehouse;

ALTER TABLE requisition_items
  ADD COLUMN defective_qty INT DEFAULT NULL AFTER received_qty;

ALTER TABLE requisitions
  ADD COLUMN dispute_state ENUM('awaiting_response','reshipping','awaiting_stock','close_proposed')
    NULL DEFAULT NULL AFTER status;

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

CREATE INDEX idx_tx_product_branch ON transactions (product_id, branch_id);

-- เคสที่มีปัญหาอยู่แล้วก่อน migration: ถือว่ารอคลังหลักตอบกลับ
UPDATE requisitions SET dispute_state = 'awaiting_response'
WHERE status = 'disputed' AND dispute_state IS NULL;
