// ทดสอบ: เปลี่ยนรหัสผ่านเอง / ยกเลิกหลังอนุมัติ / จัดการของชำรุด (ตัดทิ้ง-ส่งคืน)
// ใช้ Jest (describe / it / beforeAll / afterAll เป็นตัวแปรส่วนกลางของ Jest)
const assert = require('node:assert/strict');
const h = require('./helpers');
const { api, B, P } = h;

let t;
beforeAll(async () => {
  t = await h.bootstrap();
  await h.receiveStock(t, P.WATER, 50);
});
afterAll(() => h.stopServer());

describe('เปลี่ยนรหัสผ่าน', () => {
  it('บัญชีที่ admin สร้าง ต้องเปลี่ยนรหัสก่อนใช้งาน — ทำอย่างอื่นไม่ได้จนกว่าจะเปลี่ยน', async () => {
    await api(t.admin, 'POST', '/users', { name: 'ใหม่', email: 'new@t.test', password: 'tempPass123', role: 'staff', branch_id: B.CNX });
    const login = await api(null, 'POST', '/auth/login', { email: 'new@t.test', password: 'tempPass123' });
    assert.equal(login.body.user.must_change_password, 1);
    const tok = login.body.token;
    const blocked = await api(tok, 'GET', '/products');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'MUST_CHANGE_PASSWORD');
    assert.equal((await api(tok, 'GET', '/auth/me')).status, 200, '/auth/me ยังใช้ได้');

    assert.equal((await api(tok, 'PUT', '/auth/password', { current_password: 'wrong', new_password: 'myNewPass99' })).status, 400, 'รหัสเดิมผิด');
    assert.equal((await api(tok, 'PUT', '/auth/password', { current_password: 'tempPass123', new_password: 'short' })).status, 400, 'สั้นเกิน');
    assert.equal((await api(tok, 'PUT', '/auth/password', { current_password: 'tempPass123', new_password: 'tempPass123' })).status, 400, 'ซ้ำรหัสเดิม');
    assert.equal((await api(tok, 'PUT', '/auth/password', { current_password: 'tempPass123', new_password: 'myNewPass99' })).status, 200);

    assert.equal((await api(tok, 'GET', '/products')).status, 200, 'เปลี่ยนแล้วใช้งานได้');
    assert.equal((await api(null, 'POST', '/auth/login', { email: 'new@t.test', password: 'tempPass123' })).status, 401, 'รหัสเก่าใช้ไม่ได้');
    assert.equal((await api(null, 'POST', '/auth/login', { email: 'new@t.test', password: 'myNewPass99' })).status, 200);
  });
  it('admin รีเซ็ตรหัสให้ → ผู้ใช้ต้องเปลี่ยนใหม่อีกครั้ง', async () => {
    const [u] = await h.db('SELECT id, name, email, role, branch_id FROM users WHERE email = ?', ['new@t.test']);
    await api(t.admin, 'PUT', `/users/${u.id}`, { ...u, password: 'resetPass123' });
    const login = await api(null, 'POST', '/auth/login', { email: 'new@t.test', password: 'resetPass123' });
    assert.equal(login.body.user.must_change_password, 1);
  });
  it('ทุกบทบาทเปลี่ยนรหัสของตัวเองได้', async () => {
    const r = await api(t.shipper, 'PUT', '/auth/password', { current_password: h.PASSWORD, new_password: 'shipperPass1' });
    assert.equal(r.status, 200);
  });
});

