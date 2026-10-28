// ============================================================
// branchProductRoutes.js — กำหนด route สำหรับ mapping สินค้า ↔ สาขา
// URL prefix: /api/branch-products (กำหนดใน server.js)
// เฉพาะ admin และ main_manager เท่านั้นที่ดู/แก้ไข mapping ได้
// ============================================================

const express = require('express');
const router = express.Router();

const { listBranches, listByBranch, updateMappings } = require('../controllers/branchProductController');

const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');

// GET /api/branch-products/meta/branches — รายชื่อสาขาทั้งหมด (ต้องมาก่อน /:branchId กันชนกัน)
router.get('/meta/branches', auth, role('admin', 'main_manager'), listBranches);

// GET /api/branch-products/:branchId — ดูสินค้าทั้งหมดพร้อมสถานะ active ของสาขานี้
router.get('/:branchId', auth, role('admin', 'main_manager'), listByBranch);

// PUT /api/branch-products/:branchId — บันทึกรายการสินค้าที่เปิดใช้งานให้สาขานี้
router.put('/:branchId', auth, role('admin', 'main_manager'), updateMappings);

module.exports = router;
