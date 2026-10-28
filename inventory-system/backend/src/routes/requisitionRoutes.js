// ============================================================
// requisitionRoutes.js — route ใบขอเบิกสินค้า (สาขา → คลังหลัก)
// URL prefix: /api/requisitions
// สิทธิ์ละเอียด (เช่น เฉพาะสาขาเจ้าของใบ) ตรวจต่อใน controller อีกชั้น
// ============================================================

const express = require('express');
const router = express.Router();

const c = require('../controllers/requisitionController');
const auth = require('../middleware/authMiddleware');
const role = require('../middleware/roleMiddleware');
const { requireWarehouseAuthority, requireShipper } = require('../utils/permissions');

const anyRole = role('admin', 'main_manager', 'staff', 'shipper');
const warehouseOnly = [role('admin', 'main_manager'), requireWarehouseAuthority]; // ผู้อนุมัติของคลังหลัก
const shipperOnly = [requireShipper]; // ตรวจทั้ง role + สังกัดคลังหลัก และตอบข้อความที่อ่านเข้าใจ                              // พนักงานจัดส่งของคลังหลัก

// ข้อมูลประกอบ (ต้องอยู่ก่อน /:id)
router.get('/meta/warehouse-stock', auth, anyRole, c.warehouseStock);   // สต๊อกคลังหลัก ให้สาขาเห็นก่อนขอเบิก
router.get('/meta/action-count', auth, anyRole, c.actionCount);         // จำนวนใบที่รอผู้ใช้คนนี้ดำเนินการ

// สร้าง / ดู / แก้ / ยกเลิก
router.post('/', auth, role('staff', 'main_manager'), c.create);
router.get('/', auth, anyRole, c.list);
router.get('/:id', auth, anyRole, c.getOne);
router.put('/:id', auth, role('admin', 'staff', 'main_manager'), c.update);
router.delete('/:id', auth, role('admin', 'staff', 'main_manager'), c.remove);

// คลังหลัก: ผู้อนุมัติ อนุมัติ/ปฏิเสธ → พนักงานจัดส่ง จัดส่ง (แยกคนกัน)
router.put('/:id/approve', auth, ...warehouseOnly, c.approve);
router.put('/:id/reject', auth, ...warehouseOnly, c.reject);
router.put('/:id/ship', auth, ...shipperOnly, c.ship);
router.put('/:id/cancel-approval', auth, ...warehouseOnly, c.cancelApproval); // ยกเลิกหลังอนุมัติ (ก่อนส่ง)

// สาขา: ตรวจรับ (แยกสภาพดี / ชำรุด)
router.put('/:id/receive', auth, anyRole, c.receive);

// เคสที่มีปัญหา — ไม่มีฝ่ายไหนปิดเองได้ฝ่ายเดียว
router.post('/:id/messages', auth, anyRole, c.addMessage);              // ข้อความโต้ตอบ (ทั้ง 2 ฝ่าย)
router.put('/:id/respond', auth, ...warehouseOnly, c.respond);          // คลังหลักแจ้ง: กำลังจัดส่งใหม่ / สต๊อกยังไม่พอ
router.put('/:id/propose-close', auth, ...warehouseOnly, c.proposeClose); // คลังหลักขอปิดเคส
router.put('/:id/accept-close', auth, anyRole, c.acceptClose);          // สาขายืนยันปิดเคส
router.put('/:id/decline-close', auth, anyRole, c.declineClose);        // สาขาไม่ยอมรับการปิดเคส

// ของชดเชย
router.post('/:id/replacements', auth, ...warehouseOnly, c.createReplacement);

// ของชำรุด: ผู้อนุมัติเลือก ตัดทิ้ง/ส่งคืน → คลังหลักยืนยันเมื่อได้ของคืน
router.post('/:id/defects', auth, ...warehouseOnly, c.decideDefects);
router.put('/:id/defects/:defectId/received', auth, anyRole, c.defectReturned);
router.put('/:id/replacements/:replacementId/ship', auth, ...shipperOnly, c.shipReplacement);
router.put('/:id/replacements/:replacementId/receive', auth, anyRole, c.receiveReplacement);

module.exports = router;
