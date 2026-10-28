// ============================================================
// authMiddleware.js — middleware ตรวจสอบ JWT token
// ทุก route ที่ต้อง login ก่อน จะใช้ middleware นี้
//
// token ใช้ยืนยันแค่ "ว่าเป็นใคร" (id) เท่านั้น ส่วน role / branch_id / is_warehouse
// จะอ่านจากฐานข้อมูลใหม่ทุก request — เดิมอ่านจาก token ที่ฝังไว้ตอน login
// ทำให้ถ้า admin เปลี่ยน role, ย้ายสาขา หรือย้ายคลังหลัก ผู้ใช้ยังใช้สิทธิ์เดิมได้อีก 7 วัน
// ============================================================

const jwt = require('jsonwebtoken');
const pool = require('../config/db');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'กรุณาเข้าสู่ระบบก่อน' });
  }

  let decoded;
  try {
    decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ message: 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่' });
  }

  try {
    const [[user]] = await pool.query(
      `SELECT u.id, u.name, u.role, u.branch_id, u.must_change_password, COALESCE(b.is_warehouse, 0) AS is_warehouse
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id AND b.is_deleted = 0
       WHERE u.id = ?`,
      [decoded.id]
    );
    // ผู้ใช้ถูกลบไปแล้ว → token นี้ใช้ไม่ได้อีก
    if (!user) return res.status(401).json({ message: 'บัญชีนี้ถูกลบแล้ว กรุณาติดต่อผู้ดูแลระบบ' });
    req.user = user;
    // บัญชีที่ admin เพิ่งสร้าง/รีเซ็ตรหัส หรือยังใช้รหัสเริ่มต้น ต้องเปลี่ยนรหัสก่อนทำอย่างอื่น
    const allowed = ['/api/auth/me', '/api/auth/password'];
    if (user.must_change_password && !allowed.includes(req.originalUrl.split('?')[0])) {
      return res.status(403).json({ code: 'MUST_CHANGE_PASSWORD', message: 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน' });
    }
    next();
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

module.exports = authMiddleware;
