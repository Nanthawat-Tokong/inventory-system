// ทดสอบ: รายงาน — ตัวเลขต้องตรงกับสต๊อกจริง และเห็นเฉพาะข้อมูลที่มีสิทธิ์
// ใช้ Jest (describe / it / beforeAll / afterAll เป็นตัวแปรส่วนกลางของ Jest)
const assert = require('node:assert/strict');
const h = require('./helpers');
const { api, B, P } = h;

let t;
const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const range = `from=${ymd(new Date(today.getTime() - 6 * 86400000))}&to=${ymd(today)}`;

beforeAll(async () => {
  t = await h.bootstrap();
  await h.receiveStock(t, P.WATER, 40);
  await h.receiveStock(t, P.SNACK, 4); // ต่ำกว่าเกณฑ์ 10
  await api(t.manager, 'POST', '/inventory/issue', { product_id: P.WATER, branch_id: B.HQ, quantity: 5 });
  // ใบขอเบิกที่ได้ของไม่ครบ 1 ใบ (ชำรุด 1)
  const id = await h.createRequisition(t.cnxStaff, [{ product_id: P.WATER, requested_qty: 10 }]);
  await h.approveAll(t, id);
  await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {});
  const d = await h.getRequisition(t.cnxStaff, id);
  await api(t.cnxStaff, 'PUT', `/requisitions/${id}/receive`, { items: [{ item_id: d.items[0].id, received_qty: 9, defective_qty: 1 }] });
});
afterAll(() => h.stopServer());

describe('ภาพรวม', () => {
  it('ยอดรับเข้า/ออกตรงกับรายการจริง', async () => {
    const r = await api(t.admin, 'GET', `/reports/summary?${range}`);
    assert.equal(r.status, 200);
    // รับเข้า: 40 + 4 (คลัง) + 9 (สาขารับ) = 53, ออก: 5 + 10 (ส่งไปสาขา) = 15
    assert.equal(r.body.totals.received, 53);
    assert.equal(r.body.totals.issued, 15);
    assert.equal(r.body.daily.reduce((a, d) => a + d.received, 0), 53);
  });
  it('สถานะสต๊อกรวม = จำนวนชิ้นจริงทั้งหมด', async () => {
    const r = await api(t.admin, 'GET', `/reports/summary?${range}`);
    const [{ total }] = await h.db('SELECT SUM(IF(type="receive", quantity, -quantity)) AS total FROM transactions');
    assert.equal(r.body.stock_status.units, Number(total));
  });
  it('วันที่เริ่มหลังวันที่สิ้นสุด → 400', async () => {
    assert.equal((await api(t.admin, 'GET', '/reports/summary?from=2026-12-31&to=2026-01-01')).status, 400);
  });
});

describe('รายวัน / รายสัปดาห์ / รายเดือน', () => {
  it('ทุกแบบรวมแล้วได้ยอดเท่ากับภาพรวม (รับ 53, ออก 15)', async () => {
    for (const g of ['day', 'week', 'month']) {
      const r = (await api(t.admin, 'GET', `/reports/periodic?${range}&group=${g}`)).body;
      assert.equal(r.group, g);
      assert.equal(r.periods.reduce((a, x) => a + x.received, 0), 53, g);
      assert.equal(r.periods.reduce((a, x) => a + x.issued, 0), 15, g);
      assert.equal(r.detail.reduce((a, x) => a + x.received, 0), 53, `${g} detail`);
    }
  });
  it('รายสัปดาห์: ช่วงเริ่มเป็นวันจันทร์เสมอ / รายเดือน: วันที่ 1', async () => {
    const w = (await api(t.admin, 'GET', `/reports/periodic?${range}&group=week`)).body.periods;
    assert.ok(w.every((x) => new Date(`${x.period}T00:00:00`).getDay() === 1));
    const m = (await api(t.admin, 'GET', `/reports/periodic?${range}&group=month`)).body.periods;
    assert.ok(m.every((x) => x.period.endsWith('-01')));
  });
  it('/reports/daily, /weekly, /monthly (ตามเอกสาร API) ใช้ได้ และมีข้อมูลของวันนี้', async () => {
    for (const p of ['daily', 'weekly', 'monthly']) {
      const r = await api(t.cnxStaff, 'GET', `/reports/${p}`);
      assert.equal(r.status, 200, p);
      assert.equal(r.body.branch_id, B.CNX, 'สาขาเห็นแค่ของตัวเอง');
      assert.ok(r.body.periods.length >= 1, p);
    }
  });
});

describe('ความเคลื่อนไหว', () => {
  it('คงเหลือ = ยกมา + รับ − ออก และตรงกับสต๊อกจริงทุกแถว', async () => {
    const rows = (await api(t.admin, 'GET', `/reports/movement?${range}`)).body.rows;
    assert.ok(rows.length > 0);
    for (const r of rows) {
      assert.equal(r.closing, r.opening + r.received - r.issued);
      assert.equal(r.closing, await h.stockOf(r.product_id, r.branch_id), `${r.name} @ ${r.branch_name}`);
    }
  });
  it('ช่วงวันในอนาคต: ยกมา = สต๊อกปัจจุบัน, ไม่มีรับ/ออก', async () => {
    const next = new Date(today.getTime() + 2 * 86400000);
    const rows = (await api(t.admin, 'GET', `/reports/movement?from=${ymd(next)}&to=${ymd(next)}`)).body.rows;
    const w = rows.find((r) => r.product_id === P.WATER && r.branch_id === B.HQ);
    assert.equal(w.received + w.issued, 0);
    assert.equal(w.opening, await h.stockOf(P.WATER, B.HQ));
  });
});

