// ============================================================
// alertController.js — จัดการ logic กฎแจ้งเตือนสต๊อกต่ำ
// ไฟล์นี้มี 2 ส่วน:
//   ส่วนที่ 1 (getAll): สำหรับ Dashboard — scan สต๊อกทุกรายการและแจ้งเตือน
//             ที่ต่ำกว่า products.low_stock_threshold (ไม่ต้องตั้งกฎก่อน)
//   ส่วนที่ 2 (getSettings, create, update, remove): สำหรับหน้า Settings
//             จัดการกฎแจ้งเตือน manual ที่เก็บในตาราง alerts
// ============================================================

const pool = require('../config/db');
const { isAdmin, ownBranch } = require('../utils/permissions');

// helper: สร้าง SQL condition สำหรับกรองตามสาขา (ใช้ใน getSettings)
// alias คือชื่อ table alias ใน SQL เช่น 'a' สำหรับตาราง alerts
// admin: ไม่กรอง (เห็นทุกสาขา), non-admin: กรองเฉพาะสาขาตัวเอง
const branchClause = (req, alias = 'a') =>
  isAdmin(req) ? { sql: '', params: [] } : { sql: `AND ${alias}.branch_id = ?`, params: [ownBranch(req)] };

// ─── getAll (Dashboard) ───────────────────────────────────────
// GET /api/alerts — ดึงเฉพาะสินค้าที่สต๊อกต่ำกว่า threshold
// ใช้ใน Dashboard เพื่อแสดงกล่องแจ้งเตือนสีแดง
// ทุก product-branch จะถูกเช็คอัตโนมัติ ไม่ต้องตั้งกฎก่อน
// threshold ดูจาก products.low_stock_threshold (default = 50)
//
// หมายเหตุบั๊กที่แก้: เดิม INNER JOIN ผ่าน view current_stock ซึ่งมีแค่ product-branch
// ที่เคยมี transaction เท่านั้น ทำให้สินค้าที่ "ไม่เคยรับเข้าเลย" (สต๊อก = 0 จริงๆ)
// ไม่ถูกนับว่าต่ำกว่า threshold เลย ทั้งที่ควรเป็นกรณีแจ้งเตือนที่ชัดเจนที่สุด
// แก้โดยเริ่มจาก products × branches แล้ว LEFT JOIN current_stock พร้อม COALESCE(...,0)
const getAll = async (req, res) => {
  const params = [];
  let branchFilter = '';

  // ถ้าไม่ใช่ admin ให้กรองเฉพาะสาขาของตัวเอง
  if (!isAdmin(req)) {
    branchFilter = 'AND b.id = ?';
    params.push(ownBranch(req));
  }

  try {
    const [rows] = await pool.query(`
      SELECT
        -- สร้าง id จาก product_id และ branch_id รวมกัน เช่น "1-2"
        -- React ต้องการ key ที่ไม่ซ้ำกันสำหรับ list rendering
        CONCAT(p.id, '-', b.id) AS id,
        p.id                    AS product_id,
        b.id                    AS branch_id,
        p.name                  AS product_name,
        p.sku,
        p.unit,
        b.name                  AS branch_name,
        -- stock คือสต๊อกปัจจุบัน (COALESCE เป็น 0 ถ้ายังไม่เคยมี transaction)
        COALESCE(cs.stock, 0)   AS stock,
        -- คืน threshold ออกไปด้วย เพื่อให้ frontend แสดงข้อมูลได้
        p.low_stock_threshold   AS min_quantity
      FROM products p
      CROSS JOIN branches b
      LEFT JOIN current_stock cs ON cs.product_id = p.id AND cs.branch_id = b.id
      -- WHERE กรองเฉพาะสินค้าที่สต๊อกต่ำกว่า threshold และยังไม่ถูก soft-delete
      WHERE COALESCE(cs.stock, 0) < p.low_stock_threshold
        AND p.is_deleted = 0 AND b.is_deleted = 0
        ${branchFilter}
      ORDER BY b.name, p.name
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── getSettings (AlertsPage) ─────────────────────────────────
// GET /api/alerts/settings — ดึงกฎแจ้งเตือนทั้งหมดจากตาราง alerts
// ใช้ในหน้า AlertsPage.jsx เพื่อแสดงรายการกฎที่ตั้งไว้ (ไม่กรองตาม stock)
// admin เห็นทุกสาขา, manager เห็นแค่สาขาตัวเอง
const getSettings = async (req, res) => {
  const { sql, params } = branchClause(req);
  try {
    const [rows] = await pool.query(`
      SELECT
        a.id, a.product_id, a.branch_id, a.min_quantity, a.is_active,
        p.name AS product_name, p.sku, p.unit,
        b.name AS branch_name,
        -- COALESCE คืน 0 ถ้า cs.stock เป็น null (ยังไม่มี transaction)
        COALESCE(cs.stock, 0) AS stock
      FROM alerts a
      JOIN  products p ON a.product_id = p.id
      JOIN  branches b ON a.branch_id  = b.id
      -- LEFT JOIN เพราะสินค้าในกฎอาจยังไม่มี transaction (สต๊อก = 0)
      LEFT JOIN current_stock cs ON cs.product_id = a.product_id AND cs.branch_id = a.branch_id
      -- กรองเฉพาะกฎที่ active (is_active = 1)
      WHERE a.is_active = 1 ${sql}
      ORDER BY b.name, p.name
    `, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── create ──────────────────────────────────────────────────
// POST /api/alerts — สร้างกฎแจ้งเตือนใหม่ (upsert: อัปเดตถ้ามีอยู่แล้ว)
// รับ: { product_id, branch_id (admin only), min_quantity }
// ถ้ามีกฎเดิมสำหรับ product+branch เดียวกัน จะ update แทน insert ใหม่
// จำนวนขั้นต่ำต้องเป็นจำนวนเต็มไม่ติดลบ
const validMin = (v) => Number.isInteger(Number(v)) && Number(v) >= 0 && String(v ?? '').trim() !== '';

const create = async (req, res) => {
  const { product_id, min_quantity } = req.body;
  // admin สามารถระบุ branch_id ได้เอง, manager ใช้สาขาตัวเอง
  const branch_id = isAdmin(req) ? req.body.branch_id : ownBranch(req);
  if (!validMin(min_quantity)) return res.status(400).json({ message: 'จำนวนขั้นต่ำต้องเป็นจำนวนเต็มไม่ติดลบ' });
  try {
    const [[p]] = await pool.query('SELECT id FROM products WHERE id = ? AND is_deleted = 0', [product_id]);
    if (!p) return res.status(400).json({ message: 'ไม่พบสินค้านี้' });
    const [[b]] = await pool.query('SELECT id FROM branches WHERE id = ? AND is_deleted = 0', [branch_id]);
    if (!b) return res.status(400).json({ message: 'ไม่พบสาขานี้' });
    // เช็คว่ามีกฎสำหรับ product+branch นี้อยู่แล้วหรือไม่
    const [existing] = await pool.query(
      'SELECT id FROM alerts WHERE product_id=? AND branch_id=?',
      [product_id, branch_id]
    );

    if (existing.length > 0) {
      // มีกฎอยู่แล้ว: อัปเดต min_quantity และเปิดใช้งาน (is_active=1)
      await pool.query(
        'UPDATE alerts SET min_quantity=?, is_active=1 WHERE product_id=? AND branch_id=?',
        [min_quantity, product_id, branch_id]
      );
      return res.json({ message: 'บันทึกกฎแจ้งเตือนแล้ว' });
    }

    // ไม่มีกฎเดิม: INSERT กฎใหม่
    const [result] = await pool.query(
      'INSERT INTO alerts (product_id, branch_id, min_quantity) VALUES (?,?,?)',
      [product_id, branch_id, min_quantity]
    );
    res.status(201).json({ id: result.insertId, product_id, branch_id, min_quantity });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── update ──────────────────────────────────────────────────
// PUT /api/alerts/:id — แก้ไขกฎแจ้งเตือนตาม id
// รับ: { min_quantity, is_active }
// manager แก้ได้เฉพาะกฎของสาขาตัวเอง (มีการตรวจสอบเพิ่ม)
const update = async (req, res) => {
  const { min_quantity, is_active } = req.body;
  if (!validMin(min_quantity)) return res.status(400).json({ message: 'จำนวนขั้นต่ำต้องเป็นจำนวนเต็มไม่ติดลบ' });
  try {
    if (!isAdmin(req)) {
      // manager: ตรวจสอบว่ากฎนี้เป็นของสาขาตัวเองหรือไม่
      const [[existing]] = await pool.query('SELECT branch_id FROM alerts WHERE id=?', [req.params.id]);
      if (!existing) return res.status(404).json({ message: 'ไม่พบกฎแจ้งเตือนนี้ (อาจถูกลบไปแล้ว)' });
      // ถ้ากฎนี้ไม่ใช่ของสาขาตัวเอง ปฏิเสธ
      if (existing.branch_id !== ownBranch(req)) return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ดูหรือแก้ไขรายการนี้' });
    }

    const [result] = await pool.query(
      'UPDATE alerts SET min_quantity=?, is_active=? WHERE id=?',
      [min_quantity, is_active, req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ message: 'ไม่พบกฎแจ้งเตือนนี้ (อาจถูกลบไปแล้ว)' });
    res.json({ message: 'บันทึกกฎแจ้งเตือนแล้ว' });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── remove ──────────────────────────────────────────────────
// DELETE /api/alerts/:id — ลบกฎแจ้งเตือนตาม id
// manager ลบได้เฉพาะกฎของสาขาตัวเอง
const remove = async (req, res) => {
  try {
    if (!isAdmin(req)) {
      // manager: ตรวจสอบว่ากฎนี้เป็นของสาขาตัวเองหรือไม่
      const [[existing]] = await pool.query('SELECT branch_id FROM alerts WHERE id=?', [req.params.id]);
      if (!existing) return res.status(404).json({ message: 'ไม่พบกฎแจ้งเตือนนี้ (อาจถูกลบไปแล้ว)' });
      if (existing.branch_id !== ownBranch(req)) return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ดูหรือแก้ไขรายการนี้' });
    }

    const [result] = await pool.query('DELETE FROM alerts WHERE id=?', [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ message: 'ไม่พบกฎแจ้งเตือนนี้ (อาจถูกลบไปแล้ว)' });
    res.json({ message: 'ลบกฎแจ้งเตือนแล้ว' });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

module.exports = { getAll, getSettings, create, update, remove };
