// ============================================================
// branchRoutes.js — กำหนด route สำหรับจัดการสาขา (Branch)
// URL prefix: /api/branches (กำหนดใน server.js)
// ดูรายชื่อสาขา: ทุก role ที่ login ดูได้
// เพิ่ม/แก้ไข/ลบ สาขา: เฉพาะ admin
// ============================================================

const express = require('express');
const router = express.Router();

// นำ controller functions มาใช้
const { getAll, create, update, remove } = require('../controllers/branchController');

// auth — ตรวจสอบ token, role — ตรวจสอบสิทธิ์
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');

// ─── Route definitions ───────────────────────────────────────

// GET /api/branches — ดึงรายชื่อสาขา
// ทุก role ดูได้ (ใช้สำหรับ dropdown เลือกสาขาในหน้าต่างๆ)
// หมายเหตุ: admin เห็นทุกสาขา, manager/staff เห็นแค่สาขาตัวเอง (controller จัดการ)
router.get('/', auth, getAll);

// POST /api/branches — สร้างสาขาใหม่
// เฉพาะ admin เท่านั้น
router.post('/', auth, role('admin'), create);

// PUT /api/branches/:id — แก้ไขข้อมูลสาขาตาม id
// เฉพาะ admin เท่านั้น
router.put('/:id', auth, role('admin'), update);

// DELETE /api/branches/:id — ลบสาขาตาม id
// เฉพาะ admin เท่านั้น
router.delete('/:id', auth, role('admin'), remove);

module.exports = router;