describe('สิทธิ์การดูรายงาน', () => {
  it('สาขาเห็นแค่สาขาตัวเอง แม้ส่ง branch_id อื่นมา', async () => {
    const r = await api(t.cnxStaff, 'GET', `/reports/movement?${range}&branch_id=${B.HQ}`);
    assert.equal(r.body.branch_id, B.CNX);
    assert.ok(r.body.rows.every((x) => x.branch_id === B.CNX));
  });
  it('ผู้อนุมัติคลังหลักเลือกดูสาขาไหนก็ได้', async () => {
    const r = await api(t.manager, 'GET', `/reports/movement?${range}&branch_id=${B.CNX}`);
    assert.ok(r.body.rows.length > 0 && r.body.rows.every((x) => x.branch_id === B.CNX));
  });
  it('ทุกรายงานเปิดได้ทุกบทบาท', async () => {
    for (const rep of ['summary', 'movement', 'top', 'reorder', 'requisitions']) {
      for (const who of ['admin', 'manager', 'shipper', 'cnxStaff']) {
        assert.equal((await api(t[who], 'GET', `/reports/${rep}?${range}`)).status, 200, `${rep} / ${who}`);
      }
    }
  });
});

describe('การเบิกรายคน', () => {
  let waitingId;
  beforeAll(async () => {
    // ใบที่ 2 ของพนักงานเชียงใหม่: อนุมัติแล้วแต่ยังไม่ส่ง → "รอ" 3 ชิ้น
    waitingId = await h.createRequisition(t.cnxStaff, [{ product_id: P.WATER, requested_qty: 3 }]);
    await h.approveAll(t, waitingId);
    // ใบของผู้จัดการเชียงใหม่ (คนละคน สาขาเดียวกัน) ยังไม่อนุมัติ → "รอ" 2 ชิ้น
    await h.createRequisition(t.cnxMgr, [{ product_id: P.WATER, requested_qty: 2 }]);
  });
  it('พนักงานเห็นเฉพาะที่ตัวเองเบิก พร้อมยอด "รอ" ที่ยังไม่ได้รับ', async () => {
    const r = (await api(t.cnxStaff, 'GET', `/reports/by-user?${range}`)).body;
    assert.equal(r.people.length, 1);
    const me = r.people[0];
    assert.equal(me.requested, 13);   // 10 + 3
    assert.equal(me.received, 9);     // ใบแรกได้สภาพดี 9
    // รอ = 3 (ใบใหม่ยังไม่ส่ง) + 1 (ใบแรกชำรุด 1 ชิ้น เคสยังเปิด ยังไม่ได้ของแทน)
    assert.equal(me.waiting, 4);
    const row = r.rows.find((x) => x.requisition_id === waitingId);
    assert.equal(row.stage, 'รอจัดส่ง');
    assert.equal(row.waiting_qty, 3);
  });
  it('ผู้จัดการสาขาย่อยเห็นทุกคนในสาขาตัวเอง แยกรายคน', async () => {
    const r = (await api(t.cnxMgr, 'GET', `/reports/by-user?${range}`)).body;
    assert.equal(r.people.length, 2);
    assert.equal(r.people.find((p) => p.user_name === 'cnxMgr').waiting, 2);
  });
  it('ฝั่งคลังหลัก (ผู้อนุมัติ + พนักงานจัดส่ง) เห็นทุกสาขา และกรองรายคนได้', async () => {
    for (const who of ['manager', 'shipper']) {
      const all = (await api(t[who], 'GET', `/reports/by-user?${range}`)).body;
      assert.equal(all.people.length, 2, who);
    }
    const staffId = (await api(t.cnxStaff, 'GET', '/auth/me')).body.id;
    const one = (await api(t.manager, 'GET', `/reports/by-user?${range}&user_id=${staffId}`)).body;
    assert.ok(one.rows.every((x) => x.user_id === staffId));
  });
});

describe('ควรสั่งเพิ่ม / ใบขอเบิก', () => {
  it('ขนม (4 < เกณฑ์ 10) อยู่ในรายการควรสั่ง และแนะนำให้เติมถึง 2 เท่าของเกณฑ์', async () => {
    const rows = (await api(t.manager, 'GET', `/reports/reorder?${range}&branch_id=${B.HQ}`)).body.rows;
    const s = rows.find((r) => r.product_id === P.SNACK);
    assert.ok(s);
    assert.equal(s.suggest, 16);
  });
  it('รายงานใบขอเบิก: ส่ง 10 = สภาพดี 9 + ชำรุด 1', async () => {
    const b = (await api(t.admin, 'GET', `/reports/requisitions?${range}`)).body.by_branch.find((x) => x.branch_id === B.CNX);
    assert.equal(b.shipped, 10);
    assert.equal(b.received, 9);
    assert.equal(b.defective, 1);
  });
});
