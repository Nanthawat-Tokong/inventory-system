// ============================================================
// inventoryRoutes.js — กำหนด route สำหรับจัดการสต๊อกสินค้า
// URL prefix: /api/inventory (กำหนดใน server.js)
// ทุก route ต้อง login ก่อน (auth middleware)
// staff ดูสต๊อก/ประวัติได้อย่างเดียว ไม่มีสิทธิ์บันทึกรับ/ออกสินค้าโดยตรง
// ============================================================

const express = require('express');
const router = express.Router();

// นำ controller functions มาใช้
// receive      — บันทึกการรับสินค้าเข้า
// issue        — บันทึกการออกสินค้า
// getAllStock   — ดูสต๊อกปัจจุบันทุกสินค้าทุกสาขา
// getBranchStock — ดูสต๊อกเฉพาะสาขาเดียว
// getHistory   — ดูประวัติ transaction
const { receive, issue, getAllStock, getBranchStock, getHistory } = require('../controllers/inventoryController');

// auth — ตรวจสอบ token, role — ตรวจสอบสิทธิ์
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');

// ─── Route definitions ───────────────────────────────────────

// POST /api/inventory/receive — บันทึกการรับสินค้าเข้า "คลังหลัก" เท่านั้น
// เฉพาะ admin, main_manager เท่านั้น (staff ห้ามรับสินค้าตรงเด็ดขาด ต้องผ่านใบขอเบิกเท่านั้น
// ดู requisitionRoutes.js — controller (inventoryController.js#receive) ยังบังคับว่าต้องเป็น
// คลังหลักด้วย ป้องกันแม้แต่ admin/main_manager รับเข้าตรงเข้าสาขาย่อย)
router.post('/receive', auth, role('admin', 'main_manager'), receive);

// POST /api/inventory/issue — บันทึกการออกสินค้า
// admin, main_manager ออกได้ทุกสาขา; staff ออกได้เฉพาะสาขาตัวเองเท่านั้น
// (controller บังคับ branch_id = สาขาของ user เสมอสำหรับ non-admin — ดู inventoryController.js#issue)
// ใช้บันทึกขาย/เบิกใช้งาน/ของเสียหายที่สาขาตัวเอง — ต่างจากรับเข้าที่ staff ห้ามทำเด็ดขาด
router.post('/issue', auth, role('admin', 'main_manager', 'staff'), issue);

// GET /api/inventory/stock — ดูสต๊อกปัจจุบันทุกสินค้า
// ทุก role ดูได้ (admin เห็นทุกสาขา, main_manager/staff เห็นสาขาตัวเอง)
router.get('/stock', auth, role('admin', 'main_manager', 'staff', 'shipper'), getAllStock);

// GET /api/inventory/stock/:branchId — ดูสต๊อกเฉพาะสาขาที่ระบุ
// ทุก role ดูได้ แต่ controller จะตรวจสอบว่า non-admin เข้าถึงสาขาตัวเองเท่านั้น
router.get('/stock/:branchId', auth, getBranchStock);

// GET /api/inventory/history — ดูประวัติ transaction ย้อนหลัง
// ทุก role ดูได้ (admin เห็นทุกสาขา, main_manager/staff เห็นสาขาตัวเอง)
router.get('/history', auth, getHistory);

module.exports = router;
