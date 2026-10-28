// ทดสอบ: ใบขอเบิก — สร้าง / อนุมัติ / จัดส่ง / ตรวจรับ / สิทธิ์แต่ละบทบาท
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { api, B, P } = h;

let t;
before(async () => {
  t = await h.bootstrap();
  await h.receiveStock(t, P.WATER, 100);
  await h.receiveStock(t, P.PEN, 20);
  // PAPER: คลังหลักไม่มีของ
});
after(() => h.stopServer());

describe('สร้างใบขอเบิก — ต้องมีของในคลังหลัก', () => {
  it('สาขาเห็นสต๊อก "เบิกได้" ของคลังหลัก (เฉพาะที่มีของ)', async () => {
    const r = await api(t.cnxStaff, 'GET', '/requisitions/meta/warehouse-stock');
    assert.equal(r.body.warehouse.id, B.HQ);
    assert.equal(r.body.stock[P.WATER], 100);
    assert.equal(r.body.stock[P.PAPER], undefined);
  });
  it('ขอสินค้าที่คลังหลักไม่มี → 400', async () => {
    const r = await api(t.cnxStaff, 'POST', '/requisitions', { items: [{ product_id: P.PAPER, requested_qty: 1 }] });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /ไม่มีของ/);
  });
  it('ขอเกินที่มี → 400', async () => {
    const r = await api(t.cnxStaff, 'POST', '/requisitions', { items: [{ product_id: P.WATER, requested_qty: 101 }] });
    assert.equal(r.status, 400);
  });
  it('ไม่มีรายการ / จำนวนผิด / สินค้าซ้ำ → 400', async () => {
    assert.equal((await api(t.cnxStaff, 'POST', '/requisitions', { items: [] })).status, 400);
    assert.equal((await api(t.cnxStaff, 'POST', '/requisitions', { items: [{ product_id: P.WATER, requested_qty: 0 }] })).status, 400);
    assert.equal((await api(t.cnxStaff, 'POST', '/requisitions', { items: [{ product_id: P.WATER, requested_qty: 2.5 }] })).status, 400);
    assert.equal((await api(t.cnxStaff, 'POST', '/requisitions', { items: [
      { product_id: P.WATER, requested_qty: 1 }, { product_id: P.WATER, requested_qty: 2 }] })).status, 400);
  });
  it('สินค้าที่ปิดใช้ในสาขา ขอไม่ได้', async () => {
    await h.receiveStock(t, P.SOAP, 5);
    const r = await api(t.pktStaff, 'POST', '/requisitions', { items: [{ product_id: P.SOAP, requested_qty: 1 }] });
    assert.equal(r.status, 400);
  });
  it('คลังหลักสร้างใบขอเบิกให้ตัวเองไม่ได้ / admin, พนักงานจัดส่ง สร้างไม่ได้', async () => {
    assert.equal((await api(t.hqStaff, 'POST', '/requisitions', { items: [{ product_id: P.WATER, requested_qty: 1 }] })).status, 400);
    assert.equal((await api(t.admin, 'POST', '/requisitions', { items: [{ product_id: P.WATER, requested_qty: 1 }] })).status, 403);
    assert.equal((await api(t.shipper, 'POST', '/requisitions', { items: [{ product_id: P.WATER, requested_qty: 1 }] })).status, 403);
  });
  it('ผู้จัดการสาขาย่อยสร้างใบให้สาขาตัวเองได้', async () => {
    const id = await h.createRequisition(t.cnxMgr, [{ product_id: P.WATER, requested_qty: 1 }]);
    assert.equal((await api(t.cnxMgr, 'DELETE', `/requisitions/${id}`)).status, 200);
  });
});

describe('สิทธิ์การดูใบขอเบิก', () => {
  let id;
  before(async () => { id = await h.createRequisition(t.cnxStaff, [{ product_id: P.WATER, requested_qty: 2 }]); });
  after(async () => { await api(t.cnxStaff, 'DELETE', `/requisitions/${id}`); });

  it('สาขาอื่นดู/แก้/ยกเลิกใบของสาขานี้ไม่ได้', async () => {
    assert.equal((await api(t.pktStaff, 'GET', `/requisitions/${id}`)).status, 403);
    assert.equal((await api(t.pktStaff, 'DELETE', `/requisitions/${id}`)).status, 403);
    assert.ok(!(await api(t.pktStaff, 'GET', '/requisitions')).body.some((r) => r.id === id));
  });
  it('คลังหลัก (ผู้อนุมัติ + พนักงานจัดส่ง) เห็นทุกใบ', async () => {
    assert.equal((await api(t.manager, 'GET', `/requisitions/${id}`)).status, 200);
    assert.equal((await api(t.shipper, 'GET', `/requisitions/${id}`)).status, 200);
  });
  it('ใบที่ไม่มีอยู่ → 404', async () => {
    assert.equal((await api(t.manager, 'GET', '/requisitions/999999')).status, 404);
  });
});

