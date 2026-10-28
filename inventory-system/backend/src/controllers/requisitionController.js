// ============================================================
// requisitionController.js — workflow ใบขอเบิกสินค้า (สาขา → คลังหลัก)
//
// ขั้นตอนหลัก:
//   1. สาขาสร้างใบขอเบิก (pending) — เห็นสต๊อกคลังหลักของแต่ละสินค้าก่อนขอ
//   2. คลังหลักอนุมัติ (approved) — เห็นสต๊อกที่มีจริงเทียบกับจำนวนที่ขอ / หรือปฏิเสธ (rejected)
//   3. คลังหลักจัดส่ง (shipped) — ตัดสต๊อกคลังหลักเท่าที่มีจริง
//   4. สาขาตรวจรับ แยก "สภาพดี" กับ "ชำรุด/บกพร่อง" — สภาพดีเท่านั้นที่เข้าสต๊อกสาขา
//        - ครบและไม่มีปัญหา → completed
//        - มีชำรุด / ขาด / คลังหลักส่งได้ไม่ครบ → disputed (แจ้งคลังหลักอัตโนมัติ)
//
// เคสที่มีปัญหา (disputed) ใช้ dispute_state บอกว่าอยู่ขั้นไหน:
//   awaiting_response — รอคลังหลักตอบกลับ
//   reshipping        — คลังหลักแจ้ง "กำลังจัดส่งใหม่" (สร้าง/ส่งของชดเชย)
//   awaiting_stock    — คลังหลักแจ้ง "สต๊อกยังไม่พอ รอสินค้าเข้า"
//   close_proposed    — คลังหลักขอปิดเคส รอสาขายืนยัน
// กฎการปิดเคส: ไม่มีฝ่ายไหนปิดเองได้ฝ่ายเดียว
//   - ปิดอัตโนมัติเมื่อสาขารับของชดเชยสภาพดีครบตามที่อนุมัติ หรือ
//   - คลังหลักตอบกลับแล้ว → ขอปิดเคสพร้อมเหตุผล → สาขากดยืนยัน (หรือปฏิเสธ กลับไปรอคลังหลักตอบ)
//
// ทุกการกระทำบันทึกลง requisition_events (ไทม์ไลน์ + ข้อความโต้ตอบระหว่าง 2 ฝ่าย)
// ทุกการกระทำที่เปลี่ยนสถานะ ล็อกแถวใบขอเบิกด้วย FOR UPDATE ก่อน — กดปุ่มซ้ำ/2 คนกดพร้อมกัน
// request ที่สองจะเห็นสถานะใหม่แล้วถูกปฏิเสธ ไม่ตัด/เพิ่มสต๊อกซ้ำ
// ============================================================

const pool = require('../config/db');
const { isAdmin, isWarehouseAuthority, isShipper, ownBranch } = require('../utils/permissions');
const { lockStock, stockMap, isPositiveInt, isNonNegativeInt, getWarehouse } = require('../utils/stock');

// ─── helpers ─────────────────────────────────────────────────

// ดึงใบขอเบิก — lock=true ใช้ภายใน transaction เพื่อล็อกแถวกันทำรายการซ้ำพร้อมกัน
const findRequisition = async (conn, id, lock = false) => {
  const [[row]] = await conn.query(`SELECT * FROM requisitions WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  return row || null;
};

const logEvent = (conn, requisitionId, userId, type, message = null) =>
  conn.query(
    'INSERT INTO requisition_events (requisition_id, user_id, type, message) VALUES (?, ?, ?, ?)',
    [requisitionId, userId, type, message]
  );

// สินค้าที่ไม่ได้เปิดใช้งานให้สาขานี้ (branch_products) — admin ข้ามการตรวจนี้
const findInactiveProductIds = async (conn, branchId, productIds) => {
  if (productIds.length === 0) return [];
  const [rows] = await conn.query(
    'SELECT product_id FROM branch_products WHERE branch_id = ? AND product_id IN (?) AND is_active = 1',
    [branchId, productIds]
  );
  const activeIds = new Set(rows.map((r) => r.product_id));
  return [...new Set(productIds)].filter((id) => !activeIds.has(id));
};

// ฝั่งคลังหลัก (ผู้อนุมัติ + พนักงานจัดส่ง) เข้าได้ทุกใบ, สาขาเข้าได้เฉพาะใบของตัวเอง
const seesAll = (req) => isWarehouseAuthority(req) || isShipper(req);
const canAccess = (req, requisition) => seesAll(req) || requisition.branch_id === ownBranch(req);

// ยืนยันรับของ / ยืนยันปิดเคส — เฉพาะสาขาที่สร้างใบนี้เท่านั้น
const isReceivingBranch = (req, requisition) => requisition.branch_id === ownBranch(req);

// รายการสินค้าพร้อม shortage = จำนวนที่ยังขาดและยังไม่มีของชดเชยครอบคลุม
//   shortage = อนุมัติ - ได้รับสภาพดีสะสม - ของชดเชยที่กำลังเตรียม/กำลังส่ง
// ใช้ approved_qty เป็นฐาน จึงครอบคลุมทั้ง ของชำรุด, ของหายระหว่างทาง และคลังหลักส่งได้ไม่ครบเพราะสต๊อกไม่พอ
const getItemsWithShortage = async (conn, requisitionId) => {
  const [rows] = await conn.query(`
    SELECT
      ri.id, ri.product_id, ri.requested_qty, ri.approved_qty, ri.shipped_qty, ri.received_qty, ri.defective_qty,
      p.name AS product_name, p.sku, p.unit,
      COALESCE((
        SELECT SUM(rsi.replacement_qty)
        FROM replacement_shipment_items rsi
        JOIN replacement_shipments rs ON rs.id = rsi.replacement_shipment_id
        WHERE rsi.requisition_item_id = ri.id AND rs.status IN ('preparing', 'shipped')
      ), 0) AS in_flight_replacement_qty
    FROM requisition_items ri
    JOIN products p ON p.id = ri.product_id
    WHERE ri.requisition_id = ?
    ORDER BY ri.id
  `, [requisitionId]);

  return rows.map((r) => {
    const approved = Number(r.approved_qty || 0);
    const received = Number(r.received_qty || 0);
    const inFlight = Number(r.in_flight_replacement_qty);
    return { ...r, in_flight_replacement_qty: inFlight, shortage: Math.max(0, approved - received - inFlight) };
  });
};

// สต๊อกคลังหลักที่ "เบิกได้จริง" ต่อสินค้า = คงเหลือ − ที่อนุมัติให้สาขาอื่นไปแล้วแต่ยังไม่ได้ส่ง (จองไว้)
// excludeRequisitionId: ตอนแก้ไขใบเดิม ไม่ต้องนับยอดจองของใบตัวเอง
const availableStock = async (db, productIds, excludeRequisitionId = 0) => {
  const warehouse = await getWarehouse(db);
  const onHand = await stockMap(db, warehouse?.id, productIds);
  const reserved = new Map();
  if (productIds.length) {
    const [rows] = await db.query(
      `SELECT ri.product_id, SUM(ri.approved_qty) AS qty
       FROM requisition_items ri JOIN requisitions r ON r.id = ri.requisition_id
       WHERE r.status = 'approved' AND r.id <> ? AND ri.product_id IN (?)
       GROUP BY ri.product_id`,
      [excludeRequisitionId, productIds]
    );
    rows.forEach((x) => reserved.set(x.product_id, Number(x.qty)));
  }
  const out = new Map();
  productIds.forEach((id) => out.set(id, Math.max(0, (onHand.get(id) || 0) - (reserved.get(id) || 0))));
  return out;
};

// สาขาขอเบิกได้ไม่เกินที่คลังหลักมีให้เบิก — คลังหลักไม่มีของ = ขอไม่ได้
const checkAgainstWarehouse = async (conn, items, excludeRequisitionId) => {
  const ids = items.map((it) => Number(it.product_id));
  const avail = await availableStock(conn, ids, excludeRequisitionId);
  const [names] = await conn.query('SELECT id, name, unit FROM products WHERE id IN (?)', [ids]);
  const nameOf = new Map(names.map((n) => [n.id, n]));
  const problems = [];
  for (const it of items) {
    const id = Number(it.product_id);
    const have = avail.get(id) || 0;
    const p = nameOf.get(id) || { name: `สินค้า #${id}`, unit: '' };
    if (have <= 0) problems.push(`${p.name}: คลังหลักไม่มีของให้เบิก`);
    else if (Number(it.requested_qty) > have) problems.push(`${p.name}: ขอได้ไม่เกิน ${have} ${p.unit}`);
  }
  if (problems.length) throw new HttpError(400, ['ส่งใบขอเบิกไม่ได้', ...problems].join('\n'));
};

const validateItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return 'กรุณาระบุรายการสินค้าอย่างน้อย 1 รายการ';
  for (const it of items) {
    if (!it.product_id || !isPositiveInt(it.requested_qty)) {
      return 'ทุกรายการต้องเลือกสินค้า และจำนวนที่ขอเบิกต้องเป็นจำนวนเต็มมากกว่า 0';
    }
  }
  const ids = items.map((it) => Number(it.product_id));
  if (new Set(ids).size !== ids.length) return 'มีสินค้าซ้ำกันในใบขอเบิก — รวมเป็นรายการเดียว';
  return null;
};

// wrapper ลดโค้ดซ้ำของ handler ที่ใช้ transaction: เปิด → ทำงาน → commit / rollback อัตโนมัติ
// handler โยน HttpError เพื่อตอบ 4xx แล้ว rollback ให้เอง
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const withTx = (handler) => async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await handler(req, conn);
    await conn.commit();
    res.status(result?.status || 200).json(result?.body ?? result);
  } catch (err) {
    await conn.rollback();
    if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  } finally {
    conn.release();
  }
};

// โหลด + ล็อกใบขอเบิก แล้วตรวจสถานะที่อนุญาต
const loadForUpdate = async (conn, req, allowedStatuses, statusMessage) => {
  const requisition = await findRequisition(conn, req.params.id, true);
  if (!requisition) throw new HttpError(404, 'ไม่พบใบขอเบิก');
  if (!canAccess(req, requisition)) throw new HttpError(403, 'Access denied');
  if (allowedStatuses && !allowedStatuses.includes(requisition.status)) {
    throw new HttpError(400, `${statusMessage} (สถานะปัจจุบันเปลี่ยนไปแล้ว กรุณารีเฟรช)`);
  }
  return requisition;
};

// ─── list / action count ─────────────────────────────────────

// คำนวณว่าใบนี้ "รอผู้ใช้คนนี้ดำเนินการ" หรือไม่ — ใช้ไฮไลต์ในตาราง และนับ badge บนเมนู
// แยกหน้าที่: ผู้อนุมัติ = รออนุมัติ / สาขาแจ้งปัญหา, พนักงานจัดส่ง = รอจัดส่ง / ของชดเชยรอส่ง
const needsAction = (req, r) => {
  if (isShipper(req)) {
    return r.status === 'approved' || (r.status === 'disputed' && r.preparing_replacements > 0);
  }
  if (isWarehouseAuthority(req)) {
    return r.status === 'pending' || (r.status === 'disputed' && r.dispute_state === 'awaiting_response');
  }
  if (r.branch_id !== ownBranch(req)) return false;
  return r.status === 'shipped' || r.status === 'rejected'
    || (r.status === 'disputed' && (r.dispute_state === 'close_proposed' || r.shipped_replacements > 0));
};

const fetchList = async (req) => {
  const params = [];
  let where = 'WHERE 1=1';
  if (!seesAll(req)) {
    where += ' AND r.branch_id = ?';
    params.push(ownBranch(req));
  }
  if (req.query.status) {
    where += ' AND r.status = ?';
    params.push(req.query.status);
  }
  const [rows] = await pool.query(`
    SELECT
      r.id, r.branch_id, r.status, r.dispute_state, r.created_by, r.created_at, r.updated_at,
      r.note, r.reject_reason, r.approved_by, r.approved_at,
      b.name AS branch_name,
      creator.name AS created_by_name,
      approver.name AS approved_by_name,
      (SELECT COUNT(*) FROM requisition_items ri WHERE ri.requisition_id = r.id) AS item_count,
      (SELECT COUNT(*) FROM replacement_shipments rs WHERE rs.requisition_id = r.id AND rs.status = 'preparing') AS preparing_replacements,
      (SELECT COUNT(*) FROM replacement_shipments rs WHERE rs.requisition_id = r.id AND rs.status = 'shipped') AS shipped_replacements
    FROM requisitions r
    JOIN branches b ON b.id = r.branch_id
    JOIN users creator ON creator.id = r.created_by
    LEFT JOIN users approver ON approver.id = r.approved_by
    ${where}
    ORDER BY r.created_at DESC
  `, params);
  return rows.map((r) => ({ ...r, needs_action: needsAction(req, r) }));
};

