// ============================================================
// inventoryController.js — จัดการ logic การรับ/ออกสินค้าและดูสต๊อก
// ไฟล์นี้ทำหน้าที่:
//   receive      — บันทึกการรับสินค้าเข้า (เพิ่มสต๊อก)
//   issue        — บันทึกการออกสินค้า (ลดสต๊อก)
//   getAllStock   — ดูสต๊อกปัจจุบันทุกสินค้า (จาก view current_stock)
//   getBranchStock — ดูสต๊อกเฉพาะสาขาเดียว
//   getHistory   — ดูประวัติ transaction ย้อนหลัง (กรองได้หลายเงื่อนไข)
// ============================================================

const pool = require('../config/db');
const { isAdmin, ownBranch } = require('../utils/permissions');
const { lockStock, isPositiveInt, getWarehouse, THRESHOLD_JOIN, THRESHOLD_SQL, THRESHOLD_SOURCE_SQL } = require('../utils/stock');

// ค่ากลางของสินค้า (ใช้เมื่อสาขาไม่ได้ตั้งกฎแจ้งเตือนเฉพาะ)
const productThreshold = async (productId) => {
  const [[p]] = await pool.query('SELECT low_stock_threshold FROM products WHERE id = ?', [productId]);
  return p ? Number(p.low_stock_threshold) : 0;
};

// ตรวจข้อมูลเข้าของ receive/issue — จำนวนต้องเป็นจำนวนเต็มบวก (กันส่ง -50 ตรงมาทาง API
// เพื่อ "ออกสินค้าติดลบ" ซึ่งจะกลายเป็นเพิ่มสต๊อกโดยไม่ผ่านใบขอเบิก)
const validateMovement = async (product_id, branch_id, quantity) => {
  if (!isPositiveInt(quantity)) return 'จำนวนต้องเป็นจำนวนเต็มมากกว่า 0';
  if (!product_id) return 'กรุณาเลือกสินค้า';
  if (!branch_id) return 'กรุณาเลือกสาขา';
  const [[p]] = await pool.query('SELECT id FROM products WHERE id = ? AND is_deleted = 0', [product_id]);
  if (!p) return 'ไม่พบสินค้านี้';
  const [[b]] = await pool.query('SELECT id FROM branches WHERE id = ? AND is_deleted = 0', [branch_id]);
  if (!b) return 'ไม่พบสาขานี้';
  return null;
};

// ─── receive ─────────────────────────────────────────────────
// POST /api/inventory/receive — บันทึกการรับสินค้าเข้า "คลังหลัก" เท่านั้น
// (สาขาย่อยห้ามรับสินค้าตรงผ่านฟอร์มนี้ — ต้องรับผ่าน workflow ใบขอเบิกเท่านั้น
// ดู requisitionController.js#receive — เพื่อให้มีการอนุมัติ/จัดส่งตามขั้นตอนเสมอ)
// รับ: { product_id, branch_id (admin only, ต้องเป็นคลังหลัก), quantity, note }
// คืน: { message, stock_after, alert_triggered }
const receive = async (req, res) => {
  const { product_id, quantity, note } = req.body;

  // admin สามารถระบุ branch_id ได้เอง
  // manager/staff ใช้แค่ branch ของตัวเองเท่านั้น (ดึงจาก token)
  const branch_id = isAdmin(req) ? req.body.branch_id : ownBranch(req);

  const invalid = await validateMovement(product_id, branch_id, quantity);
  if (invalid) return res.status(400).json({ message: invalid });

  // getConnection ดึง connection จาก pool เพื่อใช้ transaction (ทำงานหลายขั้นตอนพร้อมกัน)
  // Transaction ทำให้ถ้าขั้นตอนไหนผิดพลาด จะย้อนกลับทุกอย่างได้ (rollback)
  const conn = await pool.getConnection();
  try {
    // เริ่ม transaction — ทุก query หลังจากนี้จะเป็นส่วนหนึ่งของ transaction
    await conn.beginTransaction();

    // ตรวจว่า branch_id ที่จะรับเข้าคือคลังหลัก (is_warehouse=1) เท่านั้น
    // ใช้กับทุก role รวม admin — ป้องกันไม่ให้ใครก็ตามรับสินค้าตรงเข้าสาขาย่อย
    // ข้าม workflow ใบขอเบิก (ซึ่งควบคุม อนุมัติ/จัดส่ง/ตัดสต๊อกคลังหลัก ให้ถูกต้อง)
    const warehouse = await getWarehouse(conn);
    if (!warehouse || Number(branch_id) !== Number(warehouse.id)) {
      await conn.rollback();
      return res.status(400).json({ message: 'รับสินค้าเข้าตรงได้เฉพาะสาขาคลังหลักเท่านั้น สาขาย่อยต้องรับสินค้าผ่านใบขอเบิกเท่านั้น' });
    }

    // ขั้น 1: ล็อกสินค้าแล้วคำนวณสต๊อกปัจจุบัน (กันกดซ้ำ/ทำพร้อมกันแล้วนับผิด — ดู utils/stock.js)
    const current = await lockStock(conn, product_id, branch_id);

    // คำนวณสต๊อกใหม่หลังรับเข้า
    const stock_after = current + Number(quantity);

    // ขั้น 2: บันทึก transaction ใหม่ลงตาราง transactions
    await conn.query(
      'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES (?,?,?,?,?,?,?)',
      // req.user.id คือ id ของ user ที่ทำรายการ (จาก token)
      // 'receive' คือประเภท transaction
      // note || null: ถ้าไม่มีหมายเหตุให้เก็บ null
      [product_id, branch_id, req.user.id, 'receive', quantity, stock_after, note || null]
    );

    // ขั้น 3: เช็คว่ามีกฎแจ้งเตือนสำหรับสินค้า+สาขานี้หรือไม่ (สำหรับ response)
    const [[alert]] = await conn.query(
      'SELECT * FROM alerts WHERE product_id=? AND branch_id=? AND is_active=1',
      [product_id, branch_id]
    );

    // ยืนยัน transaction ทั้งหมด (commit = บันทึกถาวร)
    await conn.commit();

    // ตอบกลับพร้อมสต๊อกใหม่ และบอกว่า alert ถูก trigger หรือไม่
    res.status(201).json({
      message: 'บันทึกรับสินค้าเข้าแล้ว',
      stock_after,
      // ถ้ามีกฎแจ้งเตือน และสต๊อกใหม่ต่ำกว่า threshold → true
      alert_triggered: stock_after < (alert ? alert.min_quantity : await productThreshold(product_id))
    });
  } catch (err) {
    // ถ้าเกิดข้อผิดพลาด ย้อนกลับทุกอย่างในระหว่าง transaction
    await conn.rollback();
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  } finally {
    // คืน connection กลับ pool เสมอ ไม่ว่าจะสำเร็จหรือผิดพลาด
    conn.release();
  }
};

