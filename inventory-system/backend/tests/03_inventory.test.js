// ทดสอบ: รับเข้า / ออกสินค้า / ดูสต๊อก / ประวัติ
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { api, B, P } = h;

let t;
before(async () => { t = await h.bootstrap(); });
after(() => h.stopServer());

describe('รับสินค้าเข้า', () => {
  it('รับเข้าคลังหลักได้ และ stock_after ถูกต้อง', async () => {
    const r = await api(t.manager, 'POST', '/inventory/receive', { product_id: P.WATER, branch_id: B.HQ, quantity: 100 });
    assert.equal(r.status, 201);
    assert.equal(r.body.stock_after, 100);
    assert.equal(await h.stockOf(P.WATER, B.HQ), 100);
  });
  it('รับเข้าตรงที่สาขาย่อยไม่ได้ (ต้องผ่านใบขอเบิก) — แม้เป็น admin', async () => {
    const r = await api(t.admin, 'POST', '/inventory/receive', { product_id: P.WATER, branch_id: B.CNX, quantity: 5 });
    assert.equal(r.status, 400);
  });
  it('ผู้จัดการสาขาย่อยรับเข้าสาขาตัวเองไม่ได้', async () => {
    const r = await api(t.cnxMgr, 'POST', '/inventory/receive', { product_id: P.WATER, branch_id: B.CNX, quantity: 5 });
    assert.equal(r.status, 400);
  });
  it('พนักงาน / พนักงานจัดส่ง รับเข้าไม่ได้', async () => {
    assert.equal((await api(t.hqStaff, 'POST', '/inventory/receive', { product_id: P.WATER, quantity: 5 })).status, 403);
    assert.equal((await api(t.shipper, 'POST', '/inventory/receive', { product_id: P.WATER, quantity: 5 })).status, 403);
  });
  for (const [label, quantity] of [['ติดลบ', -5], ['ศูนย์', 0], ['ทศนิยม', 1.5], ['ข้อความ', 'abc'], ['ว่าง', '']]) {
    it(`จำนวน${label} → 400`, async () => {
      const r = await api(t.manager, 'POST', '/inventory/receive', { product_id: P.WATER, branch_id: B.HQ, quantity });
      assert.equal(r.status, 400);
    });
  }
  it('สินค้าไม่มีจริง / ถูกลบแล้ว → 400', async () => {
    assert.equal((await api(t.manager, 'POST', '/inventory/receive', { product_id: 99999, branch_id: B.HQ, quantity: 1 })).status, 400);
  });
});

describe('ออกสินค้า', () => {
  it('ออกได้ไม่เกินสต๊อก', async () => {
    assert.equal((await api(t.manager, 'POST', '/inventory/issue', { product_id: P.WATER, branch_id: B.HQ, quantity: 30 })).status, 201);
    assert.equal(await h.stockOf(P.WATER, B.HQ), 70);
    const r = await api(t.manager, 'POST', '/inventory/issue', { product_id: P.WATER, branch_id: B.HQ, quantity: 71 });
    assert.equal(r.status, 400);
    assert.equal(await h.stockOf(P.WATER, B.HQ), 70);
  });
  it('ออกจำนวนติดลบไม่ได้ (กันแอบเพิ่มสต๊อก)', async () => {
    const r = await api(t.cnxStaff, 'POST', '/inventory/issue', { product_id: P.WATER, quantity: -50 });
    assert.equal(r.status, 400);
    assert.equal(await h.stockOf(P.WATER, B.CNX), 0);
  });
  it('พนักงานออกได้เฉพาะสาขาตัวเอง (ส่ง branch_id อื่นมาก็ถูกบังคับเป็นสาขาตัวเอง)', async () => {
    const r = await api(t.cnxStaff, 'POST', '/inventory/issue', { product_id: P.WATER, branch_id: B.HQ, quantity: 1 });
    assert.equal(r.status, 400); // สาขาเชียงใหม่ไม่มีของ
    assert.equal(await h.stockOf(P.WATER, B.HQ), 70);
  });
  it('ออกพร้อมกัน 2 คำสั่งเกินสต๊อก → สำเร็จแค่ 1 สต๊อกไม่ติดลบ', async () => {
    const results = await Promise.all([1, 2].map(() =>
      api(t.manager, 'POST', '/inventory/issue', { product_id: P.WATER, branch_id: B.HQ, quantity: 50 })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 400]);
    assert.equal(await h.stockOf(P.WATER, B.HQ), 20);
  });
  it('รับเข้าพร้อมกัน 5 คำสั่ง → stock_after ไม่ซ้ำกันและยอดรวมถูก', async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() =>
      api(t.manager, 'POST', '/inventory/receive', { product_id: P.PEN, branch_id: B.HQ, quantity: 10 })));
    assert.ok(rs.every((r) => r.status === 201));
    assert.deepEqual(rs.map((r) => r.body.stock_after).sort((a, b) => a - b), [10, 20, 30, 40, 50]);
  });
});

describe('ดูสต๊อก / ประวัติ', () => {
  it('admin เห็นทุกสาขา, พนักงานเห็นเฉพาะสาขาตัวเอง', async () => {
    const all = (await api(t.admin, 'GET', '/inventory/stock')).body;
    assert.ok(new Set(all.map((r) => r.branch_id)).size >= 3);
    const own = (await api(t.cnxStaff, 'GET', '/inventory/stock')).body;
    assert.ok(own.every((r) => r.branch_id === B.CNX));
  });
  it('สินค้าที่ยังไม่เคยมีของ แสดงสต๊อก 0 (ไม่หายไปจากรายการ)', async () => {
    const own = (await api(t.cnxStaff, 'GET', '/inventory/stock')).body;
    assert.equal(Number(own.find((r) => r.product_id === P.PAPER).stock), 0);
  });
  it('ดูสต๊อกสาขาอื่นไม่ได้', async () => {
    assert.equal((await api(t.cnxStaff, 'GET', `/inventory/stock/${B.HQ}`)).status, 403);
    assert.equal((await api(t.shipper, 'GET', `/inventory/stock/${B.HQ}`)).status, 200);
  });
  it('ประวัติ: พนักงานเห็นเฉพาะสาขาตัวเอง, limit ใช้ได้', async () => {
    const mine = (await api(t.cnxStaff, 'GET', '/inventory/history')).body;
    assert.ok(mine.every((r) => r.branch_id === B.CNX));
    const two = (await api(t.admin, 'GET', '/inventory/history?limit=2')).body;
    assert.equal(two.length, 2);
  });
  it('limit/offset แปลกๆ ไม่ทำให้ server พัง', async () => {
    assert.equal((await api(t.admin, 'GET', '/inventory/history?limit=abc&offset=-1')).status, 200);
  });
});
