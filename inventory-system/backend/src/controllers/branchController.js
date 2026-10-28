// ============================================================
// branchController.js — จัดการ logic CRUD สำหรับสาขา
// ไฟล์นี้ทำหน้าที่:
//   getAll — ดึงรายชื่อสาขา (admin เห็นทุกสาขา, อื่นๆ เห็นแค่สาขาตัวเอง)
//   create — สร้างสาขาใหม่ (admin เท่านั้น)
//   update — แก้ไขข้อมูลสาขา (admin เท่านั้น)
//   remove — ลบสาขาแบบซ่อน เก็บประวัติไว้ (admin เท่านั้น)
// ============================================================

const pool = require('../config/db');
const { isAdmin, ownBranch } = require('../utils/permissions');

// ─── getAll ──────────────────────────────────────────────────
// GET /api/branches — ดึงรายชื่อสาขา
// admin: เห็นทุกสาขา, manager/staff: เห็นแค่สาขาตัวเอง
const getAll = async (req, res) => {
  try {
    if (isAdmin(req)) {
      // admin: ดึงสาขาทั้งหมดเรียงตามชื่อ
      const [rows] = await pool.query('SELECT * FROM branches WHERE is_deleted = 0 ORDER BY name');
      return res.json(rows);
    }
    // manager/staff: ดึงเฉพาะสาขาของตัวเองตาม branch_id ใน token
    const [rows] = await pool.query('SELECT * FROM branches WHERE id = ? AND is_deleted = 0', [ownBranch(req)]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── create ──────────────────────────────────────────────────
// POST /api/branches — สร้างสาขาใหม่
// รับ: req.body = { name, location, is_warehouse }
// คืน: 201 พร้อมข้อมูลสาขาที่สร้าง
// หมายเหตุ: is_warehouse ควบคุมว่าใครเป็น "คลังหลัก" ซึ่งตอนนี้ผูกกับสิทธิ์ main_manager
// โดยตรง (ดู utils/permissions.js) จึงต้องรับประกันว่ามีสาขาเดียวที่ is_warehouse=1
// เสมอ — ไม่มี DB constraint บังคับเรื่องนี้ จึงเคลียร์ flag ของสาขาอื่นในทรานแซกชันเดียวกัน
const create = async (req, res) => {
  const { name, location, is_warehouse } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ message: 'กรุณากรอกชื่อสาขา' });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (is_warehouse) {
      await conn.query('UPDATE branches SET is_warehouse = 0 WHERE is_warehouse = 1');
    }
    const [result] = await conn.query(
      // INSERT สาขาใหม่ location ไม่บังคับ ถ้าไม่ส่งมาใช้ null
      'INSERT INTO branches (name, location, is_warehouse) VALUES (?, ?, ?)',
      [name, location || null, is_warehouse ? 1 : 0]
    );
    // เปิดใช้งานสินค้าทุกตัวในแคตตาล็อกให้สาขาใหม่เป็นค่าเริ่มต้น
    // ไม่งั้นสาขาใหม่จะไม่เห็นสินค้าเลย (main_manager ปรับลดทีหลังได้ที่หน้าสินค้าประจำสาขา)
    await conn.query(
      `INSERT INTO branch_products (branch_id, product_id, is_active)
       SELECT ?, id, 1 FROM products WHERE is_deleted = 0`,
      [result.insertId]
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, name, location, is_warehouse: is_warehouse ? 1 : 0 });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  } finally {
    conn.release();
  }
};

