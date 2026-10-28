// ============================================================
// userRoutes.js — กำหนด route สำหรับจัดการผู้ใช้งาน
// URL prefix: /api/users (กำหนดใน server.js)
// ทุก route จำกัดให้เฉพาะ admin เท่านั้น
// ============================================================

const express = require('express');
const router = express.Router();

// นำ controller functions มาใช้
// getAll — ดึงรายชื่อ user ทั้งหมด
// create — สร้าง user ใหม่ (hash password ด้วย bcrypt)
// update — แก้ไขข้อมูล user (password optional)
// remove — ลบ user
const { getAll, create, update, remove } = require('../controllers/userController');

// auth — ตรวจสอบ token, role — ตรวจสอบสิทธิ์
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');

// ─── Route definitions ───────────────────────────────────────
// ทุก route ต้องผ่าน auth (มี token) และ role('admin') (เป็น admin เท่านั้น)

// GET /api/users — ดึงรายชื่อ user ทั้งหมด พร้อม branch_name
router.get('/', auth, role('admin'), getAll);

// POST /api/users — สร้าง user ใหม่ (backend จะ hash password ก่อนบันทึก)
router.post('/', auth, role('admin'), create);

// PUT /api/users/:id — แก้ไขข้อมูล user ตาม id
// ถ้าส่ง password มาจะ hash ใหม่, ถ้าไม่ส่งจะไม่เปลี่ยน password เดิม
router.put('/:id', auth, role('admin'), update);

// DELETE /api/users/:id — ลบ user ตาม id
router.delete('/:id', auth, role('admin'), remove);

module.exports = router;
