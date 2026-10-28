// ============================================================
// productController.js — จัดการ logic CRUD สำหรับสินค้า
// ไฟล์นี้ทำหน้าที่:
//   getAll — ดึงสินค้าทั้งหมด
//   getOne — ดึงสินค้าตัวเดียวตาม id
//   create — สร้างสินค้าใหม่
//   update — แก้ไขข้อมูลสินค้า
//   remove — ลบสินค้า
// ============================================================

// pool คือ connection pool สำหรับ query MySQL database
const pool = require('../config/db');
const { isAdmin, isMainManager, ownBranch } = require('../utils/permissions');

// ─── getAll ──────────────────────────────────────────────────
// GET /api/products — ดึงรายชื่อสินค้าเรียงตามวันที่สร้างล่าสุด
// admin/main_manager: เห็นสินค้าทั้งหมดในแคตตาล็อก (ต้องเห็นทุกตัวเพื่อจัดการ/กำหนดให้สาขา)
// staff: เห็นเฉพาะสินค้าที่ "เปิดใช้งาน" (branch_products.is_active = 1) ให้สาขาตัวเองเท่านั้น
// คืน: array ของ product objects
// แต่ละสินค้าแนบจำนวนคงเหลือมาด้วย (หน้าสินค้าจะได้เห็นทันทีว่ามีของเท่าไร):
//   stock           — คงเหลือที่สาขาของผู้ใช้ (admin ไม่มีสาขา = ใช้คลังหลัก)
//   warehouse_stock — คงเหลือที่คลังหลัก
//   total_stock     — รวมทุกสาขา (เฉพาะ admin / main_manager)
const getAll = async (req, res) => {
  try {
    const seesCatalog = isAdmin(req) || isMainManager(req);
    const [rows] = seesCatalog
      ? await pool.query('SELECT * FROM products WHERE is_deleted = 0 ORDER BY created_at DESC')
      : await pool.query(`
          SELECT p.* FROM products p
          JOIN branch_products bp ON bp.product_id = p.id
          WHERE p.is_deleted = 0 AND bp.branch_id = ? AND bp.is_active = 1
          ORDER BY p.created_at DESC
        `, [ownBranch(req)]);

    const [[wh]] = await pool.query('SELECT id FROM branches WHERE is_warehouse = 1 AND is_deleted = 0 LIMIT 1');
    const myBranch = ownBranch(req) || wh?.id;
    const [stocks] = await pool.query(`
      SELECT t.product_id, t.branch_id, SUM(IF(t.type = 'receive', t.quantity, -t.quantity)) AS stock
      FROM transactions t JOIN branches b ON b.id = t.branch_id AND b.is_deleted = 0
      GROUP BY t.product_id, t.branch_id
    `);
    const mine = new Map(), warehouse = new Map(), total = new Map();
    for (const s of stocks) {
      const qty = Number(s.stock);
      if (s.branch_id === myBranch) mine.set(s.product_id, qty);
      if (s.branch_id === wh?.id) warehouse.set(s.product_id, qty);
      total.set(s.product_id, (total.get(s.product_id) || 0) + qty);
    }
    res.json(rows.map((p) => ({
      ...p,
      stock: mine.get(p.id) || 0,
      warehouse_stock: warehouse.get(p.id) || 0,
      ...(seesCatalog ? { total_stock: total.get(p.id) || 0 } : {}),
    })));
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── getOne ──────────────────────────────────────────────────
// GET /api/products/:id — ดึงสินค้าตัวเดียวตาม id
// คืน: product object เดียว หรือ 404 ถ้าไม่พบ
const getOne = async (req, res) => {
  try {
    // WHERE id = ? ใช้ parameterized query เพื่อป้องกัน SQL injection
    // req.params.id คือ id ที่อยู่ใน URL เช่น /api/products/3
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว)' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ตรวจข้อมูลสินค้า → คืน { error } หรือ { values }
// เกณฑ์ขั้นต่ำ: เว้นว่าง = 50, ต้องเป็นจำนวนเต็มไม่ติดลบ
const parseProduct = (body) => {
  const name = String(body.name ?? '').trim();
  const sku = String(body.sku ?? '').trim();
  if (!name) return { error: 'กรุณากรอกชื่อสินค้า' };
  if (!sku) return { error: 'กรุณากรอก SKU' };
  const raw = body.low_stock_threshold;
  const threshold = raw === undefined || raw === null || raw === '' ? 50 : Number(raw);
  if (!Number.isInteger(threshold) || threshold < 0) return { error: 'เกณฑ์แจ้งเตือนต้องเป็นจำนวนเต็มไม่ติดลบ' };
  return { values: { name, sku, category: body.category || null, unit: String(body.unit || '').trim() || 'ชิ้น', threshold } };
};

// ─── create ──────────────────────────────────────────────────
// POST /api/products — เพิ่มสินค้า แล้วเปิดใช้ให้ทุกสาขาอัตโนมัติ
// (ไม่งั้นสาขาจะมองไม่เห็นสินค้าใหม่จนกว่าจะไปติ๊กที่หน้าสินค้าประจำสาขาทีละสาขา)
const create = async (req, res) => {
  const { error, values: v } = parseProduct(req.body);
  if (error) return res.status(400).json({ message: error });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO products (name, sku, category, unit, low_stock_threshold) VALUES (?, ?, ?, ?, ?)',
      [v.name, v.sku, v.category, v.unit, v.threshold]
    );
    await conn.query(
      'INSERT INTO branch_products (branch_id, product_id, is_active) SELECT id, ?, 1 FROM branches WHERE is_deleted = 0',
      [result.insertId]
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, name: v.name, sku: v.sku, category: v.category, unit: v.unit, low_stock_threshold: v.threshold });
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'SKU นี้มีอยู่แล้ว' });
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  } finally {
    conn.release();
  }
};

