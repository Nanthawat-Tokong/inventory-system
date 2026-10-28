// ทดสอบ: สินค้า / สาขา / สินค้าประจำสาขา / กฎแจ้งเตือน
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { api, B, P } = h;

let t;
before(async () => { t = await h.bootstrap(); });
after(() => h.stopServer());

describe('สินค้า', () => {
  it('admin/ผู้จัดการเห็นสินค้าทั้งหมด, พนักงานเห็นเฉพาะที่เปิดใช้ในสาขาตัวเอง', async () => {
    assert.equal((await api(t.admin, 'GET', '/products')).body.length, 5);
    const pkt = (await api(t.pktStaff, 'GET', '/products')).body;
    assert.equal(pkt.length, 4);
    assert.ok(!pkt.some((p) => p.id === P.SOAP), 'สบู่ปิดไว้ที่ภูเก็ต ต้องไม่เห็น');
  });
  it('รายการสินค้ามีจำนวนคงเหลือ: คลังหลัก / สาขาตัวเอง / รวมทุกสาขา', async () => {
    await h.receiveStock(t, P.PAPER, 12);
    const mgr = (await api(t.manager, 'GET', '/products')).body.find((p) => p.id === P.PAPER);
    assert.equal(mgr.stock, 12);            // ผู้จัดการคลังหลัก: สาขาตัวเอง = คลังหลัก
    assert.equal(mgr.warehouse_stock, 12);
    assert.equal(mgr.total_stock, 12);
    const staff = (await api(t.cnxStaff, 'GET', '/products')).body.find((p) => p.id === P.PAPER);
    assert.equal(staff.stock, 0);           // สาขาเชียงใหม่ยังไม่มีของ
    assert.equal(staff.warehouse_stock, 12);
    assert.equal(staff.total_stock, undefined, 'พนักงานสาขาไม่เห็นยอดรวมทุกสาขา');
    const adm = (await api(t.admin, 'GET', '/products')).body.find((p) => p.id === P.PAPER);
    assert.equal(adm.stock, 12);            // admin ไม่มีสาขา → แสดงคลังหลัก
  });
  it('พนักงาน / พนักงานจัดส่ง เพิ่มสินค้าไม่ได้', async () => {
    assert.equal((await api(t.cnxStaff, 'POST', '/products', { name: 'x', sku: 'X1' })).status, 403);
    assert.equal((await api(t.shipper, 'POST', '/products', { name: 'x', sku: 'X1' })).status, 403);
  });
  it('เพิ่มสินค้าได้ และค่าเกณฑ์ขั้นต่ำเริ่มต้น 50', async () => {
    const r = await api(t.manager, 'POST', '/products', { name: 'ยางลบ', sku: 'T-ERASER', category: 'เครื่องเขียน' });
    assert.equal(r.status, 201);
    assert.equal(r.body.low_stock_threshold, 50);
  });
  it('ไม่ใส่ชื่อ/SKU → 400 ไม่ใช่ 500', async () => {
    assert.equal((await api(t.manager, 'POST', '/products', { sku: 'NO-NAME' })).status, 400);
    assert.equal((await api(t.manager, 'POST', '/products', { name: 'ไม่มีรหัส' })).status, 400);
  });
  it('เกณฑ์ขั้นต่ำติดลบ → 400', async () => {
    assert.equal((await api(t.manager, 'POST', '/products', { name: 'x', sku: 'NEG', low_stock_threshold: -5 })).status, 400);
  });
  it('SKU ซ้ำ ทั้งตอนเพิ่มและตอนแก้ → 400', async () => {
    assert.equal((await api(t.manager, 'POST', '/products', { name: 'x', sku: 'T-WATER' })).status, 400);
    const r = await api(t.manager, 'PUT', `/products/${P.PEN}`, { name: 'ปากกา', sku: 'T-WATER', unit: 'ด้าม' });
    assert.equal(r.status, 400);
  });
  it('สินค้าใหม่ถูกเปิดใช้ให้ทุกสาขาอัตโนมัติ (สาขาเห็นทันที)', async () => {
    const r = await api(t.manager, 'POST', '/products', { name: 'แฟ้ม', sku: 'T-FILE' });
    const seen = (await api(t.cnxStaff, 'GET', '/products')).body.some((p) => p.id === r.body.id);
    assert.ok(seen);
  });
  it('ลบสินค้าเป็นแบบซ่อน — หายจากรายการ แต่ประวัติยังอยู่', async () => {
    const r = await api(t.manager, 'POST', '/products', { name: 'ชั่วคราว', sku: 'T-TMP' });
    await api(t.manager, 'POST', '/inventory/receive', { product_id: r.body.id, branch_id: B.HQ, quantity: 3 });
    assert.equal((await api(t.manager, 'DELETE', `/products/${r.body.id}`)).status, 200);
    assert.ok(!(await api(t.admin, 'GET', '/products')).body.some((p) => p.id === r.body.id));
    assert.equal(await h.stockOf(r.body.id, B.HQ), 3);
    assert.equal((await api(t.manager, 'DELETE', `/products/${r.body.id}`)).status, 404);
  });
});

