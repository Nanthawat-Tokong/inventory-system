-- Migration: กฎแจ้งเตือน 1 สินค้า ต่อ 1 สาขา มีได้กฎเดียว
-- (กฎนี้ถูกใช้เป็น "เกณฑ์ขั้นต่ำเฉพาะสาขา" แทนค่ากลางของสินค้า — ถ้าซ้ำจะทำให้ข้อมูลสต๊อกแสดงซ้ำ)
ALTER TABLE alerts ADD UNIQUE KEY uniq_alert_product_branch (product_id, branch_id);