describe('อนุมัติ — ต้องมีของ และจองของไว้', () => {
  it('อนุมัติเกิน "เบิกได้" ไม่ได้ / อนุมัติ 0 ทุกรายการไม่ได้', async () => {
    const id = await h.createRequisition(t.cnxStaff, [{ product_id: P.PEN, requested_qty: 20 }]);
    const d = await h.getRequisition(t.manager, id);
    assert.equal(d.items[0].warehouse_available, 20);
    await api(t.manager, 'POST', '/inventory/issue', { product_id: P.PEN, branch_id: B.HQ, quantity: 5 }); // ของลดลงหลังสาขาขอ
    const over = await api(t.manager, 'PUT', `/requisitions/${id}/approve`, { items: [{ item_id: d.items[0].id, approved_qty: 20 }] });
    assert.equal(over.status, 400);
    const zero = await api(t.manager, 'PUT', `/requisitions/${id}/approve`, { items: [{ item_id: d.items[0].id, approved_qty: 0 }] });
    assert.equal(zero.status, 400);
    assert.equal((await h.getRequisition(t.manager, id)).status, 'pending');
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/reject`, { reason: 'ของไม่พอ' })).status, 200);
  });
  it('อนุมัติแล้ว ของถูกจอง → ใบอื่นขอ/อนุมัติเกินส่วนที่เหลือไม่ได้', async () => {
    const id1 = await h.createRequisition(t.cnxStaff, [{ product_id: P.PEN, requested_qty: 10 }]);
    await h.approveAll(t, id1);
    const left = (await api(t.pktStaff, 'GET', '/requisitions/meta/warehouse-stock')).body.stock[P.PEN];
    assert.equal(left, 5); // 15 คงเหลือ − 10 ที่จองไว้
    assert.equal((await api(t.pktStaff, 'POST', '/requisitions', { items: [{ product_id: P.PEN, requested_qty: 6 }] })).status, 400);
    // ปิดท้าย: ส่งของใบนี้ให้จบ จะได้ไม่ค้างจอง
    await api(t.shipper, 'PUT', `/requisitions/${id1}/ship`, {});
    const d = await h.getRequisition(t.cnxStaff, id1);
    await api(t.cnxStaff, 'PUT', `/requisitions/${id1}/receive`, { items: d.items.map((i) => ({ item_id: i.id, received_qty: i.shipped_qty, defective_qty: 0 })) });
  });
  it('ปฏิเสธต้องมีเหตุผล / สาขาแก้แล้วส่งใหม่ได้', async () => {
    const id = await h.createRequisition(t.cnxStaff, [{ product_id: P.WATER, requested_qty: 3 }]);
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/reject`, { reason: '  ' })).status, 400);
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/reject`, { reason: 'ขอใหม่ให้ถูกรุ่น' })).status, 200);
    assert.equal((await api(t.pktStaff, 'PUT', `/requisitions/${id}`, { items: [{ product_id: P.WATER, requested_qty: 2 }] })).status, 403);
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}`, { note: 'แก้แล้ว', items: [{ product_id: P.WATER, requested_qty: 2 }] })).status, 200);
    const d = await h.getRequisition(t.cnxStaff, id);
    assert.equal(d.status, 'pending');
    assert.equal(d.reject_reason, null);
    assert.ok(d.events.some((e) => e.type === 'rejected') && d.events.some((e) => e.type === 'resubmitted'));
    await api(t.cnxStaff, 'DELETE', `/requisitions/${id}`);
  });
  it('ยกเลิกได้เฉพาะตอนยังไม่อนุมัติ', async () => {
    const id = await h.createRequisition(t.cnxStaff, [{ product_id: P.WATER, requested_qty: 1 }]);
    await h.approveAll(t, id);
    assert.equal((await api(t.cnxStaff, 'DELETE', `/requisitions/${id}`)).status, 400);
    await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {});
    const d = await h.getRequisition(t.cnxStaff, id);
    await api(t.cnxStaff, 'PUT', `/requisitions/${id}/receive`, { items: d.items.map((i) => ({ item_id: i.id, received_qty: 1, defective_qty: 0 })) });
  });
});

