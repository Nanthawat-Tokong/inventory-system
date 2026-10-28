// ============================================================
// authController.js — จัดการ logic การ login และตรวจสอบตัวตน
// ไฟล์นี้ทำหน้าที่:
//   login  — รับ email+password, ตรวจสอบ, ออก JWT token
//   getMe  — ดึงข้อมูล user จาก token ที่แนบมาใน request
// ============================================================

// bcrypt คือ library สำหรับเปรียบเทียบ password กับ hash ที่เก็บใน database
// การ hash หมายถึงเข้ารหัส password แบบ one-way (ถอดรหัสกลับไม่ได้)
const bcrypt = require('bcryptjs');

// jsonwebtoken คือ library สำหรับสร้าง JWT token
// token คือ string ที่เข้ารหัสข้อมูล user ไว้ server ออกให้ตอน login สำเร็จ
const jwt = require('jsonwebtoken');

// pool คือ connection pool สำหรับ query database MySQL
// connection pool คือ "กลุ่มการเชื่อมต่อ" ที่ใช้ซ้ำได้เพื่อประสิทธิภาพ
const pool = require('../config/db');

// ─── login function ──────────────────────────────────────────
// รับ: req.body.email, req.body.password
// คืน: { token, user } ถ้าสำเร็จ, หรือ 401 error ถ้าไม่สำเร็จ
const login = async (req, res) => {
  // ดึง email และ password จาก request body
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: 'กรุณากรอกอีเมลและรหัสผ่าน' });
  }
  try {
    // ค้นหา user จาก email ในตาราง users
    // LEFT JOIN branches เพื่อดึงชื่อสาขามาด้วยในคราวเดียว
    // u.* คือทุก column ในตาราง users รวมถึง password_hash
    const [rows] = await pool.query(
      'SELECT u.*, b.name as branch_name, b.is_warehouse FROM users u LEFT JOIN branches b ON u.branch_id = b.id WHERE u.email = ?',
      [email]
    );

    // ถ้าไม่พบ user ด้วย email นี้
    // ตอบ 401 (Unauthorized) แทนที่จะบอกว่า "email ไม่มีในระบบ"
    // เพราะการบอกรายละเอียดมากเกินไปเป็นความเสี่ยงด้านความปลอดภัย
    if (rows.length === 0) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    const user = rows[0];

    // เปรียบเทียบ password ที่ user กรอกกับ password_hash ที่เก็บใน database
    // bcrypt.compare คืน true ถ้าตรงกัน, false ถ้าไม่ตรง
    const isMatch = await bcrypt.compare(password, user.password_hash);

    // ถ้า password ไม่ตรง
    if (!isMatch) {
      return res.status(401).json({ message: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }

    // สร้าง JWT token โดยบรรจุข้อมูลสำคัญไว้ข้างใน:
    //   id           — ใช้ระบุตัว user
    //   role         — ใช้ตรวจสอบสิทธิ์ใน middleware
    //   branch_id    — ใช้กรองข้อมูลตามสาขาของ user
    //   is_warehouse — สาขาของ user เป็นคลังหลักหรือไม่ (ใช้ตัดสินสิทธิ์ main_manager
    //                  อนุมัติ/ปฏิเสธ/จัดส่งใบขอเบิก โดยไม่ต้อง query ซ้ำทุก request)
    // หมายเหตุ: ฝั่ง backend ไม่เชื่อค่า role/branch_id/is_warehouse ใน token แล้ว
    // authMiddleware อ่านค่าล่าสุดจากฐานข้อมูลทุก request (ใช้ token แค่ยืนยันว่าเป็นใคร)
    // JWT_SECRET คือ "กุญแจ" สำหรับเข้ารหัส token (เก็บใน .env ห้ามเปิดเผย)
    // expiresIn กำหนดอายุของ token (เช่น "7d" = 7 วัน)
    const token = jwt.sign(
      { id: user.id, role: user.role, branch_id: user.branch_id, is_warehouse: user.is_warehouse ?? 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    // ตอบกลับพร้อม token และข้อมูล user (ไม่รวม password_hash เพื่อความปลอดภัย)
    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        branch_id: user.branch_id,
        branch_name: user.branch_name,
        is_warehouse: user.is_warehouse ?? 0,
        must_change_password: user.must_change_password,
      }
    });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── getMe function ──────────────────────────────────────────
// รับ: req.user.id (ที่ authMiddleware ดึงออกมาจาก token แล้ว)
// คืน: ข้อมูล user ปัจจุบัน (ไม่รวม password)
const getMe = async (req, res) => {
  try {
    // ดึงข้อมูล user จาก id ที่ได้จาก token
    // JOIN branches เพื่อดึงชื่อสาขามาด้วย
    const [rows] = await pool.query(
      'SELECT u.id, u.name, u.email, u.role, u.branch_id, u.must_change_password, b.name as branch_name, b.is_warehouse FROM users u LEFT JOIN branches b ON u.branch_id = b.id WHERE u.id = ?',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้ (อาจถูกลบไปแล้ว)' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── changePassword ─────────────────────────────────────────
// PUT /api/auth/password — ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง { current_password, new_password }
// ต้องใส่รหัสเดิมให้ถูก (กันคนอื่นมาใช้เครื่องที่ล็อกอินค้างไว้), รหัสใหม่ ≥ 8 ตัว และไม่ซ้ำรหัสเดิม
// เปลี่ยนสำเร็จ → ปลดสถานะ "ต้องเปลี่ยนรหัสผ่าน"
const changePassword = async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ message: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่' });
  if (String(new_password).length < 8) return res.status(400).json({ message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' });
  if (new_password === current_password) return res.status(400).json({ message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม' });
  try {
    const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!u || !(await bcrypt.compare(current_password, u.password_hash))) {
      return res.status(400).json({ message: 'รหัสผ่านเดิมไม่ถูกต้อง' });
    }
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'เปลี่ยนรหัสผ่านเรียบร้อย' });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

module.exports = { login, getMe, changePassword };
