// ============================================================
// reportRoutes.js — รายงานสินค้าคงคลัง (URL prefix: /api/reports)
// ทุก role ดูได้ — controller จำกัดสาขาให้เอง (สาขาเห็นแค่ของตัวเอง, คลังหลักเลือกสาขาได้)
// query: from, to (YYYY-MM-DD), branch_id
// ============================================================

const express = require('express');
const router = express.Router();
const c = require('../controllers/reportController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');

const anyRole = role('admin', 'main_manager', 'staff', 'shipper');

router.get('/periodic', auth, anyRole, c.periodic);   // รายวัน/รายสัปดาห์/รายเดือน (group=day|week|month)
router.get('/daily', auth, anyRole, c.daily);         // วันนี้
router.get('/weekly', auth, anyRole, c.weekly);       // สัปดาห์นี้ (จันทร์–วันนี้)
router.get('/monthly', auth, anyRole, c.monthly);     // เดือนนี้
router.get('/summary', auth, anyRole, c.summary);
router.get('/movement', auth, anyRole, c.movement);
router.get('/top', auth, anyRole, c.top);
router.get('/reorder', auth, anyRole, c.reorder);
router.get('/requisitions', auth, anyRole, c.requisitions);
router.get('/by-user', auth, anyRole, c.byUser);   // การเบิกรายคน

module.exports = router;
