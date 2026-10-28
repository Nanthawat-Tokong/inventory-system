// ============================================================
// authRoutes.js — กำหนด route สำหรับการ login และตรวจสอบตัวตน
// URL prefix: /api/auth (กำหนดใน server.js)
// ============================================================

// express.Router() คือตัวสร้าง "mini app" สำหรับจัดกลุ่ม route
// แต่ละ route file ใช้ Router แยกกัน แล้วนำไป mount ใน server.js
const express = require('express');
const router = express.Router();

// นำ controller functions มาใช้
// login  — จัดการการ login และออก token
// getMe  — ดึงข้อมูล user ปัจจุบันจาก token
const { login, getMe, changePassword } = require('../controllers/authController');

// auth คือ middleware ตรวจสอบ token (authMiddleware.js)
const auth = require('../middleware/authMiddleware');

// ─── Route definitions ───────────────────────────────────────

// POST /api/auth/login — รับ email + password, ตรวจสอบ, คืน token
// ไม่ต้องใช้ middleware auth เพราะนี่คือหน้า login (ยังไม่มี token)
router.post('/login', login);

// GET /api/auth/me — ดึงข้อมูล user ปัจจุบัน
// ต้องผ่าน auth middleware ก่อน (ตรวจว่ามี token ถูกต้อง)
// ใช้เช็คว่า session ยังอยู่หรือไม่ หลังจาก page refresh
router.get('/me', auth, getMe);

// PUT /api/auth/password — เปลี่ยนรหัสผ่านของตัวเอง (ทุกคน)
router.put('/password', auth, changePassword);

module.exports = router;