// ─── issue ───────────────────────────────────────────────────
// POST /api/inventory/issue — บันทึกการออกสินค้า
// รับ: { product_id, branch_id (admin only), quantity, note }
// คืน: { message, stock_after, alert_triggered } หรือ 400 ถ้าสต๊อกไม่พอ
const issue = async (req, res) => {
  const { product_id, quantity, note } = req.body;
  const branch_id = isAdmin(req) ? req.body.branch_id : ownBranch(req);

  const invalid = await validateMovement(product_id, branch_id, quantity);
  if (invalid) return res.status(400).json({ message: invalid });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ล็อกสินค้าแล้วคำนวณสต๊อกปัจจุบัน — 2 request พร้อมกันจะไม่ตัดเกินสต๊อกที่มี
    const current = await lockStock(conn, product_id, branch_id);

    // ตรวจสอบว่าสต๊อกพอออกหรือไม่
    // ถ้าสต๊อกน้อยกว่าจำนวนที่ต้องการออก ยกเลิก transaction ทันที
    if (current < Number(quantity)) {
      await conn.rollback();
      return res.status(400).json({ message: `สต๊อกไม่พอ (คงเหลือ ${current})` });
    }

    // คำนวณสต๊อกหลังออก
    const stock_after = current - Number(quantity);

    // บันทึก transaction ออกสินค้า
    await conn.query(
      'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES (?,?,?,?,?,?,?)',
      [product_id, branch_id, req.user.id, 'issue', quantity, stock_after, note || null]
    );

    // เช็ค alert rule สำหรับ response
    const [[alert]] = await conn.query(
      'SELECT * FROM alerts WHERE product_id=? AND branch_id=? AND is_active=1',
      [product_id, branch_id]
    );

    await conn.commit();
    res.status(201).json({
      message: 'บันทึกออกสินค้าแล้ว',
      stock_after,
      alert_triggered: stock_after < (alert ? alert.min_quantity : await productThreshold(product_id))
    });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  } finally {
    conn.release();
  }
};