describe('สาขา', () => {
  it('เฉพาะ admin จัดการสาขาได้', async () => {
    assert.equal((await api(t.manager, 'POST', '/branches', { name: 'x' })).status, 403);
  });
  it('ไม่ใส่ชื่อสาขา → 400', async () => {
    assert.equal((await api(t.admin, 'POST', '/branches', { location: 'x' })).status, 400);
  });
  it('สาขาใหม่เห็นสินค้าทุกตัวทันที', async () => {
    const r = await api(t.admin, 'POST', '/branches', { name: 'สาขาระยอง' });
    assert.equal(r.status, 201);
    const bp = (await api(t.admin, 'GET', `/branch-products/${r.body.id}`)).body;
    assert.ok(bp.length >= 5 && bp.every((x) => x.is_active === 1));
  });
  it('ต้องมีคลังหลักเสมอ — เอาสถานะคลังหลักออกจากสาขาเดียวที่เป็นคลังไม่ได้', async () => {
    const r = await api(t.admin, 'PUT', `/branches/${B.HQ}`, { name: 'สาขาหลัก', location: 'กรุงเทพ', is_warehouse: false });
    assert.equal(r.status, 400);
  });
  it('ลบคลังหลักไม่ได้ / ลบสาขาที่ยังมีผู้ใช้ไม่ได้', async () => {
    assert.equal((await api(t.admin, 'DELETE', `/branches/${B.HQ}`)).status, 400);
    assert.equal((await api(t.admin, 'DELETE', `/branches/${B.CNX}`)).status, 400);
  });
  it('ลบสาขาว่างได้ (ซ่อน) และหายจากรายการ', async () => {
    const r = await api(t.admin, 'POST', '/branches', { name: 'ชั่วคราว' });
    assert.equal((await api(t.admin, 'DELETE', `/branches/${r.body.id}`)).status, 200);
    assert.ok(!(await api(t.admin, 'GET', '/branches')).body.some((b) => b.id === r.body.id));
  });
  it('ย้ายคลังหลัก → สิทธิ์ผู้อนุมัติย้ายตามทันที แล้วย้ายกลับได้', async () => {
    assert.equal((await api(t.admin, 'PUT', `/branches/${B.CNX}`, { name: 'สาขาเชียงใหม่', location: 'เชียงใหม่', is_warehouse: true })).status, 200);
    const [hq] = await h.db('SELECT is_warehouse FROM branches WHERE id=?', [B.HQ]);
    assert.equal(hq.is_warehouse, 0);
    // ผู้จัดการสาขาหลักไม่ใช่ผู้อนุมัติแล้ว
    assert.equal((await api(t.manager, 'PUT', '/requisitions/999/approve', { items: [{ item_id: 1, approved_qty: 1 }] })).status, 403);
    await api(t.admin, 'PUT', `/branches/${B.HQ}`, { name: 'สาขาหลัก', location: 'กรุงเทพ', is_warehouse: true });
    const [cnx] = await h.db('SELECT is_warehouse FROM branches WHERE id=?', [B.CNX]);
    assert.equal(cnx.is_warehouse, 0);
  });
});

describe('สินค้าประจำสาขา', () => {
  it('ปิดสินค้าให้สาขา → พนักงานสาขานั้นไม่เห็น และขอเบิกไม่ได้', async () => {
    const r = await api(t.manager, 'PUT', `/branch-products/${B.CNX}`, { product_ids: [P.WATER, P.PEN, P.PAPER, P.SOAP] });
    assert.equal(r.status, 200);
    assert.ok(!(await api(t.cnxStaff, 'GET', '/products')).body.some((p) => p.id === P.SNACK));
    await h.receiveStock(t, P.SNACK, 10);
    const q = await api(t.cnxStaff, 'POST', '/requisitions', { items: [{ product_id: P.SNACK, requested_qty: 1 }] });
    assert.equal(q.status, 400);
  });
  it('product_ids ไม่ใช่ array → 400', async () => {
    assert.equal((await api(t.manager, 'PUT', `/branch-products/${B.CNX}`, { product_ids: 'x' })).status, 400);
  });
  it('พนักงานแก้ไม่ได้', async () => {
    assert.equal((await api(t.cnxStaff, 'PUT', `/branch-products/${B.CNX}`, { product_ids: [] })).status, 403);
  });
});