// GET /api/requisitions
const list = async (req, res) => {
  try {
    res.json(await fetchList(req));
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// GET /api/requisitions/meta/action-count — จำนวนใบที่รอผู้ใช้คนนี้ดำเนินการ (badge บนเมนู)
const actionCount = async (req, res) => {
  try {
    const rows = await fetchList({ ...req, query: {} });
    res.json({ count: rows.filter((r) => r.needs_action).length });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// GET /api/requisitions/meta/warehouse-stock — สต๊อกคลังหลักทุกสินค้า (ให้สาขาเห็นก่อนขอเบิก)
// คืน { warehouse: {id, name}, stock: { [product_id]: จำนวน } } เฉพาะสินค้าที่สต๊อก ≠ 0
const warehouseStock = async (req, res) => {
  try {
    const warehouse = await getWarehouse(pool);
    if (!warehouse) return res.json({ warehouse: null, stock: {} });
    // คืน "เบิกได้" = คงเหลือ − ยอดที่อนุมัติให้สาขาอื่นแล้วแต่ยังไม่ส่ง (ใช้กฎเดียวกับตอนส่งใบขอเบิก)
    const [rows] = await pool.query(
      `SELECT product_id FROM transactions WHERE branch_id = ? GROUP BY product_id
       HAVING SUM(CASE WHEN type="receive" THEN quantity ELSE -quantity END) > 0`,
      [warehouse.id]
    );
    const avail = await availableStock(pool, rows.map((r) => r.product_id));
    const stock = {};
    avail.forEach((v, k) => { if (v > 0) stock[k] = v; });
    res.json({ warehouse, stock });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── getOne ──────────────────────────────────────────────────
// GET /api/requisitions/:id — รายละเอียด + สต๊อกคลังหลักต่อรายการ + ของชดเชย + ไทม์ไลน์
const getOne = async (req, res) => {
  try {
    const [[requisition]] = await pool.query(`
      SELECT
        r.id, r.branch_id, r.status, r.dispute_state, r.created_by, r.created_at, r.updated_at,
        r.note, r.reject_reason, r.approved_by, r.approved_at,
        b.name AS branch_name,
        creator.name AS created_by_name,
        approver.name AS approved_by_name
      FROM requisitions r
      JOIN branches b ON b.id = r.branch_id
      JOIN users creator ON creator.id = r.created_by
      LEFT JOIN users approver ON approver.id = r.approved_by
      WHERE r.id = ?
    `, [req.params.id]);

    if (!requisition) return res.status(404).json({ message: 'ไม่พบใบขอเบิก' });
    if (!canAccess(req, requisition)) return res.status(403).json({ message: 'คุณไม่มีสิทธิ์ดูหรือแก้ไขรายการนี้' });

    const warehouse = await getWarehouse(pool);
    const rawItems = await getItemsWithShortage(pool, req.params.id);
    const whStock = await stockMap(pool, warehouse?.id, rawItems.map((i) => i.product_id));
    // warehouse_available = คงเหลือ − ยอดที่อนุมัติให้ใบอื่นแล้วแต่ยังไม่ส่ง (ไม่นับใบนี้เอง)
    const whAvail = await availableStock(pool, rawItems.map((i) => i.product_id), requisition.id);
    const items = rawItems.map((i) => ({
      ...i,
      warehouse_stock: whStock.get(i.product_id) || 0,
      warehouse_available: whAvail.get(i.product_id) || 0,
    }));

    const [[shipment]] = await pool.query(`
      SELECT s.*, shipper.name AS shipped_by_name, receiver.name AS received_by_name
      FROM shipments s
      LEFT JOIN users shipper  ON shipper.id  = s.shipped_by
      LEFT JOIN users receiver ON receiver.id = s.received_by
      WHERE s.requisition_id = ?
    `, [req.params.id]);

    const [replacements] = await pool.query(`
      SELECT rs.*, creator.name AS created_by_name, shipper.name AS shipped_by_name, receiver.name AS received_by_name
      FROM replacement_shipments rs
      JOIN users creator ON creator.id = rs.created_by
      LEFT JOIN users shipper  ON shipper.id  = rs.shipped_by
      LEFT JOIN users receiver ON receiver.id = rs.received_by
      WHERE rs.requisition_id = ?
      ORDER BY rs.id
    `, [req.params.id]);

    const [replacementItemRows] = await pool.query(`
      SELECT rsi.*, p.name AS product_name, p.sku, p.unit
      FROM replacement_shipment_items rsi
      JOIN replacement_shipments rs ON rs.id = rsi.replacement_shipment_id
      JOIN products p ON p.id = rsi.product_id
      WHERE rs.requisition_id = ?
      ORDER BY rsi.id
    `, [req.params.id]);

    const [events] = await pool.query(`
      SELECT e.id, e.type, e.message, e.created_at, e.user_id,
        u.name AS user_name, u.role AS user_role, ub.name AS user_branch_name
      FROM requisition_events e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN branches ub ON ub.id = u.branch_id
      WHERE e.requisition_id = ?
      ORDER BY e.id
    `, [req.params.id]);

    const defects = await defectRecords(pool, requisition.id);
    const decided = new Map();
    defects.forEach((d) => decided.set(d.requisition_item_id, (decided.get(d.requisition_item_id) || 0) + d.qty));

    res.json({
      ...requisition,
      warehouse,
      items: items.map((i) => ({ ...i, defect_undecided: Math.max(0, Number(i.defective_qty || 0) - (decided.get(i.id) || 0)) })),
      defects,
      shipment: shipment || null,
      replacements: replacements.map((rs) => ({
        ...rs,
        items: replacementItemRows.filter((it) => it.replacement_shipment_id === rs.id),
      })),
      events,
    });
  } catch (err) {
    res.status(500).json({ message: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ', error: err.message });
  }
};

// ─── create ──────────────────────────────────────────────────
// POST /api/requisitions — สาขาสร้างใบขอเบิก { note, items: [{ product_id, requested_qty }] }
const create = withTx(async (req, conn) => {
  const { note, items } = req.body;
  const branch_id = ownBranch(req);
  if (!branch_id) throw new HttpError(400, 'บัญชีนี้ไม่ได้สังกัดสาขา');
  if (req.user.is_warehouse) throw new HttpError(400, 'สาขาคลังหลักไม่สามารถสร้างใบขอเบิกให้ตัวเองได้');
  const invalid = validateItems(items);
  if (invalid) throw new HttpError(400, invalid);

  if (!isAdmin(req)) {
    const inactive = await findInactiveProductIds(conn, branch_id, items.map((it) => Number(it.product_id)));
    if (inactive.length > 0) throw new HttpError(400, `สินค้า product_id=${inactive.join(', ')} ไม่ได้เปิดใช้งานสำหรับสาขานี้`);
  }
  await checkAgainstWarehouse(conn, items, 0);

  const [result] = await conn.query(
    'INSERT INTO requisitions (branch_id, status, created_by, note) VALUES (?, "pending", ?, ?)',
    [branch_id, req.user.id, note || null]
  );
  const id = result.insertId;
  for (const it of items) {
    await conn.query(
      'INSERT INTO requisition_items (requisition_id, product_id, requested_qty) VALUES (?, ?, ?)',
      [id, it.product_id, Number(it.requested_qty)]
    );
  }
  await logEvent(conn, id, req.user.id, 'created', note || null);
  return { status: 201, body: { id, branch_id, status: 'pending' } };
});

// ─── update ──────────────────────────────────────────────────
// PUT /api/requisitions/:id — แก้ใบที่ถูกปฏิเสธแล้วส่งใหม่
const update = withTx(async (req, conn) => {
  const { note, items } = req.body;
  const invalid = validateItems(items);
  if (invalid) throw new HttpError(400, invalid);

  const requisition = await loadForUpdate(conn, req, ['rejected'], 'แก้ไขได้เฉพาะใบขอเบิกที่ถูกปฏิเสธเท่านั้น');
  if (!isAdmin(req) && !isReceivingBranch(req, requisition)) throw new HttpError(403, 'แก้ไขได้เฉพาะสาขาเจ้าของใบขอเบิก');

  if (!isAdmin(req)) {
    const inactive = await findInactiveProductIds(conn, requisition.branch_id, items.map((it) => Number(it.product_id)));
    if (inactive.length > 0) throw new HttpError(400, `สินค้า product_id=${inactive.join(', ')} ไม่ได้เปิดใช้งานสำหรับสาขานี้`);
  }
  await checkAgainstWarehouse(conn, items, requisition.id);

  await conn.query('DELETE FROM requisition_items WHERE requisition_id = ?', [requisition.id]);
  for (const it of items) {
    await conn.query(
      'INSERT INTO requisition_items (requisition_id, product_id, requested_qty) VALUES (?, ?, ?)',
      [requisition.id, it.product_id, Number(it.requested_qty)]
    );
  }
  await conn.query(
    'UPDATE requisitions SET status = "pending", note = ?, reject_reason = NULL WHERE id = ?',
    [note || null, requisition.id]
  );
  await logEvent(conn, requisition.id, req.user.id, 'resubmitted', note || null);
  return { message: 'แก้ไขและส่งใบขอเบิกใหม่แล้ว' };
});

// ─── remove ──────────────────────────────────────────────────
// DELETE /api/requisitions/:id — ยกเลิกใบที่ยังไม่อนุมัติ (pending/rejected)
const remove = withTx(async (req, conn) => {
  const requisition = await loadForUpdate(conn, req, ['pending', 'rejected'], 'ยกเลิกได้เฉพาะใบขอเบิกที่ยังไม่ได้รับการอนุมัติเท่านั้น');
  if (!isAdmin(req) && !isReceivingBranch(req, requisition)) throw new HttpError(403, 'ยกเลิกได้เฉพาะสาขาเจ้าของใบขอเบิก');
  await conn.query('DELETE FROM requisitions WHERE id = ?', [requisition.id]);
  return { message: 'ลบใบขอเบิกแล้ว' };
});

// ─── approve ─────────────────────────────────────────────────
// PUT /api/requisitions/:id/approve — คลังหลักอนุมัติ { items: [{ item_id, approved_qty }] }
// อนุมัติเกินสต๊อกที่มีได้ (เผื่อของกำลังจะเข้า) แต่หน้าเว็บจะแสดงสต๊อกจริงให้เห็นก่อนกด
const approve = withTx(async (req, conn) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'กรุณาระบุจำนวนที่อนุมัติของแต่ละรายการ');

  const requisition = await loadForUpdate(conn, req, ['pending'], 'อนุมัติได้เฉพาะใบขอเบิกที่รอพิจารณาเท่านั้น');

  const [dbItems] = await conn.query(
    'SELECT ri.id, ri.product_id, ri.requested_qty, p.name, p.unit FROM requisition_items ri JOIN products p ON p.id = ri.product_id WHERE ri.requisition_id = ?',
    [requisition.id]
  );
  const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));
  // อนุมัติได้ไม่เกินของที่มีให้เบิกจริง (ล็อกสินค้าก่อน กันอนุมัติพร้อมกัน 2 ใบแล้วเกินสต๊อก)
  for (const d of dbItems) await conn.query('SELECT id FROM products WHERE id = ? FOR UPDATE', [d.product_id]);
  const avail = await availableStock(conn, dbItems.map((d) => d.product_id), requisition.id);
  let total = 0;
  const lines = [];
  for (const it of items) {
    const dbItem = dbItemMap.get(Number(it.item_id));
    if (!dbItem) throw new HttpError(400, `ไม่พบรายการสินค้า item_id=${it.item_id} ในใบขอเบิกนี้`);
    if (!isNonNegativeInt(it.approved_qty) || Number(it.approved_qty) > dbItem.requested_qty) {
      throw new HttpError(400, `จำนวนที่อนุมัติของ ${dbItem.name} ต้องเป็นจำนวนเต็ม 0 ถึง ${dbItem.requested_qty}`);
    }
    const have = avail.get(dbItem.product_id) || 0;
    if (Number(it.approved_qty) > have) {
      throw new HttpError(400, have <= 0
        ? `${dbItem.name}: คลังหลักไม่มีของให้เบิก — อนุมัติไม่ได้ (ใส่ 0 หรือปฏิเสธใบนี้)`
        : `${dbItem.name}: อนุมัติได้ไม่เกินที่คลังหลักมีให้เบิก (${have} ${dbItem.unit})`);
    }
    total += Number(it.approved_qty);
    if (Number(it.approved_qty) !== dbItem.requested_qty) lines.push(`${dbItem.name}: อนุมัติ ${it.approved_qty}/${dbItem.requested_qty}`);
    await conn.query('UPDATE requisition_items SET approved_qty = ? WHERE id = ?', [Number(it.approved_qty), dbItem.id]);
  }
  if (total === 0) throw new HttpError(400, 'อนุมัติ 0 ทุกรายการไม่ได้ — ถ้าคลังหลักไม่มีของให้เลย ให้กด "ปฏิเสธ" พร้อมเหตุผลแทน');

  await conn.query(
    'UPDATE requisitions SET status = "approved", approved_by = ?, approved_at = NOW() WHERE id = ?',
    [req.user.id, requisition.id]
  );
  await conn.query('INSERT INTO shipments (requisition_id, status) VALUES (?, "preparing")', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'approved', lines.length ? lines.join('\n') : 'อนุมัติครบทุกรายการตามที่ขอ');
  return { message: 'อนุมัติแล้ว — ส่งต่อให้พนักงานจัดส่งของคลังหลัก' };
});

// ─── reject ──────────────────────────────────────────────────
const reject = withTx(async (req, conn) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) throw new HttpError(400, 'กรุณาระบุเหตุผลที่ปฏิเสธ');
  const requisition = await loadForUpdate(conn, req, ['pending'], 'ปฏิเสธได้เฉพาะใบขอเบิกที่รอพิจารณาเท่านั้น');
  await conn.query('UPDATE requisitions SET status = "rejected", reject_reason = ? WHERE id = ?', [reason, requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'rejected', reason);
  return { message: 'ปฏิเสธใบขอเบิกแล้ว' };
});

// ─── ship ────────────────────────────────────────────────────
// PUT /api/requisitions/:id/ship — คลังหลักจัดส่ง ตัดสต๊อกเท่าที่มีจริง (ล็อกสต๊อกต่อสินค้า)
const ship = withTx(async (req, conn) => {
  const { note } = req.body;
  const requisition = await loadForUpdate(conn, req, ['approved'], 'จัดส่งได้เฉพาะใบขอเบิกที่อนุมัติแล้วเท่านั้น');
  const warehouse = await getWarehouse(conn);
  if (!warehouse) throw new HttpError(400, 'ยังไม่ได้ตั้งค่าสาขาคลังหลัก');

  const [items] = await conn.query(
    'SELECT ri.id, ri.product_id, ri.approved_qty, p.name AS product_name FROM requisition_items ri JOIN products p ON p.id = ri.product_id WHERE ri.requisition_id = ?',
    [requisition.id]
  );

  const shortages = [];
  let totalShipped = 0;
  for (const item of items) {
    const approvedQty = Number(item.approved_qty) || 0;
    const current = await lockStock(conn, item.product_id, warehouse.id);
    const shippedQty = Math.max(0, Math.min(approvedQty, current));
    if (shippedQty < approvedQty) shortages.push(`${item.product_name} ส่งได้ ${shippedQty}/${approvedQty} (สต๊อกไม่พอ)`);
    totalShipped += shippedQty;

    await conn.query('UPDATE requisition_items SET shipped_qty = ? WHERE id = ?', [shippedQty, item.id]);
    if (shippedQty > 0) {
      await conn.query(
        'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES (?,?,?,"issue",?,?,?)',
        [item.product_id, warehouse.id, req.user.id, shippedQty, current - shippedQty, `จัดส่งตามใบขอเบิก #${requisition.id}`]
      );
    }
  }
  if (totalShipped === 0) {
    throw new HttpError(400, 'คลังหลักไม่มีสต๊อกของสินค้าที่อนุมัติเลยสักรายการ — รับสินค้าเข้าคลังก่อนแล้วค่อยจัดส่ง');
  }

  const fullNote = [note || null, ...shortages.map((s) => `[ระบบ] ${s}`)].filter(Boolean).join('\n') || null;
  await conn.query(
    'UPDATE shipments SET status = "shipped", shipped_at = NOW(), shipped_by = ?, note = ? WHERE requisition_id = ?',
    [req.user.id, fullNote, requisition.id]
  );
  await conn.query('UPDATE requisitions SET status = "shipped" WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'shipped', fullNote);
  return {
    message: shortages.length
      ? 'จัดส่งแล้ว แต่บางรายการสต๊อกไม่พอ ส่งได้เท่าที่มี — ส่วนที่ขาดจะเปิดเป็นเคสให้ติดตามหลังสาขารับของ'
      : 'จัดส่งสินค้าแล้ว และตัดสต๊อกคลังหลักเรียบร้อย',
  };
});

// ─── receive ─────────────────────────────────────────────────
// PUT /api/requisitions/:id/receive — สาขาตรวจรับสินค้า
// รับ: { items: [{ item_id, received_qty (สภาพดี), defective_qty (ชำรุด/บกพร่อง) }], issue, issue_note }
// สภาพดีเข้าสต๊อกสาขา, ชำรุดไม่เข้าสต๊อก — ถ้ามีชำรุด/ขาด/ส่งไม่ครบ → disputed แจ้งคลังหลักอัตโนมัติ
const receive = withTx(async (req, conn) => {
  const { items, issue, issue_note } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'กรุณาระบุจำนวนที่ได้รับของแต่ละรายการ');

  const requisition = await loadForUpdate(conn, req, ['shipped'], 'ยืนยันรับของได้เฉพาะใบขอเบิกที่จัดส่งแล้วเท่านั้น');
  if (!isReceivingBranch(req, requisition)) throw new HttpError(403, 'เฉพาะสาขาที่สร้างใบขอเบิกนี้เท่านั้นที่ยืนยันรับสินค้าได้');

  const [dbItems] = await conn.query(
    'SELECT ri.id, ri.product_id, ri.approved_qty, ri.shipped_qty, p.name FROM requisition_items ri JOIN products p ON p.id = ri.product_id WHERE ri.requisition_id = ?',
    [requisition.id]
  );
  const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));
  if (items.length !== dbItems.length) throw new HttpError(400, 'กรุณาระบุผลการตรวจรับให้ครบทุกรายการ');

  const problems = [];      // ชำรุด / ขาดระหว่างทาง (ปัญหาที่สาขาเจอ)
  const notShipped = [];    // คลังหลักส่งไม่ครบเพราะสต๊อกไม่พอ
  for (const it of items) {
    const dbItem = dbItemMap.get(Number(it.item_id));
    if (!dbItem) throw new HttpError(400, `ไม่พบรายการสินค้า item_id=${it.item_id} ในใบขอเบิกนี้`);
    const good = it.received_qty ?? 0;
    const bad = it.defective_qty ?? 0;
    const shipped = Number(dbItem.shipped_qty) || 0;
    if (!isNonNegativeInt(good) || !isNonNegativeInt(bad)) throw new HttpError(400, `จำนวนของ ${dbItem.name} ต้องเป็นจำนวนเต็มไม่ติดลบ`);
    if (Number(good) + Number(bad) > shipped) {
      throw new HttpError(400, `${dbItem.name}: สภาพดี + ชำรุด รวมกันต้องไม่เกินจำนวนที่จัดส่ง (${shipped})`);
    }
    const missing = shipped - Number(good) - Number(bad);
    if (Number(bad) > 0) problems.push(`${dbItem.name}: ชำรุด/บกพร่อง ${bad}`);
    if (missing > 0) problems.push(`${dbItem.name}: ขาด ${missing} (ส่งมา ${shipped} ได้รับ ${Number(good) + Number(bad)})`);
    if (shipped < Number(dbItem.approved_qty || 0)) notShipped.push(`${dbItem.name}: คลังหลักส่งได้ ${shipped}/${dbItem.approved_qty}`);

    await conn.query('UPDATE requisition_items SET received_qty = ?, defective_qty = ? WHERE id = ?', [Number(good), Number(bad), dbItem.id]);
    if (Number(good) > 0) {
      const current = await lockStock(conn, dbItem.product_id, requisition.branch_id);
      await conn.query(
        'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES (?,?,?,"receive",?,?,?)',
        [dbItem.product_id, requisition.branch_id, req.user.id, Number(good), current + Number(good), `รับสินค้าตามใบขอเบิก #${requisition.id}`]
      );
    }
  }

  const hasProblem = Boolean(issue) || problems.length > 0;
  if (hasProblem && !(issue_note || '').trim() && problems.length === 0) {
    throw new HttpError(400, 'กรุณาอธิบายปัญหาที่พบ');
  }

  if (hasProblem || notShipped.length > 0) {
    // มีปัญหาจากการขนส่ง → รอคลังหลักตอบ / ส่งไม่ครบเพราะสต๊อกไม่พออย่างเดียว → ถือว่ารอสต๊อก
    const state = hasProblem ? 'awaiting_response' : 'awaiting_stock';
    await conn.query(
      `UPDATE shipments SET status = ?, received_at = NOW(), received_by = ?, issue_note = ? WHERE requisition_id = ?`,
      [hasProblem ? 'received_issue' : 'received_ok', req.user.id, issue_note || null, requisition.id]
    );
    await conn.query('UPDATE requisitions SET status = "disputed", dispute_state = ? WHERE id = ?', [state, requisition.id]);
    const msg = [...problems, ...notShipped, issue_note ? `หมายเหตุ: ${issue_note}` : null].filter(Boolean).join('\n');
    await logEvent(conn, requisition.id, req.user.id, hasProblem ? 'issue_reported' : 'received_partial', msg);
    return {
      message: hasProblem
        ? 'บันทึกการรับของแล้ว — แจ้งปัญหาไปที่คลังหลักแล้ว รอคลังหลักตอบกลับ'
        : 'บันทึกการรับของแล้ว — ยังขาดสินค้าที่คลังหลักส่งไม่ครบ เคสยังเปิดอยู่จนกว่าจะได้ครบหรือตกลงปิดเคสร่วมกัน',
    };
  }

  await conn.query(
    'UPDATE shipments SET status = "received_ok", received_at = NOW(), received_by = ? WHERE requisition_id = ?',
    [req.user.id, requisition.id]
  );
  await conn.query('UPDATE requisitions SET status = "completed", dispute_state = NULL WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'received_ok', null);
  return { message: 'บันทึกการรับของแล้ว ครบถ้วนสมบูรณ์' };
});

// ─── เคสที่มีปัญหา: ตอบกลับ / ข้อความ / ขอปิด / ยืนยันปิด / ปฏิเสธการปิด ─────

// PUT /api/requisitions/:id/respond — คลังหลักแจ้งสถานะ { state: 'reshipping'|'awaiting_stock', message }
const respond = withTx(async (req, conn) => {
  const { state, message } = req.body;
  if (!['reshipping', 'awaiting_stock'].includes(state)) throw new HttpError(400, 'สถานะที่ตอบกลับไม่ถูกต้อง');
  const requisition = await loadForUpdate(conn, req, ['disputed'], 'ตอบกลับได้เฉพาะเคสที่มีปัญหาเท่านั้น');
  await conn.query('UPDATE requisitions SET dispute_state = ? WHERE id = ?', [state, requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, `response_${state}`, message || null);
  return { message: 'แจ้งสถานะไปที่สาขาแล้ว' };
});

// POST /api/requisitions/:id/messages — ส่งข้อความในใบขอเบิก (ทั้ง 2 ฝ่าย) { message }
const addMessage = withTx(async (req, conn) => {
  const { message } = req.body;
  if (!message || !message.trim()) throw new HttpError(400, 'กรุณาพิมพ์ข้อความ');
  const requisition = await loadForUpdate(conn, req, null);
  await logEvent(conn, requisition.id, req.user.id, 'message', message.trim());
  return { status: 201, body: { message: 'ส่งข้อความแล้ว' } };
});

// PUT /api/requisitions/:id/propose-close — คลังหลักขอปิดเคส { message } (ต้องตอบกลับสาขาก่อน และไม่มีของชดเชยค้างส่ง)
const proposeClose = withTx(async (req, conn) => {
  const { message } = req.body;
  if (!message || !message.trim()) throw new HttpError(400, 'กรุณาระบุเหตุผล/ข้อสรุปของการปิดเคส ให้สาขาพิจารณา');
  const requisition = await loadForUpdate(conn, req, ['disputed'], 'ขอปิดเคสได้เฉพาะเคสที่มีปัญหาเท่านั้น');
  if (requisition.dispute_state === 'awaiting_response') {
    throw new HttpError(400, 'ต้องแจ้งสถานะให้สาขาก่อน (กำลังจัดส่งใหม่ / สต๊อกยังไม่พอ) ถึงจะขอปิดเคสได้');
  }
  if (requisition.dispute_state === 'close_proposed') throw new HttpError(400, 'ส่งคำขอปิดเคสไปแล้ว รอสาขายืนยัน');
  const [[{ inflight }]] = await conn.query(
    "SELECT COUNT(*) AS inflight FROM replacement_shipments WHERE requisition_id = ? AND status IN ('preparing','shipped')",
    [requisition.id]
  );
  if (inflight > 0) throw new HttpError(400, 'ยังมีของชดเชยที่ยังไม่ถึงสาขา — รอสาขารับของก่อนค่อยขอปิดเคส');
  if ((await undecidedDefects(conn, requisition.id)) > 0) {
    throw new HttpError(400, 'ยังมีของชำรุดที่ยังไม่ได้ตัดสินใจ — เลือกก่อนว่า "ตัดทิ้งที่สาขา" หรือ "ให้ส่งคืนคลังหลัก"');
  }

  await conn.query('UPDATE requisitions SET dispute_state = "close_proposed" WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'close_proposed', message.trim());
  return { message: 'ส่งคำขอปิดเคสแล้ว รอสาขายืนยัน' };
});

// PUT /api/requisitions/:id/accept-close — สาขายืนยันปิดเคส
const acceptClose = withTx(async (req, conn) => {
  const requisition = await loadForUpdate(conn, req, ['disputed'], 'เคสนี้ไม่ได้อยู่ในสถานะรอปิด');
  if (!isReceivingBranch(req, requisition)) throw new HttpError(403, 'เฉพาะสาขาเจ้าของใบขอเบิกเท่านั้นที่ยืนยันปิดเคสได้');
  if (requisition.dispute_state !== 'close_proposed') throw new HttpError(400, 'คลังหลักยังไม่ได้ขอปิดเคส — ปิดเคสฝ่ายเดียวไม่ได้');
  await conn.query('UPDATE requisitions SET status = "completed", dispute_state = NULL WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'close_accepted', req.body.message || null);
  return { message: 'ปิดเคสเรียบร้อย' };
});

// PUT /api/requisitions/:id/decline-close — สาขาไม่ยอมรับการปิดเคส { message } → กลับไปรอคลังหลักตอบ
const declineClose = withTx(async (req, conn) => {
  const { message } = req.body;
  if (!message || !message.trim()) throw new HttpError(400, 'กรุณาระบุเหตุผลที่ยังไม่ยอมรับการปิดเคส');
  const requisition = await loadForUpdate(conn, req, ['disputed'], 'เคสนี้ไม่ได้อยู่ในสถานะรอปิด');
  if (!isReceivingBranch(req, requisition)) throw new HttpError(403, 'เฉพาะสาขาเจ้าของใบขอเบิกเท่านั้น');
  if (requisition.dispute_state !== 'close_proposed') throw new HttpError(400, 'คลังหลักยังไม่ได้ขอปิดเคส');
  await conn.query('UPDATE requisitions SET dispute_state = "awaiting_response" WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'close_declined', message.trim());
  return { message: 'แจ้งคลังหลักแล้วว่ายังไม่ยอมรับการปิดเคส' };
});

// ─── ของชดเชย ─────────────────────────────────────────────────

// POST /api/requisitions/:id/replacements — คลังหลักสร้างรายการชดเชย { items: [{ requisition_item_id, replacement_qty }], note }
// ยังไม่ตัดสต๊อก (ตัดตอนกดจัดส่ง) — สร้างแล้วเคสจะเป็น "กำลังจัดส่งใหม่" อัตโนมัติ
const createReplacement = withTx(async (req, conn) => {
  const { items, note } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'กรุณาระบุรายการสินค้าชดเชยอย่างน้อย 1 รายการ');
  const requisition = await loadForUpdate(conn, req, ['disputed'], 'สร้างรายการชดเชยได้เฉพาะเคสที่มีปัญหาเท่านั้น');
  if (requisition.dispute_state === 'close_proposed') throw new HttpError(400, 'ขอปิดเคสไปแล้ว — รอสาขาตอบก่อน');
  const warehouse = await getWarehouse(conn);
  if (!warehouse) throw new HttpError(400, 'ยังไม่ได้ตั้งค่าสาขาคลังหลัก');

  const shortageMap = new Map((await getItemsWithShortage(conn, requisition.id)).map((r) => [r.id, r]));
  const neededByProduct = new Map();
  const validated = [];
  for (const it of items) {
    const row = shortageMap.get(Number(it.requisition_item_id));
    if (!row) throw new HttpError(400, `ไม่พบรายการ requisition_item_id=${it.requisition_item_id} ในใบขอเบิกนี้`);
    if (!isPositiveInt(it.replacement_qty) || Number(it.replacement_qty) > row.shortage) {
      throw new HttpError(400, `จำนวนชดเชยของ ${row.product_name} ต้องเป็นจำนวนเต็ม 1 ถึง ${row.shortage}`);
    }
    const qty = Number(it.replacement_qty);
    validated.push({ requisition_item_id: row.id, product_id: row.product_id, product_name: row.product_name, qty });
    neededByProduct.set(row.product_id, (neededByProduct.get(row.product_id) || 0) + qty);
  }

  const whStock = await availableStock(conn, [...neededByProduct.keys()], requisition.id);
  for (const v of validated) {
    const have = whStock.get(v.product_id) || 0;
    if (have < neededByProduct.get(v.product_id)) {
      throw new HttpError(400, `สต๊อกคลังหลักไม่พอสำหรับ ${v.product_name} (ต้องการ ${neededByProduct.get(v.product_id)}, มี ${have}) — แจ้งสาขาว่า "สต๊อกยังไม่พอ" แทน`);
    }
  }

  const [result] = await conn.query(
    'INSERT INTO replacement_shipments (requisition_id, status, note, created_by) VALUES (?, "preparing", ?, ?)',
    [requisition.id, note || null, req.user.id]
  );
  for (const v of validated) {
    await conn.query(
      'INSERT INTO replacement_shipment_items (replacement_shipment_id, requisition_item_id, product_id, replacement_qty) VALUES (?, ?, ?, ?)',
      [result.insertId, v.requisition_item_id, v.product_id, v.qty]
    );
  }
  await conn.query('UPDATE requisitions SET dispute_state = "reshipping" WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'replacement_created',
    [...validated.map((v) => `${v.product_name}: ${v.qty}`), note ? `หมายเหตุ: ${note}` : null].filter(Boolean).join('\n'));
  return { status: 201, body: { id: result.insertId, requisition_id: requisition.id, status: 'preparing', message: 'สร้างรายการชดเชยแล้ว — ส่งต่อให้พนักงานจัดส่ง' } };
});

// PUT /api/requisitions/:id/replacements/:replacementId/ship — คลังหลักส่งของชดเชย (ตัดสต๊อกตอนนี้)
const shipReplacement = withTx(async (req, conn) => {
  const { note } = req.body;
  const requisition = await loadForUpdate(conn, req, ['disputed'], 'ใบขอเบิกนี้ไม่ได้อยู่ในสถานะมีปัญหา');
  const [[replacement]] = await conn.query(
    'SELECT * FROM replacement_shipments WHERE id = ? AND requisition_id = ? FOR UPDATE',
    [req.params.replacementId, requisition.id]
  );
  if (!replacement) throw new HttpError(404, 'ไม่พบรายการจัดส่งชดเชย');
  if (replacement.status !== 'preparing') throw new HttpError(400, 'รายการชดเชยนี้จัดส่งไปแล้ว');
  const warehouse = await getWarehouse(conn);
  if (!warehouse) throw new HttpError(400, 'ยังไม่ได้ตั้งค่าสาขาคลังหลัก');

  const [items] = await conn.query(
    'SELECT rsi.id, rsi.product_id, rsi.replacement_qty, p.name AS product_name FROM replacement_shipment_items rsi JOIN products p ON p.id = rsi.product_id WHERE rsi.replacement_shipment_id = ?',
    [replacement.id]
  );
  for (const item of items) {
    const current = await lockStock(conn, item.product_id, warehouse.id);
    if (current < item.replacement_qty) {
      throw new HttpError(400, `สต๊อกคลังหลักไม่พอสำหรับ ${item.product_name} (ต้องการ ${item.replacement_qty}, มี ${current})`);
    }
    await conn.query(
      'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES (?,?,?,"issue",?,?,?)',
      [item.product_id, warehouse.id, req.user.id, item.replacement_qty, current - item.replacement_qty, `จัดส่งชดเชยใบขอเบิก #${requisition.id} (รอบ #${replacement.id})`]
    );
  }
  await conn.query(
    'UPDATE replacement_shipments SET status = "shipped", shipped_at = NOW(), shipped_by = ?, note = COALESCE(?, note) WHERE id = ?',
    [req.user.id, note || null, replacement.id]
  );
  await conn.query('UPDATE requisitions SET dispute_state = "reshipping" WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'replacement_shipped', `ของชดเชยรอบ #${replacement.id}${note ? `\n${note}` : ''}`);
  return { message: 'จัดส่งสินค้าชดเชยแล้ว และตัดสต๊อกคลังหลักเรียบร้อย' };
});

// PUT /api/requisitions/:id/replacements/:replacementId/receive — สาขาตรวจรับของชดเชย
// รับ: { items: [{ replacement_item_id, received_qty (สภาพดี), defective_qty }] }
const receiveReplacement = withTx(async (req, conn) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'กรุณาระบุจำนวนที่ได้รับของแต่ละรายการ');
  const requisition = await loadForUpdate(conn, req, ['disputed'], 'ใบขอเบิกนี้ไม่ได้อยู่ในสถานะมีปัญหา');
  if (!isReceivingBranch(req, requisition)) throw new HttpError(403, 'เฉพาะสาขาที่สร้างใบขอเบิกนี้เท่านั้นที่ยืนยันรับสินค้าชดเชยได้');

  const [[replacement]] = await conn.query(
    'SELECT * FROM replacement_shipments WHERE id = ? AND requisition_id = ? FOR UPDATE',
    [req.params.replacementId, requisition.id]
  );
  if (!replacement) throw new HttpError(404, 'ไม่พบรายการจัดส่งชดเชย');
  if (replacement.status !== 'shipped') throw new HttpError(400, 'ยืนยันรับได้เฉพาะของชดเชยที่จัดส่งแล้วและยังไม่ได้รับ');

  const [dbItems] = await conn.query(
    'SELECT rsi.id, rsi.requisition_item_id, rsi.product_id, rsi.replacement_qty, p.name FROM replacement_shipment_items rsi JOIN products p ON p.id = rsi.product_id WHERE rsi.replacement_shipment_id = ?',
    [replacement.id]
  );
  const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));
  const problems = [];
  for (const it of items) {
    const dbItem = dbItemMap.get(Number(it.replacement_item_id));
    if (!dbItem) throw new HttpError(400, `ไม่พบรายการ replacement_item_id=${it.replacement_item_id}`);
    const good = it.received_qty ?? 0;
    const bad = it.defective_qty ?? 0;
    if (!isNonNegativeInt(good) || !isNonNegativeInt(bad)) throw new HttpError(400, `จำนวนของ ${dbItem.name} ต้องเป็นจำนวนเต็มไม่ติดลบ`);
    if (Number(good) + Number(bad) > dbItem.replacement_qty) {
      throw new HttpError(400, `${dbItem.name}: สภาพดี + ชำรุด ต้องไม่เกินจำนวนที่ส่งชดเชย (${dbItem.replacement_qty})`);
    }
    const missing = dbItem.replacement_qty - Number(good) - Number(bad);
    if (Number(bad) > 0) problems.push(`${dbItem.name}: ชำรุด ${bad}`);
    if (missing > 0) problems.push(`${dbItem.name}: ขาด ${missing}`);

    await conn.query('UPDATE replacement_shipment_items SET received_qty = ? WHERE id = ?', [Number(good), dbItem.id]);
    if (Number(good) > 0) {
      const current = await lockStock(conn, dbItem.product_id, requisition.branch_id);
      await conn.query(
        'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES (?,?,?,"receive",?,?,?)',
        [dbItem.product_id, requisition.branch_id, req.user.id, Number(good), current + Number(good), `รับสินค้าชดเชยใบขอเบิก #${requisition.id} (รอบ #${replacement.id})`]
      );
    }
    await conn.query(
      'UPDATE requisition_items SET received_qty = COALESCE(received_qty, 0) + ?, defective_qty = COALESCE(defective_qty, 0) + ? WHERE id = ?',
      [Number(good), Number(bad), dbItem.requisition_item_id]
    );
  }

  await conn.query(
    'UPDATE replacement_shipments SET status = "received", received_at = NOW(), received_by = ? WHERE id = ?',
    [req.user.id, replacement.id]
  );

  const rows = await getItemsWithShortage(conn, requisition.id);
  const fullyReceived = rows.every((i) => Number(i.received_qty || 0) >= Number(i.approved_qty || 0));
  const inFlight = rows.some((i) => i.in_flight_replacement_qty > 0);

  if (fullyReceived) {
    await conn.query('UPDATE requisitions SET status = "completed", dispute_state = NULL WHERE id = ?', [requisition.id]);
    await logEvent(conn, requisition.id, req.user.id, 'replacement_received', `ของชดเชยรอบ #${replacement.id} — ได้รับครบแล้ว ปิดเคสอัตโนมัติ`);
    return { message: 'รับของชดเชยครบแล้ว ปิดเคสเรียบร้อย' };
  }
  // ยังขาด: ถ้ามีของชดเชยรอบอื่นกำลังมา ก็รอต่อ ไม่งั้นกลับไปรอคลังหลักตอบ
  if (!inFlight) await conn.query('UPDATE requisitions SET dispute_state = "awaiting_response" WHERE id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'replacement_received',
    [`ของชดเชยรอบ #${replacement.id} — ยังขาดอยู่`, ...problems].join('\n'));
  return { message: 'บันทึกรับของชดเชยแล้ว ยังขาดอยู่บางส่วน — แจ้งคลังหลักแล้ว' };
});

// ─── ยกเลิกหลังอนุมัติ ────────────────────────────────────────
// PUT /api/requisitions/:id/cancel-approval — ผู้อนุมัติยกเลิกใบที่อนุมัติแล้วแต่ยังไม่ได้ส่ง { reason }
// (อนุมัติผิด / สาขาไม่ต้องการแล้ว) → กลับเป็น "ถูกปฏิเสธ" สาขาแก้แล้วส่งใหม่หรือยกเลิกได้, ของที่จองไว้ถูกปล่อยทันที
const cancelApproval = withTx(async (req, conn) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) throw new HttpError(400, 'กรุณาระบุเหตุผลที่ยกเลิก ให้สาขาทราบ');
  const requisition = await loadForUpdate(conn, req, ['approved'], 'ยกเลิกได้เฉพาะใบที่อนุมัติแล้วแต่ยังไม่ได้จัดส่ง');
  await conn.query('UPDATE requisition_items SET approved_qty = NULL WHERE requisition_id = ?', [requisition.id]);
  await conn.query(
    'UPDATE requisitions SET status = "rejected", reject_reason = ?, approved_by = NULL, approved_at = NULL WHERE id = ?',
    [`ยกเลิกหลังอนุมัติ: ${reason.trim()}`, requisition.id]
  );
  await conn.query('DELETE FROM shipments WHERE requisition_id = ?', [requisition.id]);
  await logEvent(conn, requisition.id, req.user.id, 'approval_cancelled', reason.trim());
  return { message: 'ยกเลิกการอนุมัติแล้ว ของที่จองไว้ถูกปล่อยคืน — สาขาแก้ไขส่งใหม่หรือยกเลิกได้' };
});

