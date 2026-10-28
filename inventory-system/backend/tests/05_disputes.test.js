// ทดสอบ: เคสมีปัญหา — ของชำรุด / ส่งไม่ครบ / ของชดเชย / ปิดเคสต้องตกลงทั้ง 2 ฝ่าย
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { api, B, P } = h;

let t;
before(async () => {
  t = await h.bootstrap();
  await h.receiveStock(t, P.WATER, 50);
  await h.receiveStock(t, P.PEN, 10);
});
after(() => h.stopServer());

// เดินใบขอเบิกจนสาขาตรวจรับ ตามผลที่กำหนดต่อสินค้า { product_id: [good, bad] }
async function shippedAndReceived(items, result) {
  const id = await h.createRequisition(t.cnxStaff, items);
  await h.approveAll(t, id);
  assert.equal((await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {})).status, 200);
  const d = await h.getRequisition(t.cnxStaff, id);
  const r = await api(t.cnxStaff, 'PUT', `/requisitions/${id}/receive`, {
    issue_note: 'กล่องแตก',
    items: d.items.map((i) => ({ item_id: i.id, received_qty: result[i.product_id][0], defective_qty: result[i.product_id][1] })),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return id;
}

describe('แจ้งของชำรุด', () => {
  let id;
  before(async () => { id = await shippedAndReceived([{ product_id: P.WATER, requested_qty: 10 }], { [P.WATER]: [8, 2] }); });

  it('ของชำรุดไม่เข้าสต๊อกสาขา เข้าเฉพาะสภาพดี', async () => {
    assert.equal(await h.stockOf(P.WATER, B.CNX), 8);
  });
  it('เคสเปิดเป็น "มีปัญหา — รอคลังหลักตอบ" และผู้อนุมัติได้รับแจ้ง', async () => {
    const d = await h.getRequisition(t.manager, id);
    assert.equal(d.status, 'disputed');
    assert.equal(d.dispute_state, 'awaiting_response');
    assert.equal(d.items[0].defective_qty, 2);
    assert.equal(d.items[0].shortage, 2);
    const row = (await api(t.manager, 'GET', '/requisitions')).body.find((r) => r.id === id);
    assert.equal(row.needs_action, true);
    assert.ok(d.events.some((e) => e.type === 'issue_reported' && /ชำรุด/.test(e.message)));
  });
  it('ปิดเคสฝ่ายเดียวไม่ได้ — สาขายืนยันปิดเองไม่ได้, คลังหลักขอปิดก่อนตอบกลับไม่ได้', async () => {
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}/accept-close`, {})).status, 400);
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/propose-close`, { message: 'ปิด' })).status, 400);
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/resolve`, { note: 'x' })).status, 404);
  });
  it('ส่งข้อความได้ทั้ง 2 ฝ่าย / สาขาอื่นส่งไม่ได้ / ข้อความว่างไม่ได้', async () => {
    assert.equal((await api(t.manager, 'POST', `/requisitions/${id}/messages`, { message: 'กำลังตรวจสอบ' })).status, 201);
    assert.equal((await api(t.cnxStaff, 'POST', `/requisitions/${id}/messages`, { message: 'รอนะครับ' })).status, 201);
    assert.equal((await api(t.pktStaff, 'POST', `/requisitions/${id}/messages`, { message: 'แทรก' })).status, 403);
    assert.equal((await api(t.manager, 'POST', `/requisitions/${id}/messages`, { message: '   ' })).status, 400);
  });
  it('ส่งของชดเชย: ผู้อนุมัติสร้าง → พนักงานจัดส่งส่ง → สาขารับครบ → ปิดเคสอัตโนมัติ', async () => {
    const item = (await h.getRequisition(t.manager, id)).items[0];
    assert.equal((await api(t.manager, 'POST', `/requisitions/${id}/replacements`, { items: [{ requisition_item_id: item.id, replacement_qty: 3 }] })).status, 400, 'เกินที่ขาด');
    const c = await api(t.manager, 'POST', `/requisitions/${id}/replacements`, { items: [{ requisition_item_id: item.id, replacement_qty: 2 }] });
    assert.equal(c.status, 201);
    assert.equal((await h.getRequisition(t.manager, id)).dispute_state, 'reshipping');
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/replacements/${c.body.id}/ship`, {})).status, 403, 'ผู้อนุมัติส่งเองไม่ได้');
    const before = await h.stockOf(P.WATER, B.HQ);
    const rs = await Promise.all([1, 2].map(() => api(t.shipper, 'PUT', `/requisitions/${id}/replacements/${c.body.id}/ship`, {})));
    assert.deepEqual(rs.map((r) => r.status).sort(), [200, 400]);
    assert.equal(before - (await h.stockOf(P.WATER, B.HQ)), 2);
    const rep = (await h.getRequisition(t.cnxStaff, id)).replacements[0];
    const r = await api(t.cnxStaff, 'PUT', `/requisitions/${id}/replacements/${c.body.id}/receive`, {
      items: [{ replacement_item_id: rep.items[0].id, received_qty: 2, defective_qty: 0 }],
    });
    assert.equal(r.status, 200);
    const d = await h.getRequisition(t.cnxStaff, id);
    assert.equal(d.status, 'completed');
    assert.equal(await h.stockOf(P.WATER, B.CNX), 10);
  });
});