// ─── getAllStock ──────────────────────────────────────────────
// GET /api/inventory/stock — ดูสต๊อกปัจจุบันทุกสินค้าทุกสาขา
// admin เห็นทุกสาขา, manager/staff เห็นแค่สาขาตัวเอง
//
// หมายเหตุบั๊กที่แก้: เดิม query นี้ JOIN แบบ INNER JOIN ผ่าน view current_stock
// ซึ่งสร้างจาก SUM(...) GROUP BY ของตาราง transactions เท่านั้น
// ทำให้สินค้า/สาขาคู่ไหนที่ "ยังไม่เคยมี transaction เลย" (สต๊อก = 0) จะหายไปจากผลลัพธ์ทั้งแถว
// ไม่ใช่แค่ไม่แสดงเลข 0 — แต่สินค้านั้นจะไม่ปรากฏใน dashboard ของสาขานั้นเลย
// แก้โดย CROSS JOIN products × branches แล้ว LEFT JOIN current_stock พร้อม COALESCE(...,0)
// เพื่อให้ทุกสินค้าที่ยังไม่ถูกลบ แสดงครบทุกสาขา แม้สต๊อกจะเป็น 0
const getAllStock = async (req, res) => {
  try {
    const params = [];
    let branchFilter = '';

    if (!isAdmin(req)) {
      // non-admin: เพิ่มเงื่อนไขกรองสาขาตัวเองด้วย AND
      branchFilter = 'AND b.id = ?';
      params.push(ownBranch(req));
    }

    const [rows] = await pool.query(`
      SELECT
        p.id                    AS product_id,
        b.id                    AS branch_id,
        COALESCE(cs.stock, 0)   AS stock,
        p.name AS product_name, p.sku, p.category, p.unit,
        ${THRESHOLD_SQL}        AS low_stock_threshold,   -- เกณฑ์เฉพาะสาขา (ถ้าตั้ง) หรือค่ากลางของสินค้า
        ${THRESHOLD_SOURCE_SQL} AS threshold_source,
        b.name AS branch_name
      FROM products p
      CROSS JOIN branches b
      LEFT JOIN current_stock cs ON cs.product_id = p.id AND cs.branch_id = b.id
      ${THRESHOLD_JOIN}
      WHERE p.is_deleted = 0 AND b.is_deleted = 0
      ${branchFilter}
      ORDER BY b.name, p.name
    `, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── getBranchStock ───────────────────────────────────────────
// GET /api/inventory/stock/:branchId — ดูสต๊อกเฉพาะสาขาที่ระบุ
// manager/staff ดูได้เฉพาะสาขาของตัวเอง
// แก้บั๊กเดียวกับ getAllStock — เริ่มจาก products แล้ว LEFT JOIN แทนการ INNER JOIN current_stock
const getBranchStock = async (req, res) => {
  const { branchId } = req.params;

  // ตรวจสอบสิทธิ์: non-admin พยายามดูสาขาอื่น
  // != ใช้ non-strict comparison เพื่อรองรับ string vs number (branchId เป็น string จาก URL)
  if (!isAdmin(req) && ownBranch(req) != branchId) {
    return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ดูหรือแก้ไขรายการนี้' });
  }
  try {
    const [rows] = await pool.query(`
      SELECT p.id AS product_id, b.id AS branch_id,
        COALESCE(cs.stock, 0) AS stock,
        p.name as product_name, p.sku, p.category, p.unit,
        ${THRESHOLD_SQL} AS low_stock_threshold,
        ${THRESHOLD_SOURCE_SQL} AS threshold_source,
        b.name as branch_name
      FROM products p
      JOIN branches b ON b.id = ?
      LEFT JOIN current_stock cs ON cs.product_id = p.id AND cs.branch_id = b.id
      ${THRESHOLD_JOIN}
      WHERE p.is_deleted = 0
      ORDER BY p.name
    `, [branchId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── getHistory ───────────────────────────────────────────────
// GET /api/inventory/history — ดูประวัติ transaction
// รับ query parameters (ทั้งหมดไม่บังคับ):
//   branch_id  — กรองตามสาขา (admin เท่านั้น)
//   product_id — กรองตามสินค้า
//   type       — กรองตามประเภท ('receive' หรือ 'issue')
//   limit      — จำนวน record สูงสุด (default = 50)
//   offset     — ข้าม record แรกกี่อัน (ใช้ทำ pagination)
const getHistory = async (req, res) => {
  const { branch_id, product_id, type, limit = 50, offset = 0 } = req.query;
  try {
    // เริ่มต้น query พื้นฐาน JOIN 3 ตาราง
    // WHERE 1=1 เป็นเทคนิคที่ทำให้ต่อเงื่อนไข AND ... ได้ง่าย โดยไม่ต้องเช็คว่าเป็น condition แรกหรือไม่
    let query = `
      SELECT t.*, p.name as product_name, p.sku, b.name as branch_name, u.name as user_name
      FROM transactions t
      JOIN products p ON t.product_id = p.id
      JOIN branches b ON t.branch_id = b.id
      JOIN users u ON t.user_id = u.id
      WHERE 1=1 AND p.is_deleted = 0
    `;
    const params = [];

    if (!isAdmin(req)) {
      // non-admin เห็นแค่สาขาตัวเอง (บังคับ)
      query += ' AND t.branch_id = ?';
      params.push(ownBranch(req));
    } else if (branch_id) {
      // admin กรองตามสาขาที่ระบุ (ถ้ามี)
      query += ' AND t.branch_id = ?';
      params.push(branch_id);
    }

    // กรองตามสินค้า (ถ้ามี)
    if (product_id) { query += ' AND t.product_id = ?'; params.push(product_id); }

    // กรองตามประเภท receive/issue (ถ้ามี)
    if (type)       { query += ' AND t.type = ?';       params.push(type); }

    // เรียงจากใหม่สุด และจำกัดจำนวน record ด้วย LIMIT และ OFFSET
    query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    // Number() แปลง string เป็นตัวเลขเพราะ query params เป็น string เสมอ
    // limit 1–500 (ค่าเริ่มต้น 50), offset ≥ 0 — ค่าแปลกๆ จาก URL ไม่ทำให้ SQL พัง
    const lim = Math.min(500, Math.max(1, parseInt(limit, 10) || 50));
    const off = Math.max(0, parseInt(offset, 10) || 0);
    params.push(lim, off);

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

module.exports = { receive, issue, getAllStock, getBranchStock, getHistory };