describe('เกณฑ์แจ้งเตือนเฉพาะสาขา มีผลจริงทุกหน้า', () => {
  // ค่ากลางของน้ำดื่ม = 10 → เชียงใหม่ตั้งเฉพาะสาขาเป็น 30
  before(async () => {
    await h.receiveStock(t, P.WATER, 20);
    await api(t.admin, 'POST', '/alerts', { product_id: P.WATER, branch_id: B.CNX, min_quantity: 30 });
  });
  it('หน้า Dashboard (ดูสต๊อก): เชียงใหม่ใช้ 30, สาขาหลักยังใช้ค่ากลาง 10', async () => {
    const rows = (await api(t.admin, 'GET', '/inventory/stock')).body;
    const cnx = rows.find((r) => r.product_id === P.WATER && r.branch_id === B.CNX);
    const hq = rows.find((r) => r.product_id === P.WATER && r.branch_id === B.HQ);
    assert.equal(cnx.low_stock_threshold, 30);
    assert.equal(cnx.threshold_source, 'branch');
    assert.equal(hq.low_stock_threshold, 10);
    assert.equal(hq.threshold_source, 'product');
  });
  it('หน้าสินค้า: พนักงานเชียงใหม่เห็นเกณฑ์ 30', async () => {
    const w = (await api(t.cnxStaff, 'GET', '/products')).body.find((p) => p.id === P.WATER);
    assert.equal(w.threshold, 30);
    assert.equal(w.threshold_source, 'branch');
  });
  it('รายการสต๊อกต่ำ: สาขาหลักมี 20+ (≥10) ไม่ติด, เชียงใหม่มี 0 (<30) ติด พร้อมเกณฑ์ 30', async () => {
    const rows = (await api(t.admin, 'GET', '/alerts')).body.filter((r) => r.product_id === P.WATER);
    assert.ok(!rows.some((r) => r.branch_id === B.HQ));
    assert.equal(rows.find((r) => r.branch_id === B.CNX).min_quantity, 30);
  });
  it('รายงานควรสั่งเพิ่ม: เชียงใหม่แนะนำเติมถึง 2 เท่าของ 30 = 60', async () => {
    const rows = (await api(t.admin, 'GET', `/reports/reorder?branch_id=${B.CNX}`)).body.rows;
    assert.equal(rows.find((r) => r.product_id === P.WATER).suggest, 60);
  });
  it('ปิดกฎ → กลับไปใช้ค่ากลาง', async () => {
    const rule = (await api(t.admin, 'GET', '/alerts/settings')).body.find((r) => r.product_id === P.WATER && r.branch_id === B.CNX);
    await api(t.admin, 'PUT', `/alerts/${rule.id}`, { min_quantity: 30, is_active: 0 });
    const cnx = (await api(t.admin, 'GET', `/inventory/stock/${B.CNX}`)).body.find((r) => r.product_id === P.WATER);
    assert.equal(cnx.low_stock_threshold, 10);
  });
});

describe('กฎแจ้งเตือน', () => {
  it('ผู้จัดการตั้งกฎให้สาขาตัวเอง และตั้งซ้ำ = อัปเดต', async () => {
    assert.equal((await api(t.manager, 'POST', '/alerts', { product_id: P.WATER, min_quantity: 5 })).status, 201);
    assert.equal((await api(t.manager, 'POST', '/alerts', { product_id: P.WATER, min_quantity: 8 })).status, 200);
    const rules = (await api(t.manager, 'GET', '/alerts/settings')).body;
    assert.equal(rules.filter((r) => r.product_id === P.WATER).length, 1);
  });
  it('จำนวนขั้นต่ำติดลบ / ไม่มีสินค้า → 400 ไม่ใช่ 500', async () => {
    assert.equal((await api(t.manager, 'POST', '/alerts', { product_id: P.PEN, min_quantity: -1 })).status, 400);
    assert.equal((await api(t.manager, 'POST', '/alerts', { product_id: 99999, min_quantity: 1 })).status, 400);
  });
  it('ผู้จัดการแก้กฎของสาขาอื่นไม่ได้', async () => {
    const r = await api(t.admin, 'POST', '/alerts', { product_id: P.PEN, branch_id: B.PKT, min_quantity: 3 });
    assert.equal((await api(t.manager, 'DELETE', `/alerts/${r.body.id}`)).status, 403);
  });
  it('รายการสต๊อกต่ำของพนักงาน เห็นเฉพาะสาขาตัวเอง', async () => {
    const rows = (await api(t.cnxStaff, 'GET', '/alerts')).body;
    assert.ok(rows.length > 0 && rows.every((r) => r.branch_id === B.CNX));
  });
});
