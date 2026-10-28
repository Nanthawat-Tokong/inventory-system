// ============================================================
// roleMiddleware.js — middleware ตรวจสอบ role (สิทธิ์) ของ user
// ใช้หลังจาก authMiddleware เสมอ (เพราะต้องมี req.user ก่อน)
// ตรวจสอบว่า user มี role ที่อนุญาตให้เข้า route นั้นหรือไม่
// เช่น route ที่ต้องการ admin เท่านั้น จะส่ง role('admin') เข้ามา
// ============================================================

// roleMiddleware รับ roles หลายตัวได้ เช่น role('admin', 'main_manager')
// ...roles คือ rest parameter ทำให้รับ argument เป็น array อัตโนมัติ
// เช่น role('admin', 'main_manager') จะได้ roles = ['admin', 'main_manager']
const roleMiddleware = (...roles) => {
  // คืนฟังก์ชัน middleware จริงๆ (pattern นี้เรียกว่า "middleware factory")
  // ทำแบบนี้เพื่อรับค่า roles มาก่อนแล้วค่อยสร้าง middleware ที่ใช้ค่านั้น
  return (req, res, next) => {
    // เช็คว่า role ของ user (ที่ authMiddleware บันทึกไว้ใน req.user)
    // อยู่ใน array ของ roles ที่อนุญาตหรือไม่
    // .includes() คืน true ถ้าเจอ role นั้นใน array
    if (!roles.includes(req.user.role)) {
      // role ไม่ตรงกับที่อนุญาต: ตอบกลับ 403 Forbidden
      // 403 หมายความว่า "รู้ว่าเป็นใคร (authenticated) แต่ไม่มีสิทธิ์ (not authorized)"
      return res.status(403).json({ message: 'บัญชีของคุณไม่มีสิทธิ์ทำรายการนี้' });
    }
    // role ผ่านการตรวจสอบ: ส่ง request ต่อไปยัง controller ถัดไป
    next();
  };
};

// ส่งออก middleware factory เพื่อให้ route files นำไปใช้ได้
// ตัวอย่างการใช้: router.post('/', auth, role('admin'), create)
module.exports = roleMiddleware;
