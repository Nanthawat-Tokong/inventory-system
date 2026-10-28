// ============================================================
// productRoutes.js — กำหนด route สำหรับจัดการสินค้า (Product)
// URL prefix: /api/products (กำหนดใน server.js)
// ทุก route ต้อง login ก่อน (auth middleware)
// แก้ไข/เพิ่ม/ลบ สินค้าได้เฉพาะ admin เท่านั้น
// ============================================================

const express = require('express');
const router = express.Router();

// นำ controller functions ทั้ง 5 มาใช้
const { getAll, getOne, create, update, remove } = require('../controllers/productController');

// auth  — middleware ตรวจสอบ token (ต้อง login)
const auth = require('../middleware/authMiddleware');

// role  — middleware ตรวจสอบ role (สิทธิ์)
const role = require('../middleware/roleMiddleware');

// ─── Route definitions ───────────────────────────────────────

// GET /api/products — ดึงสินค้าทั้งหมด
// ทุก role ที่ login แล้วดูได้ (auth เท่านั้น ไม่มี role restriction)
router.get('/', auth, getAll);

// GET /api/products/:id — ดึงสินค้าตัวเดียวตาม id
// ทุก role ที่ login แล้วดูได้
router.get('/:id', auth, getOne);

// POST /api/products — สร้างสินค้าใหม่
// เฉพาะ admin และ main_manager (staff เพิ่มสินค้าไม่ได้)
router.post('/', auth, role('admin', 'main_manager'), create);

// PUT /api/products/:id — แก้ไขข้อมูลสินค้าตาม id
// เฉพาะ admin และ main_manager
router.put('/:id', auth, role('admin', 'main_manager'), update);

// DELETE /api/products/:id — ลบสินค้าตาม id
// เฉพาะ admin และ main_manager
router.delete('/:id', auth, role('admin', 'main_manager'), remove);

module.exports = router;