// ─── update ──────────────────────────────────────────────────
// PUT /api/branches/:id — แก้ไขข้อมูลสาขาตาม id
// รับ: req.body = { name, location, is_warehouse }
const update = async (req, res) => {
  const { name, location, is_warehouse } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ message: 'กรุณากรอกชื่อสาขา' });
  // is_warehouse ไม่บังคับส่งมา — ถ้าไม่ได้ส่ง (undefined) จะไม่แตะค่าเดิม
  // ป้องกันไม่ให้การแก้ไข name/location เฉยๆ ไปเผลอรีเซ็ต is_warehouse เป็น 0
  const touchesWarehouseFlag = is_warehouse !== undefined;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (touchesWarehouseFlag && is_warehouse) {
      await conn.query('UPDATE branches SET is_warehouse = 0 WHERE is_warehouse = 1 AND id != ?', [req.params.id]);
    } else if (touchesWarehouseFlag && !is_warehouse) {
      // ห้ามเอาสถานะคลังหลักออกจากสาขาเดียวที่เป็นคลังหลักอยู่ — ระบบต้องมีคลังหลักเสมอ
      // (ย้ายคลังหลักทำได้โดยติ๊กที่สาขาใหม่แทน)
      const [[cur]] = await conn.query('SELECT is_warehouse FROM branches WHERE id = ?', [req.params.id]);
      if (cur && cur.is_warehouse) {
        await conn.rollback();
        return res.status(400).json({ message: 'ต้องมีคลังหลัก 1 สาขาเสมอ — ถ้าจะย้ายคลังหลัก ให้ไปติ๊กที่สาขาใหม่แทน' });
      }
    }
    const [result] = await conn.query(
      touchesWarehouseFlag
        ? 'UPDATE branches SET name=?, location=?, is_warehouse=? WHERE id=?'
        : 'UPDATE branches SET name=?, location=? WHERE id=?',
      touchesWarehouseFlag
        ? [name, location, is_warehouse ? 1 : 0, req.params.id]
        : [name, location, req.params.id]
    );
    if (result.affectedRows === 0) {
      await conn.rollback();
      return res.status(404).json({ message: 'ไม่พบสาขานี้ (อาจถูกลบไปแล้ว)' });
    }
    await conn.commit();
    res.json({ message: 'บันทึกข้อมูลสาขาแล้ว' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  } finally {
    conn.release();
  }
};

// ─── remove ──────────────────────────────────────────────────
// DELETE /api/branches/:id — ลบสาขาแบบซ่อน (soft delete)
// เดิมลบจริง ซึ่ง CASCADE ลบประวัติรับ/ออกสินค้า ใบขอเบิก และกฎแจ้งเตือนของสาขานั้นทิ้งหมดแบบกู้คืนไม่ได้
// ตอนนี้แค่ซ่อนสาขา (is_deleted = 1) ประวัติทั้งหมดยังอยู่ครบ รายงานย้อนหลังยังเห็นชื่อสาขาเดิม
// เงื่อนไข: ห้ามลบคลังหลัก, ต้องย้ายผู้ใช้ออกก่อน, ต้องไม่มีใบขอเบิกที่ยังไม่จบ
const remove = async (req, res) => {
  try {
    const [[branch]] = await pool.query('SELECT * FROM branches WHERE id = ? AND is_deleted = 0', [req.params.id]);
    if (!branch) return res.status(404).json({ message: 'ไม่พบสาขานี้ (อาจถูกลบไปแล้ว)' });
    if (branch.is_warehouse) {
      return res.status(400).json({ message: 'ลบสาขาคลังหลักไม่ได้ — ตั้งสาขาอื่นเป็นคลังหลักก่อน' });
    }
    const [[{ users }]] = await pool.query('SELECT COUNT(*) AS users FROM users WHERE branch_id = ?', [branch.id]);
    if (users > 0) {
      return res.status(400).json({ message: `ยังมีผู้ใช้ ${users} คนอยู่ในสาขานี้ — ย้ายผู้ใช้ไปสาขาอื่นหรือลบผู้ใช้ก่อน` });
    }
    const [[{ open }]] = await pool.query(
      "SELECT COUNT(*) AS open FROM requisitions WHERE branch_id = ? AND status NOT IN ('completed','rejected')",
      [branch.id]
    );
    if (open > 0) {
      return res.status(400).json({ message: `ยังมีใบขอเบิกที่ยังไม่จบ ${open} ใบ — จัดการให้เสร็จก่อนลบสาขา` });
    }
    await pool.query('UPDATE branches SET is_deleted = 1 WHERE id = ?', [branch.id]);
    res.json({ message: 'ลบสาขาแล้ว' });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

module.exports = { getAll, create, update, remove };
