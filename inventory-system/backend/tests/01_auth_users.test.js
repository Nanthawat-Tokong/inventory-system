// ทดสอบ: ล็อกอิน / token / สิทธิ์ที่อัปเดตทันที / จัดการผู้ใช้
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { api, B } = h;

let t;
before(async () => { t = await h.bootstrap(); });
after(() => h.stopServer());

describe('ล็อกอิน', () => {
  it('รหัสถูก → ได้ token และข้อมูลผู้ใช้ (ไม่มี password_hash)', async () => {
    const r = await api(null, 'POST', '/auth/login', { email: h.USERS.manager.email, password: h.PASSWORD });
    assert.equal(r.status, 200);
    assert.ok(r.body.token);
    assert.equal(r.body.user.role, 'main_manager');
    assert.equal(r.body.user.password_hash, undefined);
  });
  it('รหัสผิด → 401', async () => {
    const r = await api(null, 'POST', '/auth/login', { email: h.USERS.manager.email, password: 'wrong' });
    assert.equal(r.status, 401);
  });
  it('อีเมลไม่มีในระบบ → 401 (ข้อความเดียวกับรหัสผิด)', async () => {
    const r = await api(null, 'POST', '/auth/login', { email: 'nobody@t.test', password: 'x' });
    assert.equal(r.status, 401);
  });
  it('ไม่ส่งอีเมล/รหัส → 400 ไม่ใช่ 500', async () => {
    const r = await api(null, 'POST', '/auth/login', {});
    assert.equal(r.status, 400);
  });
  it('ไม่มี token / token ปลอม → 401', async () => {
    assert.equal((await api(null, 'GET', '/products')).status, 401);
    assert.equal((await api('fake.token.here', 'GET', '/products')).status, 401);
  });
  it('/auth/me คืนข้อมูลผู้ใช้ล่าสุด รวมสาขาและสถานะคลังหลัก', async () => {
    const r = await api(t.manager, 'GET', '/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.body.branch_id, B.HQ);
    assert.equal(Number(r.body.is_warehouse), 1);
  });
});

describe('สิทธิ์อัปเดตทันทีโดยไม่ต้องล็อกอินใหม่', () => {
  it('admin ลดสิทธิ์ผู้จัดการเป็นพนักงาน → token เดิมใช้สิทธิ์ผู้จัดการไม่ได้ทันที', async () => {
    const tmp = await api(t.admin, 'POST', '/users', { name: 'tmp', email: 'tmpmgr@t.test', password: 'password123', role: 'main_manager', branch_id: B.HQ });
    assert.equal(tmp.status, 201);
    await h.clearMustChange('tmpmgr@t.test');
    const tok = (await api(null, 'POST', '/auth/login', { email: 'tmpmgr@t.test', password: 'password123' })).body.token;
    assert.equal((await api(tok, 'GET', '/alerts/settings')).status, 200);
    await api(t.admin, 'PUT', `/users/${tmp.body.id}`, { name: 'tmp', email: 'tmpmgr@t.test', role: 'staff', branch_id: B.HQ });
    assert.equal((await api(tok, 'GET', '/alerts/settings')).status, 403);
  });
  it('ผู้ใช้ถูกลบ → token เดิมใช้ไม่ได้', async () => {
    const u = await api(t.admin, 'POST', '/users', { name: 'gone', email: 'gone@t.test', password: 'password123', role: 'staff', branch_id: B.CNX });
    await h.clearMustChange('gone@t.test');
    const tok = (await api(null, 'POST', '/auth/login', { email: 'gone@t.test', password: 'password123' })).body.token;
    assert.equal((await api(t.admin, 'DELETE', `/users/${u.body.id}`)).status, 200);
    assert.equal((await api(tok, 'GET', '/products')).status, 401);
  });
});

describe('จัดการผู้ใช้', () => {
  it('เฉพาะ admin ดู/เพิ่มผู้ใช้ได้', async () => {
    assert.equal((await api(t.manager, 'GET', '/users')).status, 403);
    assert.equal((await api(t.cnxStaff, 'POST', '/users', {})).status, 403);
    assert.equal((await api(t.admin, 'GET', '/users')).status, 200);
  });
  it('อีเมลซ้ำ → 400', async () => {
    const r = await api(t.admin, 'POST', '/users', { name: 'x', email: h.USERS.manager.email, password: 'password123', role: 'staff', branch_id: B.CNX });
    assert.equal(r.status, 400);
  });
  it('ไม่ใส่รหัสผ่าน หรือรหัสสั้นกว่า 8 ตัว → 400', async () => {
    assert.equal((await api(t.admin, 'POST', '/users', { name: 'x', email: 'nopw@t.test', role: 'staff', branch_id: B.CNX })).status, 400);
    assert.equal((await api(t.admin, 'POST', '/users', { name: 'x', email: 'shortpw@t.test', password: '123', role: 'staff', branch_id: B.CNX })).status, 400);
  });
  it('ไม่ใส่ชื่อ หรืออีเมลผิดรูปแบบ → 400', async () => {
    assert.equal((await api(t.admin, 'POST', '/users', { email: 'noname@t.test', password: 'password123', role: 'staff', branch_id: B.CNX })).status, 400);
    assert.equal((await api(t.admin, 'POST', '/users', { name: 'x', email: 'not-an-email', password: 'password123', role: 'staff', branch_id: B.CNX })).status, 400);
  });
  it('บทบาทไม่มีจริง → 400', async () => {
    const r = await api(t.admin, 'POST', '/users', { name: 'x', email: 'badrole@t.test', password: 'password123', role: 'superuser', branch_id: B.CNX });
    assert.equal(r.status, 400);
  });
  it('พนักงานจัดส่งต้องอยู่คลังหลัก', async () => {
    assert.equal((await api(t.admin, 'POST', '/users', { name: 'x', email: 'sh1@t.test', password: 'password123', role: 'shipper', branch_id: B.CNX })).status, 400);
    assert.equal((await api(t.admin, 'POST', '/users', { name: 'x', email: 'sh2@t.test', password: 'password123', role: 'shipper', branch_id: B.HQ })).status, 201);
  });
  it('พนักงาน/ผู้จัดการต้องมีสาขา', async () => {
    const r = await api(t.admin, 'POST', '/users', { name: 'x', email: 'nobranch@t.test', password: 'password123', role: 'staff' });
    assert.equal(r.status, 400);
  });
  it('admin ลบบัญชีตัวเองไม่ได้', async () => {
    const me = (await api(t.admin, 'GET', '/auth/me')).body;
    assert.equal((await api(t.admin, 'DELETE', `/users/${me.id}`)).status, 400);
  });
  it('admin ลดสิทธิ์ตัวเองจนไม่เหลือ admin ไม่ได้', async () => {
    const me = (await api(t.admin, 'GET', '/auth/me')).body;
    const r = await api(t.admin, 'PUT', `/users/${me.id}`, { name: me.name, email: me.email, role: 'staff', branch_id: B.HQ });
    assert.equal(r.status, 400);
  });
  it('ลบผู้ใช้ที่เคยทำรายการสต๊อก → ไม่ยอม (กันประวัติสต๊อกหาย)', async () => {
    await api(t.manager, 'POST', '/inventory/receive', { product_id: h.P.WATER, branch_id: B.HQ, quantity: 7 });
    const before = await h.stockOf(h.P.WATER, B.HQ);
    const me = (await api(t.manager, 'GET', '/auth/me')).body;
    const r = await api(t.admin, 'DELETE', `/users/${me.id}`);
    assert.equal(r.status, 400);
    assert.equal(await h.stockOf(h.P.WATER, B.HQ), before);
  });
});
