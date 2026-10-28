// ============================================================
// alertRoutes.js — กำหนด route สำหรับจัดการกฎแจ้งเตือนสต๊อกต่ำ
// URL prefix: /api/alerts (กำหนดใน server.js)
// มี 2 โหมด: Dashboard (กรองเฉพาะสินค้าที่ต่ำกว่า threshold) และ Settings (ทุกกฎ)
// ============================================================

const express = require('express');
const router  = express.Router();

// นำ controller functions มาใช้
// getAll      — สำหรับ Dashboard: คืนเฉพาะสินค้าที่สต๊อกต่ำกว่า threshold
// getSettings — สำหรับหน้า Settings: คืนกฎทุกอัน (ไม่กรองตามสต๊อก)
// create      — สร้างกฎแจ้งเตือนใหม่ (หรืออัปเดตถ้ามีอยู่แล้ว)
// update      — แก้ไข min_quantity หรือ is_active ของกฎ
// remove      — ลบกฎ
const { getAll, getSettings, create, update, remove } = require('../controllers/alertController');

// auth — ตรวจสอบ token, role — ตรวจสอบสิทธิ์
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');

// ─── Route definitions ───────────────────────────────────────
// หมายเหตุสำคัญ: /settings ต้องประกาศก่อน /:id
// เพราะถ้าประกาศ /:id ก่อน Express จะตีความ "settings" เป็น id แทน

// GET /api/alerts/settings — ดึงกฎทั้งหมด สำหรับหน้าตั้งค่า
// admin และ main_manager ดูได้
router.get('/settings', auth, role('admin', 'main_manager'), getSettings);

// GET /api/alerts — ดึงเฉพาะสินค้าที่สต๊อกต่ำกว่า products.low_stock_threshold
// ใช้ใน Dashboard เพื่อแสดงแจ้งเตือน ทุก role ดูได้
router.get('/',         auth, role('admin', 'main_manager', 'staff', 'shipper'), getAll);

// POST /api/alerts — สร้างกฎแจ้งเตือนใหม่ (หรือ upsert ถ้ามีอยู่แล้ว)
// admin และ main_manager ทำได้
router.post('/',        auth, role('admin', 'main_manager'), create);

// PUT /api/alerts/:id — แก้ไขกฎตาม id (เปลี่ยน min_quantity หรือ is_active)
// admin และ main_manager ทำได้ (main_manager แก้ได้เฉพาะกฎของสาขาตัวเอง — controller ตรวจสอบ)
router.put('/:id',      auth, role('admin', 'main_manager'), update);

// DELETE /api/alerts/:id — ลบกฎตาม id
// admin และ main_manager ทำได้ (main_manager ลบได้เฉพาะกฎของสาขาตัวเอง — controller ตรวจสอบ)
router.delete('/:id',   auth, role('admin', 'main_manager'), remove);

module.exports = router;