// ─── ของชำรุด: ตัดทิ้ง / ส่งคืนคลังหลัก ───────────────────────────
const defectRecords = async (db, requisitionId) => {
  const [rows] = await db.query(`
    SELECT d.*, p.name AS product_name, p.unit, cu.name AS created_by_name, du.name AS done_by_name
    FROM defect_records d
    JOIN products p ON p.id = d.product_id
    LEFT JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users du ON du.id = d.done_by
    WHERE d.requisition_id = ? ORDER BY d.id
  `, [requisitionId]);
  return rows.map((r) => ({ ...r, qty: Number(r.qty) }));
};
const undecidedDefects = async (db, requisitionId) => {
  const [[r]] = await db.query(`
    SELECT COALESCE(SUM(ri.defective_qty), 0) - COALESCE((SELECT SUM(qty) FROM defect_records WHERE requisition_id = ?), 0) AS n
    FROM requisition_items ri WHERE ri.requisition_id = ?
  `, [requisitionId, requisitionId]);
  return Math.max(0, Number(r.n));
};

// POST /api/requisitions/:id/defects — ผู้อนุมัติตัดสินใจว่าของชำรุดไปไหน
// { items: [{ requisition_item_id, qty, action: 'write_off' | 'return' }], note }
const decideDefects = withTx(async (req, conn) => {
  const { items, note } = req.body;
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'กรุณาเลือกรายการของชำรุดที่จะจัดการ');
  const requisition = await loadForUpdate(conn, req, ['disputed', 'completed'], 'ใบนี้ไม่มีของชำรุดให้จัดการ');
  const [dbItems] = await conn.query(`
    SELECT ri.id, ri.product_id, COALESCE(ri.defective_qty, 0) AS defective, p.name,
      COALESCE((SELECT SUM(qty) FROM defect_records d WHERE d.requisition_item_id = ri.id), 0) AS decided
    FROM requisition_items ri JOIN products p ON p.id = ri.product_id WHERE ri.requisition_id = ?
  `, [requisition.id]);
  const map = new Map(dbItems.map((i) => [i.id, { ...i, left: Number(i.defective) - Number(i.decided) }]));
  const lines = [];
  for (const it of items) {
    const row = map.get(Number(it.requisition_item_id));
    if (!row) throw new HttpError(400, 'ไม่พบรายการนี้ในใบขอเบิก');
    if (!['write_off', 'return'].includes(it.action)) throw new HttpError(400, 'เลือกได้แค่ "ตัดทิ้ง" หรือ "ส่งคืน"');
    if (!isPositiveInt(it.qty) || Number(it.qty) > row.left) {
      throw new HttpError(400, `${row.name}: จำนวนต้องเป็น 1 ถึง ${row.left} (ของชำรุดที่ยังไม่ได้จัดการ)`);
    }
    row.left -= Number(it.qty);
    await conn.query(
      `INSERT INTO defect_records (requisition_id, requisition_item_id, product_id, branch_id, qty, action, status, note, created_by, done_by, done_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [requisition.id, row.id, row.product_id, requisition.branch_id, Number(it.qty), it.action,
        it.action === 'write_off' ? 'done' : 'pending', note || null, req.user.id,
        it.action === 'write_off' ? req.user.id : null, it.action === 'write_off' ? new Date() : null]
    );
    lines.push(`${row.name} ${it.qty} — ${it.action === 'write_off' ? 'ตัดทิ้งที่สาขา' : 'ให้สาขาส่งคืนคลังหลัก'}`);
  }
  await logEvent(conn, requisition.id, req.user.id, 'defects_decided', [...lines, note ? `หมายเหตุ: ${note}` : null].filter(Boolean).join('\n'));
  return { status: 201, body: { message: 'บันทึกการจัดการของชำรุดแล้ว' } };
});

// PUT /api/requisitions/:id/defects/:defectId/received — คลังหลักยืนยันว่าได้รับของชำรุดคืนแล้ว
// (ผู้อนุมัติหรือพนักงานจัดส่งกดได้ — คนรับของที่คลังหลัก)
const defectReturned = withTx(async (req, conn) => {
  if (!isWarehouseAuthority(req) && !isShipper(req)) throw new HttpError(403, 'เฉพาะคลังหลักเท่านั้น');
  const requisition = await loadForUpdate(conn, req, null);
  const [[d]] = await conn.query('SELECT * FROM defect_records WHERE id = ? AND requisition_id = ? FOR UPDATE', [req.params.defectId, requisition.id]);
  if (!d) throw new HttpError(404, 'ไม่พบรายการของชำรุดนี้');
  if (d.action !== 'return' || d.status !== 'pending') throw new HttpError(400, 'รายการนี้ไม่ได้รอรับคืน (อาจยืนยันไปแล้ว)');
  await conn.query('UPDATE defect_records SET status = "done", done_by = ?, done_at = NOW() WHERE id = ?', [req.user.id, d.id]);
  await logEvent(conn, requisition.id, req.user.id, 'defect_returned', `ได้รับของชำรุดคืน ${d.qty} ชิ้น`);
  return { message: 'ยืนยันรับของชำรุดคืนแล้ว' };
});

module.exports = {
  cancelApproval, decideDefects, defectReturned,
  create, list, actionCount, warehouseStock, getOne, update, remove,
  approve, reject, ship, receive,
  respond, addMessage, proposeClose, acceptClose, declineClose,
  createReplacement, shipReplacement, receiveReplacement,
};