describe('แยกหน้าที่: ผู้อนุมัติ ≠ พนักงานจัดส่ง', () => {
  let id;
  before(async () => {
    id = await h.createRequisition(t.cnxStaff, [{ product_id: P.WATER, requested_qty: 10 }]);
  });
  it('พนักงานจัดส่ง / สาขา / ผู้จัดการสาขาย่อย อนุมัติไม่ได้', async () => {
    const d = await h.getRequisition(t.manager, id);
    const body = { items: [{ item_id: d.items[0].id, approved_qty: 1 }] };
    assert.equal((await api(t.shipper, 'PUT', `/requisitions/${id}/approve`, body)).status, 403);
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}/approve`, body)).status, 403);
    assert.equal((await api(t.cnxMgr, 'PUT', `/requisitions/${id}/approve`, body)).status, 403);
  });
  it('ยังไม่อนุมัติ → จัดส่งไม่ได้', async () => {
    assert.equal((await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {})).status, 400);
  });
  it('อนุมัติแล้ว: งานขึ้นที่พนักงานจัดส่ง ไม่ใช่ผู้อนุมัติ', async () => {
    await h.approveAll(t, id);
    const sh = (await api(t.shipper, 'GET', '/requisitions')).body.find((r) => r.id === id);
    const mg = (await api(t.manager, 'GET', '/requisitions')).body.find((r) => r.id === id);
    assert.equal(sh.needs_action, true);
    assert.equal(mg.needs_action, false);
    assert.ok((await api(t.shipper, 'GET', '/requisitions/meta/action-count')).body.count >= 1);
  });
  it('ผู้จัดการ / admin จัดส่งเองไม่ได้', async () => {
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/ship`, {})).status, 403);
    assert.equal((await api(t.admin, 'PUT', `/requisitions/${id}/ship`, {})).status, 403);
  });
  it('พนักงานจัดส่งกดส่งซ้ำพร้อมกัน → ตัดสต๊อกครั้งเดียว', async () => {
    const before = await h.stockOf(P.WATER, B.HQ);
    const rs = await Promise.all([1, 2, 3].map(() => api(t.shipper, 'PUT', `/requisitions/${id}/ship`, { note: 'รถ 1' })));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400, 400]);
    assert.equal(before - (await h.stockOf(P.WATER, B.HQ)), 10);
  });
  it('คนอื่นนอกจากสาขาเจ้าของ ตรวจรับไม่ได้', async () => {
    const d = await h.getRequisition(t.manager, id);
    const body = { items: [{ item_id: d.items[0].id, received_qty: 10, defective_qty: 0 }] };
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/receive`, body)).status, 403);
    assert.equal((await api(t.pktStaff, 'PUT', `/requisitions/${id}/receive`, body)).status, 403);
  });
  it('ตรวจรับครบ → เสร็จสิ้น, สต๊อกสาขาเพิ่ม, ไทม์ไลน์ครบทุกขั้น', async () => {
    const d = await h.getRequisition(t.cnxStaff, id);
    const r = await api(t.cnxStaff, 'PUT', `/requisitions/${id}/receive`, { items: [{ item_id: d.items[0].id, received_qty: 10, defective_qty: 0 }] });
    assert.equal(r.status, 200);
    const done = await h.getRequisition(t.cnxStaff, id);
    assert.equal(done.status, 'completed');
    assert.deepEqual(done.events.map((e) => e.type), ['created', 'approved', 'shipped', 'received_ok']);
    assert.ok((await h.stockOf(P.WATER, B.CNX)) >= 10);
  });
  it('ตรวจรับซ้ำ → 400 สต๊อกไม่เพิ่มซ้ำ', async () => {
    const before = await h.stockOf(P.WATER, B.CNX);
    const d = await h.getRequisition(t.cnxStaff, id);
    const r = await api(t.cnxStaff, 'PUT', `/requisitions/${id}/receive`, { items: [{ item_id: d.items[0].id, received_qty: 10, defective_qty: 0 }] });
    assert.equal(r.status, 400);
    assert.equal(await h.stockOf(P.WATER, B.CNX), before);
  });
});

describe('ตรวจรับ — ข้อมูลผิด', () => {
  let id, item;
  before(async () => {
    id = await h.createRequisition(t.pktStaff, [{ product_id: P.WATER, requested_qty: 5 }]);
    await h.approveAll(t, id);
    await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {});
    item = (await h.getRequisition(t.pktStaff, id)).items[0];
  });
  it('สภาพดี + ชำรุด เกินที่ส่งมา → 400', async () => {
    const r = await api(t.pktStaff, 'PUT', `/requisitions/${id}/receive`, { items: [{ item_id: item.id, received_qty: 4, defective_qty: 2 }] });
    assert.equal(r.status, 400);
  });
  it('จำนวนติดลบ → 400', async () => {
    const r = await api(t.pktStaff, 'PUT', `/requisitions/${id}/receive`, { items: [{ item_id: item.id, received_qty: -1, defective_qty: 0 }] });
    assert.equal(r.status, 400);
  });
  it('ไม่ระบุครบทุกรายการ → 400', async () => {
    assert.equal((await api(t.pktStaff, 'PUT', `/requisitions/${id}/receive`, { items: [] })).status, 400);
  });
  it('ตรวจรับถูกต้องหลังจากนั้นยังทำได้ (ข้อมูลผิดก่อนหน้าไม่ทำให้ค้าง)', async () => {
    const r = await api(t.pktStaff, 'PUT', `/requisitions/${id}/receive`, { items: [{ item_id: item.id, received_qty: 5, defective_qty: 0 }] });
    assert.equal(r.status, 200);
    assert.equal(await h.stockOf(P.WATER, B.PKT), 5);
  });
});