describe('ยกเลิกหลังอนุมัติ', () => {
  let id;
  beforeAll(async () => {
    id = await h.createRequisition(t.cnxStaff, [{ product_id: P.WATER, requested_qty: 30 }]);
    await h.approveAll(t, id);
  });
  it('อนุมัติแล้วของถูกจอง', async () => {
    assert.equal((await api(t.pktStaff, 'GET', '/requisitions/meta/warehouse-stock')).body.stock[P.WATER], 20);
  });
  it('ต้องมีเหตุผล / สาขาและพนักงานจัดส่งยกเลิกแทนไม่ได้', async () => {
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/cancel-approval`, {})).status, 400);
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}/cancel-approval`, { reason: 'x' })).status, 403);
    assert.equal((await api(t.shipper, 'PUT', `/requisitions/${id}/cancel-approval`, { reason: 'x' })).status, 403);
  });
  it('ยกเลิกแล้ว → ใบกลับเป็นถูกปฏิเสธ, ของที่จองถูกปล่อย, พนักงานจัดส่งส่งไม่ได้แล้ว', async () => {
    const r = await api(t.manager, 'PUT', `/requisitions/${id}/cancel-approval`, { reason: 'อนุมัติผิดจำนวน' });
    assert.equal(r.status, 200);
    const d = await h.getRequisition(t.cnxStaff, id);
    assert.equal(d.status, 'rejected');
    assert.match(d.reject_reason, /อนุมัติผิดจำนวน/);
    assert.ok(d.items.every((i) => i.approved_qty === null));
    assert.ok(d.events.some((e) => e.type === 'approval_cancelled'));
    assert.equal((await api(t.pktStaff, 'GET', '/requisitions/meta/warehouse-stock')).body.stock[P.WATER], 50);
    assert.equal((await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {})).status, 400);
  });
  it('สาขาแก้แล้วส่งใหม่ได้ตามปกติ', async () => {
    assert.equal((await api(t.cnxStaff, 'PUT', `/requisitions/${id}`, { items: [{ product_id: P.WATER, requested_qty: 10 }] })).status, 200);
    assert.equal((await h.getRequisition(t.cnxStaff, id)).status, 'pending');
  });
  it('ส่งไปแล้ว → ยกเลิกไม่ได้', async () => {
    await h.approveAll(t, id);
    await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {});
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/cancel-approval`, { reason: 'x' })).status, 400);
    const d = await h.getRequisition(t.cnxStaff, id);
    await api(t.cnxStaff, 'PUT', `/requisitions/${id}/receive`, { items: d.items.map((i) => ({ item_id: i.id, received_qty: i.shipped_qty, defective_qty: 0 })) });
  });
});

describe('ของชำรุด: ตัดทิ้ง / ส่งคืนคลังหลัก', () => {
  let id, item;
  beforeAll(async () => {
    id = await h.createRequisition(t.pktStaff, [{ product_id: P.WATER, requested_qty: 10 }]);
    await h.approveAll(t, id);
    await api(t.shipper, 'PUT', `/requisitions/${id}/ship`, {});
    item = (await h.getRequisition(t.pktStaff, id)).items[0];
    await api(t.pktStaff, 'PUT', `/requisitions/${id}/receive`, { issue_note: 'แตก 4', items: [{ item_id: item.id, received_qty: 6, defective_qty: 4 }] });
  });
  it('รายละเอียดใบบอกว่ามีของชำรุด 4 ชิ้นที่ยังไม่ได้ตัดสินใจ', async () => {
    const d = await h.getRequisition(t.manager, id);
    assert.equal(d.items[0].defect_undecided, 4);
    expect(d.defects).toEqual([]);
  });
  it('เกินจำนวนชำรุด / action แปลก / ไม่ใช่ผู้อนุมัติ → ไม่ได้', async () => {
    assert.equal((await api(t.manager, 'POST', `/requisitions/${id}/defects`, { items: [{ requisition_item_id: item.id, qty: 5, action: 'write_off' }] })).status, 400);
    assert.equal((await api(t.manager, 'POST', `/requisitions/${id}/defects`, { items: [{ requisition_item_id: item.id, qty: 1, action: 'sell' }] })).status, 400);
    assert.equal((await api(t.pktStaff, 'POST', `/requisitions/${id}/defects`, { items: [{ requisition_item_id: item.id, qty: 1, action: 'write_off' }] })).status, 403);
  });
  it('ตัดทิ้ง 1 + ส่งคืน 3 → ตัดทิ้งจบทันที, ส่งคืนรอคลังหลักยืนยัน', async () => {
    const r = await api(t.manager, 'POST', `/requisitions/${id}/defects`, { note: 'แตกเล็กน้อย 1 ขวดทิ้ง', items: [
      { requisition_item_id: item.id, qty: 1, action: 'write_off' },
      { requisition_item_id: item.id, qty: 3, action: 'return' },
    ] });
    assert.equal(r.status, 201);
    const d = await h.getRequisition(t.manager, id);
    assert.equal(d.items[0].defect_undecided, 0);
    expect(d.defects.map((x) => [x.action, x.status, x.qty])).toEqual([['write_off', 'done', 1], ['return', 'pending', 3]]);
    assert.equal((await api(t.manager, 'POST', `/requisitions/${id}/defects`, { items: [{ requisition_item_id: item.id, qty: 1, action: 'write_off' }] })).status, 400, 'ตัดสินใจครบแล้ว เพิ่มไม่ได้');
  });
  it('ของชำรุดไม่กระทบยอดสต๊อกใคร (สาขาได้แค่ 6 ชิ้นที่ดี)', async () => {
    assert.equal(await h.stockOf(P.WATER, B.PKT), 6);
  });
  it('สาขายืนยันรับคืนแทนคลังหลักไม่ได้ / พนักงานจัดส่งยืนยันได้ / ยืนยันซ้ำไม่ได้', async () => {
    const ret = (await h.getRequisition(t.manager, id)).defects.find((x) => x.action === 'return');
    assert.equal((await api(t.pktStaff, 'PUT', `/requisitions/${id}/defects/${ret.id}/received`, {})).status, 403);
    assert.equal((await api(t.shipper, 'PUT', `/requisitions/${id}/defects/${ret.id}/received`, {})).status, 200);
    assert.equal((await api(t.shipper, 'PUT', `/requisitions/${id}/defects/${ret.id}/received`, {})).status, 400);
    const d = await h.getRequisition(t.manager, id);
    assert.ok(d.defects.every((x) => x.status === 'done'));
    assert.ok(d.events.some((e) => e.type === 'defect_returned'));
  });
  it('จัดการของชำรุดครบแล้ว → ขอปิดเคสได้', async () => {
    await api(t.manager, 'PUT', `/requisitions/${id}/respond`, { state: 'awaiting_stock', message: 'ไม่ส่งเพิ่ม' });
    assert.equal((await api(t.manager, 'PUT', `/requisitions/${id}/propose-close`, { message: 'ลดยอด 4 ขวด' })).status, 200);
  });
});
