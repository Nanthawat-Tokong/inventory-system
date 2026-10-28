// ============================================================
// permissions.js — shared role/permission helpers
// ใช้แทนของเดิมที่เคย copy-paste isAdmin()/ownBranch() ไว้ใน
// controller หลายไฟล์ (inventory, branch, alert, requisition, report)
//
// Roles:
//   admin        — ทำได้ทุกอย่าง
//   main_manager — เหมือน admin แต่เฉพาะสาขาคลังหลัก (is_warehouse = 1)
//   staff        — สร้างใบขอเบิก/ยืนยันรับสินค้าของใบตัวเอง/ดูสต๊อกสาขาตัวเองเท่านั้น
//   shipper      — พนักงานจัดส่งของคลังหลัก: จัดส่งใบที่อนุมัติแล้ว + ส่งของชดเชย (อนุมัติเองไม่ได้)
//                  (ไม่มีสิทธิ์บันทึกรับ/ออกสินค้าโดยตรง — ต้องผ่านใบขอเบิก)
// ============================================================

const isAdmin = (req) => req.user.role === 'admin';
const isMainManager = (req) => req.user.role === 'main_manager';
const isStaff = (req) => req.user.role === 'staff';
// พนักงานจัดส่ง ต้องสังกัดสาขาคลังหลักเท่านั้นถึงจะมีสิทธิ์
const isShipper = (req) => req.user.role === 'shipper' && Number(req.user.is_warehouse) === 1;
const ownBranch = (req) => req.user.branch_id;

// "warehouse authority" = admin (เสมอ) หรือ main_manager ที่สาขาตัวเองเป็นคลังหลักจริง
// (is_warehouse ถูกฝังไว้ใน JWT ตอน login แล้ว — ดู authController.js)
// ใช้เป็นตัวตัดสินว่าใครอนุมัติ/ปฏิเสธ/จัดส่งใบขอเบิกได้บ้าง
const isWarehouseAuthority = (req) =>
  isAdmin(req) || (isMainManager(req) && Number(req.user.is_warehouse) === 1);

// middleware: ใช้ต่อจาก role('admin', 'main_manager') เพื่อกรอง main_manager
// ที่ไม่ได้อยู่สาขาคลังหลักออก (role() อย่างเดียวมองไม่เห็น is_warehouse)
const requireWarehouseAuthority = (req, res, next) => {
  if (isWarehouseAuthority(req)) return next();
  return res.status(403).json({ message: 'เฉพาะผู้ดูแลระบบหรือผู้จัดการสาขาคลังหลักเท่านั้นที่ทำรายการนี้ได้' });
};

const requireShipper = (req, res, next) => {
  if (isShipper(req)) return next();
  return res.status(403).json({ message: 'เฉพาะพนักงานจัดส่งของคลังหลักเท่านั้นที่จัดส่งได้' });
};

module.exports = {
  isShipper,
  requireShipper,
  isAdmin,
  isMainManager,
  isStaff,
  ownBranch,
  isWarehouseAuthority,
  requireWarehouseAuthority,
};
