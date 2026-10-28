// ============================================================
// userController.js — จัดการ logic CRUD สำหรับผู้ใช้งาน
// ไฟล์นี้ทำหน้าที่:
//   getAll — ดึงรายชื่อ user ทั้งหมด พร้อมชื่อสาขา
//   create — สร้าง user ใหม่ (hash password ก่อนบันทึก)
//   update — แก้ไขข้อมูล user (hash password ใหม่ถ้ามีการเปลี่ยน)
//   remove — ลบ user
// ทุก function ใช้งานได้เฉพาะ admin (กำหนดใน route)
// ============================================================

// bcrypt คือ library สำหรับ hash password
// การ hash คือการเข้ารหัสแบบ one-way ที่ไม่สามารถถอดรหัสกลับได้
// ทำให้แม้ database รั่วไหล ก็ไม่รู้ password จริงของ user
const bcrypt = require('bcryptjs');

const pool = require('../config/db');

// ─── getAll ──────────────────────────────────────────────────
// GET /api/users — ดึงรายชื่อ user ทั้งหมด
// คืน: array ของ user objects พร้อม branch_name (จาก JOIN)
const getAll = async (req, res) => {
  try {
    const [rows] = await pool.query(
      // SELECT เฉพาะ field ที่ต้องการ (ไม่รวม password_hash เพื่อความปลอดภัย)
      // LEFT JOIN branches เพื่อดึงชื่อสาขา (b.name as branch_name)
      // LEFT JOIN หมายถึง ถ้า user ไม่มีสาขา (admin) ก็ยังดึง user นั้นมาด้วย แค่ branch_name เป็น null
      // ORDER BY created_at DESC: เรียงจากสมัครใหม่ไปเก่า
      'SELECT u.id, u.name, u.email, u.role, u.branch_id, b.name as branch_name, u.created_at FROM users u LEFT JOIN branches b ON u.branch_id = b.id ORDER BY u.created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ตรวจ role + สาขาให้เข้ากัน — พนักงานจัดส่ง (shipper) ต้องสังกัดคลังหลัก ไม่งั้นจะจัดส่งอะไรไม่ได้เลย
const ROLES = ['admin', 'main_manager', 'staff', 'shipper'];
const validateRole = async (role, branch_id) => {
  if (!ROLES.includes(role)) return 'บทบาทไม่ถูกต้อง';
  if (role !== 'admin' && !branch_id) return 'บทบาทนี้ต้องเลือกสาขา';
  if (role === 'shipper') {
    const [[b]] = await pool.query('SELECT is_warehouse FROM branches WHERE id = ? AND is_deleted = 0', [branch_id]);
    if (!b || !b.is_warehouse) return 'พนักงานจัดส่งต้องสังกัดสาขาคลังหลัก';
  }
  return null;
};

// ตรวจข้อมูลพื้นฐาน — isCreate: ตอนสร้างต้องมีรหัสผ่านเสมอ, ตอนแก้ไขเว้นว่างได้ (= ไม่เปลี่ยนรหัส)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validateFields = ({ name, email, password }, isCreate) => {
  if (!name || !String(name).trim()) return 'กรุณากรอกชื่อ';
  if (!email || !EMAIL_RE.test(String(email))) return 'รูปแบบอีเมลไม่ถูกต้อง';
  if (isCreate && !password) return 'กรุณากรอกรหัสผ่าน';
  if (password && String(password).length < 8) return 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
  return null;
};

const countAdmins = async (excludeId) => {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id <> ?", [excludeId]);
  return Number(n);
};

// ─── create ──────────────────────────────────────────────────
// POST /api/users — สร้าง user ใหม่ { name, email, password, role, branch_id }
const create = async (req, res) => {
  const { name, email, password, branch_id } = req.body;
  const role = req.body.role || 'staff';
  try {
    const invalid = validateFields(req.body, true) || await validateRole(role, branch_id);
    if (invalid) return res.status(400).json({ message: invalid });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash, role, branch_id, must_change_password) VALUES (?,?,?,?,?,1)',
      [String(name).trim(), email, hash, role, role === 'admin' ? (branch_id || null) : branch_id]
    );
    res.status(201).json({ id: result.insertId, name, email, role, branch_id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'อีเมลนี้มีผู้ใช้แล้ว' });
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── update ──────────────────────────────────────────────────
// PUT /api/users/:id — แก้ไข user (password เว้นว่าง = ไม่เปลี่ยน)
// กันระบบไม่มี admin เหลือ: เปลี่ยน admin คนสุดท้ายเป็นบทบาทอื่นไม่ได้
const update = async (req, res) => {
  const { name, email, password, role, branch_id } = req.body;
  try {
    const invalid = validateFields(req.body, false) || await validateRole(role, branch_id);
    if (invalid) return res.status(400).json({ message: invalid });

    const [[target]] = await pool.query('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
    if (!target) return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้ (อาจถูกลบไปแล้ว)' });
    if (target.role === 'admin' && role !== 'admin' && (await countAdmins(target.id)) === 0) {
      return res.status(400).json({ message: 'ต้องมี admin อย่างน้อย 1 คน — เปลี่ยนบทบาท admin คนสุดท้ายไม่ได้' });
    }

    const fields = ['name=?', 'email=?', 'role=?', 'branch_id=?'];
    const params = [String(name).trim(), email, role, branch_id || null];
    if (password) {
      // admin ตั้งรหัสให้ → ผู้ใช้ต้องเปลี่ยนเป็นรหัสของตัวเองตอนเข้าใช้ครั้งถัดไป
      fields.push('password_hash=?', 'must_change_password=1');
      params.push(await bcrypt.hash(password, 10));
    }
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, [...params, req.params.id]);
    res.json({ message: 'บันทึกข้อมูลผู้ใช้แล้ว' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'อีเมลนี้มีผู้ใช้แล้ว' });
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── remove ──────────────────────────────────────────────────
// DELETE /api/users/:id
// ห้ามลบ: ตัวเอง / admin คนสุดท้าย / คนที่เคยทำรายการ
// (ตาราง transactions, requisitions ผูกกับผู้ใช้แบบ ON DELETE CASCADE — ลบผู้ใช้ = ประวัติสต๊อกและใบขอเบิกของเขาหายไปด้วย
//  ทำให้ยอดสต๊อกเปลี่ยน) → ให้เปลี่ยนรหัสผ่าน/บทบาทแทนการลบ
const remove = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ message: 'ลบบัญชีของตัวเองไม่ได้' });
    const [[target]] = await pool.query('SELECT id, role FROM users WHERE id = ?', [id]);
    if (!target) return res.status(404).json({ message: 'ไม่พบผู้ใช้นี้ (อาจถูกลบไปแล้ว)' });
    if (target.role === 'admin' && (await countAdmins(id)) === 0) {
      return res.status(400).json({ message: 'ลบ admin คนสุดท้ายไม่ได้' });
    }
    const [[used]] = await pool.query(`
      SELECT (SELECT COUNT(*) FROM transactions WHERE user_id = ?) AS tx,
             (SELECT COUNT(*) FROM requisitions WHERE created_by = ?) AS req,
             (SELECT COUNT(*) FROM replacement_shipments WHERE created_by = ?) AS rep
    `, [id, id, id]);
    if (Number(used.tx) + Number(used.req) + Number(used.rep) > 0) {
      return res.status(400).json({
        message: 'ผู้ใช้นี้เคยทำรายการสต๊อก/ใบขอเบิกแล้ว ลบไม่ได้ (ประวัติจะหาย) — ให้เปลี่ยนรหัสผ่านหรือบทบาทแทน',
      });
    }
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'ลบผู้ใช้แล้ว' });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

module.exports = { getAll, create, update, remove };