// ─── update ──────────────────────────────────────────────────
const update = async (req, res) => {
  const { error, values: v } = parseProduct(req.body);
  if (error) return res.status(400).json({ message: error });
  try {
    const [result] = await pool.query(
      'UPDATE products SET name=?, sku=?, category=?, unit=?, low_stock_threshold=? WHERE id=? AND is_deleted = 0',
      [v.name, v.sku, v.category, v.unit, v.threshold, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว)' });
    res.json({ message: 'บันทึกข้อมูลสินค้าแล้ว' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'SKU นี้ซ้ำกับสินค้าอื่น' });
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── remove ──────────────────────────────────────────────────
// DELETE /api/products/:id — soft delete สินค้าตาม id
// ไม่ลบจริงจากฐานข้อมูล แต่ตั้ง is_deleted = 1 แทน
// เหตุผล: transactions และ alerts อ้างอิง product_id อยู่
//         ถ้าลบจริง (hard delete) ประวัติการรับ/ออกสินค้าทั้งหมดจะหายไปด้วย
// คืน: { message: 'ลบสินค้าแล้ว' } หรือ 404 ถ้าไม่พบ
const remove = async (req, res) => {
  try {
    // UPDATE ตั้ง is_deleted = 1 แทนการ DELETE จริง
    // AND is_deleted = 0 ป้องกันการ soft-delete ซ้ำสินค้าที่ถูกลบไปแล้ว
    const [result] = await pool.query(
      'UPDATE products SET is_deleted = 1 WHERE id = ? AND is_deleted = 0',
      [req.params.id]
    );
    // affectedRows = 0 หมายความว่าไม่พบ id นั้น หรือถูก soft-delete ไปแล้ว
    if (result.affectedRows === 0) return res.status(404).json({ message: 'ไม่พบสินค้านี้ (อาจถูกลบไปแล้ว)' });
    res.json({ message: 'ลบสินค้าแล้ว' });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

module.exports = { getAll, getOne, create, update, remove };
