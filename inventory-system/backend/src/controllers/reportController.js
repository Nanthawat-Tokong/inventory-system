// ============================================================
// reportController.js — รายงานสินค้าคงคลัง
//
// ทุกรายงานรับ query: from, to (YYYY-MM-DD, รวมวัน to) และ branch_id (ไม่บังคับ)
//   ฝั่งคลังหลัก (admin / main_manager คลังหลัก) เลือกดูสาขาไหนก็ได้ หรือทุกสาขา
//   สาขาอื่นเห็นแค่สาขาตัวเองเสมอ (ไม่สนใจ branch_id ที่ส่งมา)
//
//   GET /reports/summary       ภาพรวม: ตัวเลขสำคัญ + กราฟรับเข้า/ออกรายวัน + สถานะสต๊อก
//   GET /reports/movement      ความเคลื่อนไหวสต๊อกต่อสินค้า: ยกมา → รับเข้า → ออก → คงเหลือ
//   GET /reports/top           สินค้าออกมากที่สุด + สินค้าค้างสต๊อก (มีของแต่ไม่เคลื่อนไหว)
//   GET /reports/reorder       สินค้าที่ควรสั่ง/เบิกเพิ่ม พร้อมจำนวนวันที่สต๊อกพอใช้
//   GET /reports/requisitions  ประสิทธิภาพใบขอเบิก: ได้ของครบกี่ % / ชำรุด / ใช้เวลากี่วัน
//
// หมายเหตุ: "ออก" ที่คลังหลักรวมการจัดส่งไปสาขา (โอนย้าย) ด้วย ส่วนที่สาขาคือการใช้/ขายจริง
// ============================================================