describe('สต๊อกไม่พอ → ตกลงปิดเคสร่วมกัน', () => {
  let id, item;
  before(async () => {
    id = await shippedAndReceived([{ product_id: P.PEN, requested_qty: 10 }], { [P.PEN]: [7, 3] });
    item = (await h.getRequisition(t.manager, id)).items[0];
  });
  it('คลังหลักไม่มีของชดเชย → สร้างรายการชดเชยไม่ได้', async () => {
    const r = await api(t.manager, 'POST', `/requisitions/${id}/replacements`, { items: [{ requisition_item_id: item.id, replacement_qty: 3 }] });
    assert.equal(r.status, 400);
  });
  it('แจ้ง "สต๊อกยังไม่พอ" → สถานะเปลี่ยน, สถานะที่ไม่รู้จักไม่รับ', async () => {
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/respond`, { state: 'closed' })).status, 400);
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/respond`, { state: 'awaiting_stock', message: 'รอของเข้า' })).status, 200);
    assert.equal((await h.getRequisition(t.cnxStaff, id)).dispute_state, 'awaiting_stock');
  });
  it('ขอปิดเคสต้องมีเหตุผล', async () => {
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/propose-close`, {})).status, 400);
  });
  it('ยังไม่ตัดสินใจเรื่องของชำรุด → ขอปิดเคสไม่ได้', async () => {
    const r = await api(t.manager, 'PUT', `/requisitions/${id}/propose-close`, { message: 'ปิด' });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /ของชำรุด/);
    // ตัดทิ้ง 3 ชิ้นที่ชำรุด
    assert.equal((await api(t.manager, 'POST', `/requisitions/${id}/defects`, { items: [{ requisition_item_id: item.id, qty: 3, action: 'write_off' }] })).status, 201);
  });
  it('คลังหลักขอปิด → สาขาปฏิเสธต้องมีเหตุผล → กลับไปรอคลังหลักตอบ', async () => {
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/propose-close`, { message: 'ชดเชยรอบหน้า' })).status, 200);
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/accept-close`, {})).status, 403, 'คลังหลักยืนยันแทนสาขาไม่ได้');
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}/decline-close`, {})).status, 400);
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}/decline-close`, { message: 'ยังต้องการของ' })).status, 200);
    assert.equal((await h.getRequisition(t.cnxStaff, id)).dispute_state, 'awaiting_response');
  });
  it('ตอบกลับ → ขอปิดใหม่ → สาขายืนยัน → เสร็จสิ้น', async () => {
    await api(t.manager, 'PUT', `/requisitions/${id}/respond`, { state: 'awaiting_stock', message: 'ของหมดจากผู้ขาย' });
    await api(t.manager, 'PUT', `/requisitions/${id}/propose-close`, { message: 'ตกลงลดยอด 3 ด้าม' });
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}/accept-close`, {})).status, 200);
    const d = await h.getRequisition(t.cnxStaff, id);
    assert.equal(d.status, 'completed');
    assert.equal(d.dispute_state, null);
  });
});

describe('ส่งไม่ครบเพราะของหายระหว่างทาง', () => {
  it('ได้รับน้อยกว่าที่ส่ง (ไม่ได้กรอกชำรุด) ก็เปิดเคสด้วย', async () => {
    const id = await shippedAndReceived([{ product_id: P.WATER, requested_qty: 5 }], { [P.WATER]: [3, 0] });
    const d = await h.getRequisition(t.manager, id);
    assert.equal(d.status, 'disputed');
    assert.equal(d.items[0].shortage, 2);
  });
});
