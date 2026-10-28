// ============================================================
// stock.js — helper คำนวณ/ล็อกสต๊อก ใช้ร่วมกันทุก controller ที่แก้สต๊อก
//
// ปัญหาที่แก้: เดิมแต่ละที่คำนวณสต๊อกด้วย SUM(...) แล้ว INSERT transaction ต่อ
// โดยไม่ล็อกอะไรเลย ถ้ามี 2 request พร้อมกัน (กดปุ่มซ้ำ / 2 คนทำพร้อมกัน)
// ทั้งคู่จะเห็นสต๊อกเดิม แล้วตัด/เพิ่มซ้ำ → สต๊อกติดลบหรือเพิ่มเกินจริง
//
// วิธีแก้: ก่อนอ่านสต๊อก ให้ล็อกแถวสินค้าใน products ด้วย SELECT ... FOR UPDATE
// (ต้องอยู่ใน transaction) request ที่สองจะรอจนตัวแรก commit แล้วค่อยอ่านค่าใหม่
// ============================================================

// ล็อกสินค้าแล้วคืนสต๊อกปัจจุบันของสินค้านั้นในสาขานั้น — ต้องเรียกภายใน transaction เท่านั้น
const lockStock = async (conn, productId, branchId) => {
  await conn.query('SELECT id FROM products WHERE id = ? FOR UPDATE', [productId]);
  const [[row]] = await conn.query(
    'SELECT COALESCE(SUM(CASE WHEN type="receive" THEN quantity ELSE -quantity END), 0) AS stock FROM transactions WHERE product_id=? AND branch_id=?',
    [productId, branchId]
  );
  return Number(row.stock);
};

// อ่านสต๊อกแบบไม่ล็อก (ใช้แสดงผลเท่านั้น) ของหลายสินค้าในสาขาเดียว → Map(product_id → stock)
const stockMap = async (db, branchId, productIds) => {
  const map = new Map();
  if (!branchId || productIds.length === 0) return map;
  const [rows] = await db.query(
    `SELECT product_id, SUM(CASE WHEN type="receive" THEN quantity ELSE -quantity END) AS stock
     FROM transactions WHERE branch_id = ? AND product_id IN (?) GROUP BY product_id`,
    [branchId, productIds]
  );
  rows.forEach((r) => map.set(r.product_id, Number(r.stock)));
  return map;
};

// จำนวนต้องเป็นจำนวนเต็มบวกเท่านั้น (กันค่าติดลบ/ทศนิยม/ข้อความ ที่ส่งตรงมาทาง API)
const isPositiveInt = (v) => Number.isInteger(Number(v)) && Number(v) > 0 && String(v).trim() !== '';
const isNonNegativeInt = (v) => Number.isInteger(Number(v)) && Number(v) >= 0 && String(v).trim() !== '';

// คลังหลักปัจจุบัน (ไม่นับสาขาที่ถูกลบแบบซ่อน)
const getWarehouse = async (db) => {
  const [[row]] = await db.query('SELECT id, name FROM branches WHERE is_warehouse = 1 AND is_deleted = 0 LIMIT 1');
  return row || null;
};

module.exports = { lockStock, stockMap, isPositiveInt, isNonNegativeInt, getWarehouse };
