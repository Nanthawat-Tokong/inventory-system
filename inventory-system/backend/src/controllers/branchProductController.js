// ============================================================
// branchProductController.js — จัดการ mapping สินค้า ↔ สาขา (branch_products)
// กำหนดว่าสินค้าตัวไหน "เปิดใช้งาน" (active) ให้สาขาไหนบ้าง
// ไฟล์นี้ทำหน้าที่:
//   listByBranch    — ดูสินค้าทั้งหมดในแคตตาล็อก พร้อมสถานะ active ของสาขาที่ระบุ
//   updateMappings  — บันทึกรายการสินค้าที่เปิดใช้งานให้สาขานั้น (แทนที่ทั้งหมด)
// สิทธิ์: admin และ main_manager เท่านั้น (main_manager เป็นคนกำหนดว่าสาขาไหนขอเบิกสินค้าอะไรได้)
// ============================================================

const pool = require('../config/db');

// ─── listBranches ────────────────────────────────────────────
// GET /api/branch-products/meta/branches — รายชื่อสาขาทั้งหมด สำหรับ dropdown ของหน้ากำหนดสินค้าประจำสาขา
// ต่างจาก GET /api/branches ตรงที่ main_manager ต้องเห็น "ทุกสาขา" (ไม่ใช่แค่สาขาตัวเอง)
// เพราะ main_manager เป็นคนกำหนดว่าสาขาไหนขอเบิกสินค้าอะไรได้ ไม่ใช่แค่สาขาคลังหลักของตัวเอง
const listBranches = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, is_warehouse FROM branches WHERE is_deleted = 0 ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── listByBranch ────────────────────────────────────────────
// GET /api/branch-products/:branchId — ดึงสินค้าทั้งหมด (ที่ยังไม่ถูกลบ) พร้อม is_active ของสาขานี้
// สินค้าที่ยังไม่มี mapping มาก่อนจะได้ is_active = 0 (ยังไม่เปิดใช้งาน)
const listByBranch = async (req, res) => {
  try {
    const [[branch]] = await pool.query('SELECT id FROM branches WHERE id = ?', [req.params.branchId]);
    if (!branch) return res.status(404).json({ message: 'ไม่พบสาขา' });

    const [rows] = await pool.query(`
      SELECT p.id AS product_id, p.name, p.sku, p.category, p.unit,
        COALESCE(bp.is_active, 0) AS is_active
      FROM products p
      LEFT JOIN branch_products bp ON bp.product_id = p.id AND bp.branch_id = ?
      WHERE p.is_deleted = 0
      ORDER BY p.name
    `, [req.params.branchId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── updateMappings ──────────────────────────────────────────
// PUT /api/branch-products/:branchId — บันทึกรายการสินค้าที่เปิดใช้งานให้สาขานี้
// รับ: { product_ids: [1, 3, 5] } — product_id ที่อยู่ในลิสต์ = active, ที่เหลือ = inactive
const updateMappings = async (req, res) => {
  const { product_ids } = req.body;
  if (!Array.isArray(product_ids)) {
    return res.status(400).json({ message: 'กรุณาระบุ product_ids เป็น array' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[branch]] = await conn.query('SELECT id FROM branches WHERE id = ?', [req.params.branchId]);
    if (!branch) { await conn.rollback(); return res.status(404).json({ message: 'ไม่พบสาขา' }); }

    // ปิดการใช้งานสินค้าทั้งหมดของสาขานี้ก่อน แล้วค่อยเปิดตามรายการที่ส่งมา
    await conn.query('UPDATE branch_products SET is_active = 0 WHERE branch_id = ?', [req.params.branchId]);

    for (const productId of product_ids) {
      await conn.query(
        `INSERT INTO branch_products (branch_id, product_id, is_active) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE is_active = 1`,
        [req.params.branchId, Number(productId)]
      );
    }

    await conn.commit();
    res.json({ message: 'บันทึกรายการสินค้าประจำสาขาแล้ว' });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  } finally {
    conn.release();
  }
};

module.exports = { listBranches, listByBranch, updateMappings };