const pool = require('../config/db');
const { isAdmin, ownBranch, isWarehouseAuthority, isShipper } = require('../utils/permissions');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// วันที่ตามเวลาเครื่อง (ไม่ใช่ UTC — ไม่งั้นช่วงเช้าก่อน 7 โมงในไทยจะได้วันที่ของเมื่อวาน)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// แปลงช่วงวันที่ → [start, endExclusive] (ค่าเริ่มต้น: 30 วันล่าสุด)
const parseRange = (q) => {
  const today = new Date();
  const to = DATE_RE.test(q.to || '') ? q.to : ymd(today);
  const from = DATE_RE.test(q.from || '') ? q.from : ymd(new Date(today.getTime() - 29 * 86400000));
  const endEx = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
  const days = Math.max(1, Math.round((new Date(`${endEx}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000));
  if (from > to) throw Object.assign(new Error('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด'), { status: 400 });
  return { from, to, start: `${from} 00:00:00`, endEx: `${endEx} 00:00:00`, days };
};

// สาขาที่ดูได้: null = ทุกสาขา
const scopeBranch = (req) => {
  // ฝั่งคลังหลัก (ผู้อนุมัติ + พนักงานจัดส่ง) เลือกดูสาขาไหนก็ได้
  if (isWarehouseAuthority(req) || isAdmin(req) || isShipper(req)) return req.query.branch_id ? Number(req.query.branch_id) : null;
  return ownBranch(req);
};
const branchSql = (col, branchId) => (branchId ? { sql: ` AND ${col} = ?`, params: [branchId] } : { sql: '', params: [] });

const handle = (fn) => async (req, res) => {
  try {
    const range = parseRange(req.query);
    const branchId = scopeBranch(req);
    res.json({ range: { from: range.from, to: range.to, days: range.days }, branch_id: branchId, ...(await fn(range, branchId, req)) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.status ? err.message : 'Server error', error: err.message });
  }
};

// จำนวนที่ส่งจริงต่อรายการ = ส่งรอบแรก + ของชดเชยที่ส่งออกไปแล้วทุกรอบ
const SHIPPED_TOTAL = `(COALESCE(ri.shipped_qty, 0) + COALESCE((
  SELECT SUM(rsi.replacement_qty) FROM replacement_shipment_items rsi
  JOIN replacement_shipments rs ON rs.id = rsi.replacement_shipment_id
  WHERE rsi.requisition_item_id = ri.id AND rs.status IN ('shipped','received')), 0))`;

// สต๊อกปัจจุบันต่อ สินค้า × สาขา (เฉพาะสินค้าที่เปิดใช้ในสาขานั้น, ไม่รวมที่ถูกลบ)
const currentStockRows = async (branchId) => {
  const b = branchSql('b.id', branchId);
  const [rows] = await pool.query(`
    SELECT p.id AS product_id, p.name, p.sku, p.category, p.unit, p.low_stock_threshold AS threshold,
      b.id AS branch_id, b.name AS branch_name, b.is_warehouse,
      COALESCE(cs.stock, 0) AS stock
    FROM products p
    JOIN branch_products bp ON bp.product_id = p.id AND bp.is_active = 1
    JOIN branches b ON b.id = bp.branch_id AND b.is_deleted = 0
    LEFT JOIN current_stock cs ON cs.product_id = p.id AND cs.branch_id = b.id
    WHERE p.is_deleted = 0 ${b.sql}
  `, b.params);
  return rows.map((r) => ({ ...r, stock: Number(r.stock) }));
};

// ─── summary ─────────────────────────────────────────────────
const summary = handle(async (r, branchId) => {
  const b = branchSql('t.branch_id', branchId);
  const [[mv]] = await pool.query(`
    SELECT COUNT(*) AS tx_count,
      COALESCE(SUM(CASE WHEN type='receive' THEN quantity END), 0) AS received,
      COALESCE(SUM(CASE WHEN type='issue' THEN quantity END), 0) AS issued,
      COUNT(DISTINCT product_id) AS products_moved
    FROM transactions t WHERE t.created_at >= ? AND t.created_at < ? ${b.sql}
  `, [r.start, r.endEx, ...b.params]);

  const [daily] = await pool.query(`
    SELECT DATE_FORMAT(t.created_at, '%Y-%m-%d') AS date,
      SUM(CASE WHEN type='receive' THEN quantity ELSE 0 END) AS received,
      SUM(CASE WHEN type='issue' THEN quantity ELSE 0 END) AS issued
    FROM transactions t WHERE t.created_at >= ? AND t.created_at < ? ${b.sql}
    GROUP BY DATE_FORMAT(t.created_at, '%Y-%m-%d') ORDER BY date
  `, [r.start, r.endEx, ...b.params]);

  const stock = await currentStockRows(branchId);
  const status = { total: stock.length, out: 0, low: 0, ok: 0, units: 0 };
  stock.forEach((s) => {
    status.units += Math.max(0, s.stock);
    if (s.stock <= 0) status.out++; else if (s.stock < s.threshold) status.low++; else status.ok++;
  });

  const rb = branchSql('r.branch_id', branchId);
  const [reqRows] = await pool.query(`
    SELECT status, COUNT(*) AS n FROM requisitions r
    WHERE r.created_at >= ? AND r.created_at < ? ${rb.sql} GROUP BY status
  `, [r.start, r.endEx, ...rb.params]);
  const requisitions = Object.fromEntries(reqRows.map((x) => [x.status, Number(x.n)]));

  return {
    totals: { ...mv, received: Number(mv.received), issued: Number(mv.issued) },
    daily: daily.map((d) => ({ date: d.date, received: Number(d.received), issued: Number(d.issued) })),
    stock_status: status,
    requisitions,
  };
});

// ─── movement ────────────────────────────────────────────────
// ยกมา = สต๊อก ณ ต้นงวด, คงเหลือ = ยกมา + รับเข้า − ออก (= สต๊อก ณ สิ้นงวด)
const movement = handle(async (r, branchId) => {
  const b = branchSql('t.branch_id', branchId);
  const [rows] = await pool.query(`
    SELECT p.id AS product_id, p.name, p.sku, p.category, p.unit, b.id AS branch_id, b.name AS branch_name,
      SUM(CASE WHEN t.created_at < ? THEN IF(t.type='receive', t.quantity, -t.quantity) ELSE 0 END) AS opening,
      SUM(CASE WHEN t.created_at >= ? AND t.type='receive' THEN t.quantity ELSE 0 END) AS received,
      SUM(CASE WHEN t.created_at >= ? AND t.type='issue' THEN t.quantity ELSE 0 END) AS issued,
      MAX(t.created_at) AS last_movement
    FROM transactions t
    JOIN products p ON p.id = t.product_id
    JOIN branches b ON b.id = t.branch_id
    WHERE t.created_at < ? ${b.sql}
    GROUP BY p.id, b.id
    ORDER BY p.name, b.name
  `, [r.start, r.start, r.start, r.endEx, ...b.params]);
  return {
    rows: rows
      .map((x) => {
        const opening = Number(x.opening), received = Number(x.received), issued = Number(x.issued);
        const closing = opening + received - issued;
        const avg = (opening + closing) / 2;
        return { ...x, opening, received, issued, closing, turnover: avg > 0 ? +(issued / avg).toFixed(2) : null };
      })
      .filter((x) => x.opening || x.received || x.issued || x.closing),
  };
});

// ─── top / dead stock ────────────────────────────────────────
const top = handle(async (r, branchId) => {
  const b = branchSql('t.branch_id', branchId);
  const [topIssued] = await pool.query(`
    SELECT p.id AS product_id, p.name, p.sku, p.category, p.unit,
      SUM(t.quantity) AS issued, COUNT(*) AS times
    FROM transactions t JOIN products p ON p.id = t.product_id
    WHERE t.type = 'issue' AND t.created_at >= ? AND t.created_at < ? ${b.sql}
    GROUP BY p.id ORDER BY issued DESC LIMIT 20
  `, [r.start, r.endEx, ...b.params]);

  // ค้างสต๊อก: มีของอยู่ แต่ไม่มีการออกเลยในช่วงที่เลือก
  const [lastIssue] = await pool.query(`
    SELECT product_id, branch_id, MAX(created_at) AS last_issue
    FROM transactions t WHERE t.type = 'issue' ${b.sql} GROUP BY product_id, branch_id
  `, b.params);
  const lastMap = new Map(lastIssue.map((x) => [`${x.product_id}-${x.branch_id}`, x.last_issue]));
  const now = Date.now();
  const dead = (await currentStockRows(branchId))
    .filter((s) => s.stock > 0)
    .map((s) => {
      const li = lastMap.get(`${s.product_id}-${s.branch_id}`) || null;
      return { ...s, last_issue: li, idle_days: li ? Math.floor((now - new Date(li).getTime()) / 86400000) : null };
    })
    .filter((s) => !s.last_issue || new Date(s.last_issue) < new Date(r.start.replace(' ', 'T')))
    .sort((a, b2) => b2.stock - a.stock);

  return {
    top_issued: topIssued.map((x) => ({ ...x, issued: Number(x.issued) })),
    dead_stock: dead,
  };
});

// ─── reorder ─────────────────────────────────────────────────
// ใช้เฉลี่ยต่อวัน = ออกในช่วงที่เลือก ÷ จำนวนวัน, พอใช้อีก = คงเหลือ ÷ ใช้เฉลี่ยต่อวัน
// แนะนำให้สั่ง = เติมให้ถึง 2 เท่าของเกณฑ์ขั้นต่ำ (หรือพอใช้ 30 วัน ถ้ามากกว่า) − คงเหลือ
const reorder = handle(async (r, branchId) => {
  const b = branchSql('t.branch_id', branchId);
  const [usage] = await pool.query(`
    SELECT product_id, branch_id, SUM(quantity) AS issued
    FROM transactions t WHERE t.type='issue' AND t.created_at >= ? AND t.created_at < ? ${b.sql}
    GROUP BY product_id, branch_id
  `, [r.start, r.endEx, ...b.params]);
  const useMap = new Map(usage.map((u) => [`${u.product_id}-${u.branch_id}`, Number(u.issued)]));

  // ความต้องการจากสาขาที่คลังหลักยังส่งให้ไม่ได้ (ขอ − ส่งจริง) ของใบที่ยังไม่ปิด/ปิดในช่วงนี้ → นับให้คลังหลัก
  const [demand] = await pool.query(`
    SELECT ri.product_id, SUM(GREATEST(0, COALESCE(ri.approved_qty, ri.requested_qty) - ${SHIPPED_TOTAL})) AS unmet
    FROM requisition_items ri JOIN requisitions r ON r.id = ri.requisition_id
    WHERE r.status IN ('pending','approved','shipped','disputed') OR (r.created_at >= ? AND r.created_at < ? AND r.status = 'completed')
    GROUP BY ri.product_id HAVING unmet > 0
  `, [r.start, r.endEx]);
  const unmetMap = new Map(demand.map((d) => [d.product_id, Number(d.unmet)]));

  const rows = (await currentStockRows(branchId))
    .map((s) => {
      const issued = useMap.get(`${s.product_id}-${s.branch_id}`) || 0;
      const perDay = issued / r.days;
      const unmet = s.is_warehouse ? unmetMap.get(s.product_id) || 0 : 0;
      const target = Math.max(s.threshold * 2, Math.ceil(perDay * 30), unmet + s.threshold);
      return {
        ...s,
        issued,
        unmet,
        per_day: +perDay.toFixed(2),
        days_cover: perDay > 0 ? Math.floor(Math.max(0, s.stock) / perDay) : null,
        suggest: Math.max(0, target - Math.max(0, s.stock)),
      };
    })
    .filter((s) => s.stock < s.threshold || (s.days_cover !== null && s.days_cover < 7) || s.unmet > s.stock)
    .sort((a, b2) => b2.unmet - a.unmet || (a.stock > 0) - (b2.stock > 0) || b2.per_day - a.per_day || (a.days_cover ?? 1e9) - (b2.days_cover ?? 1e9));

  return { rows };
});

// ─── requisitions ────────────────────────────────────────────
const requisitions = handle(async (r, branchId) => {
  const rb = branchSql('r.branch_id', branchId);
  const [byBranch] = await pool.query(`
    SELECT b.id AS branch_id, b.name AS branch_name,
      COUNT(DISTINCT r.id) AS total,
      COUNT(DISTINCT CASE WHEN r.status='completed' THEN r.id END) AS completed,
      COUNT(DISTINCT CASE WHEN r.status='disputed' THEN r.id END) AS disputed,
      COUNT(DISTINCT CASE WHEN r.status='rejected' THEN r.id END) AS rejected,
      COUNT(DISTINCT CASE WHEN r.status IN ('pending','approved','shipped') THEN r.id END) AS in_progress,
      COALESCE(SUM(ri.requested_qty), 0) AS requested,
      COALESCE(SUM(ri.approved_qty), 0) AS approved,
      COALESCE(SUM(${SHIPPED_TOTAL}), 0) AS shipped,
      COALESCE(SUM(ri.received_qty), 0) AS received,
      COALESCE(SUM(ri.defective_qty), 0) AS defective,
      -- อัตราได้ของครบ คิดเฉพาะใบที่ของถึงสาขาแล้ว (มีปัญหา/เสร็จ) ไม่นับใบที่ยังรออนุมัติ/รอส่ง
      COALESCE(SUM(CASE WHEN r.status IN ('disputed','completed') THEN ri.requested_qty END), 0) AS requested_done,
      COALESCE(SUM(CASE WHEN r.status IN ('disputed','completed') THEN ri.received_qty END), 0) AS received_done
    FROM requisitions r
    JOIN branches b ON b.id = r.branch_id
    JOIN requisition_items ri ON ri.requisition_id = r.id
    WHERE r.created_at >= ? AND r.created_at < ? ${rb.sql}
    GROUP BY b.id ORDER BY b.name
  `, [r.start, r.endEx, ...rb.params]);

  // เวลาเฉลี่ย: สร้าง → อนุมัติ (ชั่วโมง), สร้าง → เสร็จ (วัน)
  const [[timing]] = await pool.query(`
    SELECT AVG(TIMESTAMPDIFF(MINUTE, r.created_at, r.approved_at)) / 60 AS approve_hours,
      AVG(CASE WHEN r.status='completed' THEN TIMESTAMPDIFF(MINUTE, r.created_at, r.updated_at) END) / 1440 AS complete_days
    FROM requisitions r WHERE r.created_at >= ? AND r.created_at < ? ${rb.sql}
  `, [r.start, r.endEx, ...rb.params]);

  // สินค้าที่ชำรุดบ่อย และสินค้าที่สาขาขอแต่คลังหลักไม่มีให้
  const [defects] = await pool.query(`
    SELECT p.name, p.sku, p.unit, SUM(ri.defective_qty) AS defective, SUM(${SHIPPED_TOTAL}) AS shipped
    FROM requisition_items ri JOIN requisitions r ON r.id = ri.requisition_id JOIN products p ON p.id = ri.product_id
    WHERE ri.defective_qty > 0 AND r.created_at >= ? AND r.created_at < ? ${rb.sql}
    GROUP BY p.id ORDER BY defective DESC LIMIT 10
  `, [r.start, r.endEx, ...rb.params]);
  const [shortfall] = await pool.query(`
    SELECT p.name, p.sku, p.unit,
      SUM(ri.requested_qty) AS requested, SUM(${SHIPPED_TOTAL}) AS shipped,
      SUM(ri.requested_qty) - SUM(${SHIPPED_TOTAL}) AS short
    FROM requisition_items ri JOIN requisitions r ON r.id = ri.requisition_id JOIN products p ON p.id = ri.product_id
    WHERE r.status IN ('shipped','disputed','completed') AND r.created_at >= ? AND r.created_at < ? ${rb.sql}
    GROUP BY p.id HAVING short > 0 ORDER BY short DESC LIMIT 10
  `, [r.start, r.endEx, ...rb.params]);

  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]));
  return {
    by_branch: byBranch.map(num),
    timing: {
      approve_hours: timing.approve_hours == null ? null : +Number(timing.approve_hours).toFixed(1),
      complete_days: timing.complete_days == null ? null : +Number(timing.complete_days).toFixed(1),
    },
    defects: defects.map(num),
    shortfall: shortfall.map(num),
  };
});

// ─── byUser: การเบิกรายคน ─────────────────────────────────────
// แต่ละคนขอเบิกอะไรไปเท่าไร และอยู่ขั้นไหน (รออนุมัติ / รอจัดส่ง / รอตรวจรับ / มีปัญหา / ได้รับแล้ว)
// สิทธิ์: พนักงานสาขาเห็นเฉพาะของตัวเอง, ผู้จัดการสาขาเห็นทั้งสาขา, ฝั่งคลังหลักเห็นทุกสาขา (เลือกสาขาได้)
// query เพิ่ม: user_id (เลือกดูคนเดียว)
const STAGE = {
  pending: 'รออนุมัติ', approved: 'รอจัดส่ง', shipped: 'รอตรวจรับ',
  disputed: 'มีปัญหา', completed: 'ได้รับแล้ว', rejected: 'ถูกปฏิเสธ',
};
const byUser = handle(async (r, branchId, req) => {
  const where = ['r.created_at >= ?', 'r.created_at < ?'];
  const params = [r.start, r.endEx];
  if (branchId) { where.push('r.branch_id = ?'); params.push(branchId); }
  if (req.user.role === 'staff') { where.push('r.created_by = ?'); params.push(req.user.id); }
  else if (req.query.user_id) { where.push('r.created_by = ?'); params.push(Number(req.query.user_id)); }

  const [items] = await pool.query(`
    SELECT r.id AS requisition_id, r.status, r.dispute_state, r.created_at,
      u.id AS user_id, u.name AS user_name, b.name AS branch_name,
      p.name AS product_name, p.sku, p.unit,
      ri.requested_qty, ri.approved_qty, ${SHIPPED_TOTAL} AS shipped_qty,
      COALESCE(ri.received_qty, 0) AS received_qty, COALESCE(ri.defective_qty, 0) AS defective_qty
    FROM requisitions r
    JOIN users u ON u.id = r.created_by
    JOIN branches b ON b.id = r.branch_id
    JOIN requisition_items ri ON ri.requisition_id = r.id
    JOIN products p ON p.id = ri.product_id
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC, r.id DESC, ri.id
  `, params);

  // ยอด "รอ" = ส่วนที่ยังไม่ถึงมือสาขา: ใบที่ยังไม่จบ → ที่อนุมัติ (หรือที่ขอ ถ้ายังไม่อนุมัติ) − ที่ได้รับแล้ว
  const rows = items.map((x) => {
    const requested = Number(x.requested_qty), approved = x.approved_qty == null ? null : Number(x.approved_qty);
    const received = Number(x.received_qty);
    const open = ['pending', 'approved', 'shipped', 'disputed'].includes(x.status);
    const waiting = open ? Math.max(0, (approved ?? requested) - received) : 0;
    return { ...x, requested_qty: requested, approved_qty: approved, shipped_qty: Number(x.shipped_qty), received_qty: received,
      defective_qty: Number(x.defective_qty), waiting_qty: waiting,
      // รายการที่คลังหลักอนุมัติ 0 (ไม่มีของ/ไม่ให้) — ไม่ใช่ "ได้รับแล้ว" แม้ทั้งใบจะเสร็จ
      ...(approved === 0 ? { status: 'rejected', stage: 'ไม่ได้รับอนุมัติ' } : { stage: STAGE[x.status] || x.status }) };
  });

  const people = new Map();
  for (const x of rows) {
    const p = people.get(x.user_id) || { user_id: x.user_id, user_name: x.user_name, branch_name: x.branch_name,
      requisitions: new Set(), waiting_requisitions: new Set(), requested: 0, approved: 0, received: 0, defective: 0, waiting: 0 };
    p.requisitions.add(x.requisition_id);
    if (x.waiting_qty > 0) p.waiting_requisitions.add(x.requisition_id);
    p.requested += x.requested_qty; p.approved += x.approved_qty || 0; p.received += x.received_qty;
    p.defective += x.defective_qty; p.waiting += x.waiting_qty;
    people.set(x.user_id, p);
  }
  return {
    people: [...people.values()]
      .map((p) => ({ ...p, requisitions: p.requisitions.size, waiting_requisitions: p.waiting_requisitions.size }))
      .sort((a, b) => b.requested - a.requested),
    rows,
  };
});

module.exports = { summary, movement, top, reorder, requisitions, byUser };
