// ============================================================
// tests/helpers.js — โครงสำหรับ integration test ทั้งระบบ
//
// ทุกไฟล์ทดสอบ:
//   1. สร้างฐานข้อมูลทดสอบใหม่ (inventory_db_test) จาก schema.sql — ไม่แตะฐานข้อมูลจริง
//   2. ใส่ข้อมูลตั้งต้นชุดเดียวกันทุกครั้ง (สาขา / ผู้ใช้ทุกบทบาท / สินค้า)
//   3. เปิด backend จริงที่ port 5099 ชี้ไปที่ฐานข้อมูลทดสอบ แล้วยิง HTTP เหมือนหน้าเว็บ
// รัน: npm test  (Jest — ทีละไฟล์ด้วย --runInBand เพราะทุกไฟล์ใช้ฐานข้อมูลทดสอบ/port เดียวกัน)
// ============================================================

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const TEST_DB = 'inventory_db_test';
const PORT = 5099;
const BASE = `http://localhost:${PORT}/api`;
const PASSWORD = 'password123';

const conn = () => mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
  multipleStatements: true,
});

// ข้อมูลตั้งต้น — id คงที่ เพื่อให้เขียนทดสอบอ้างอิงได้ตรงๆ
const B = { HQ: 1, CNX: 2, PKT: 3 };              // HQ = คลังหลัก
const P = { WATER: 1, PEN: 2, PAPER: 3, SNACK: 4, SOAP: 5 };
const USERS = {
  admin:     { email: 'admin@t.test',     role: 'admin',        branch: null },
  manager:   { email: 'manager@t.test',   role: 'main_manager', branch: B.HQ },  // ผู้อนุมัติคลังหลัก
  cnxMgr:    { email: 'cnxmgr@t.test',    role: 'main_manager', branch: B.CNX }, // ผู้จัดการสาขาย่อย
  shipper:   { email: 'shipper@t.test',   role: 'shipper',      branch: B.HQ },
  hqStaff:   { email: 'hqstaff@t.test',   role: 'staff',        branch: B.HQ },
  cnxStaff:  { email: 'cnxstaff@t.test',  role: 'staff',        branch: B.CNX },
  pktStaff:  { email: 'pktstaff@t.test',  role: 'staff',        branch: B.PKT },
};

async function resetDatabase() {
  const c = await conn();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  // ใช้เฉพาะส่วนโครงสร้างตาราง (ก่อนหัวข้อ Seed data) แล้วเปลี่ยนชื่อฐานข้อมูลเป็นฐานทดสอบ
  const ddl = schema.split(/--\s*─+\s*\n--\s*Seed data/)[0].replace(/\binventory_db\b/g, TEST_DB);
  await c.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await c.query(ddl);
  await c.query(`USE ${TEST_DB}`);

  await c.query(`INSERT INTO branches (id, name, location, is_warehouse) VALUES
    (${B.HQ}, 'สาขาหลัก', 'กรุงเทพ', 1), (${B.CNX}, 'สาขาเชียงใหม่', 'เชียงใหม่', 0), (${B.PKT}, 'สาขาภูเก็ต', 'ภูเก็ต', 0)`);
  const hash = await bcrypt.hash(PASSWORD, 4);
  for (const [key, u] of Object.entries(USERS)) {
    await c.query('INSERT INTO users (name, email, password_hash, role, branch_id) VALUES (?, ?, ?, ?, ?)',
      [key, u.email, hash, u.role, u.branch]);
  }
  await c.query(`INSERT INTO products (id, name, sku, category, unit, low_stock_threshold) VALUES
    (${P.WATER}, 'น้ำดื่ม', 'T-WATER', 'เครื่องดื่ม', 'ขวด', 10),
    (${P.PEN},   'ปากกา',   'T-PEN',   'เครื่องเขียน', 'ด้าม', 10),
    (${P.PAPER}, 'กระดาษ',  'T-PAPER', 'เครื่องเขียน', 'รีม', 5),
    (${P.SNACK}, 'ขนม',     'T-SNACK', 'อาหาร',       'ถุง', 10),
    (${P.SOAP},  'สบู่',     'T-SOAP',  'ของใช้',      'ก้อน', 10)`);
  // ทุกสาขาเปิดใช้ทุกสินค้า ยกเว้น "สบู่" ปิดไว้ที่ภูเก็ต
  await c.query(`INSERT INTO branch_products (branch_id, product_id, is_active)
    SELECT b.id, p.id, IF(b.id = ${B.PKT} AND p.id = ${P.SOAP}, 0, 1) FROM branches b, products p`);
  await c.end();
}

let server;
async function startServer() {
  server = spawn(process.execPath, ['src/server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DB_NAME: TEST_DB },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', (d) => { stderr += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/health`)).ok) return; } catch { /* ยังไม่พร้อม */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server ไม่ขึ้น: ${stderr}`);
}
function stopServer() { if (server) server.kill(); }

// เรียก API — คืน { status, body }
async function api(token, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ไม่มี body */ }
  return { status: res.status, body: data };
}

async function login(key) {
  const r = await api(null, 'POST', '/auth/login', { email: USERS[key].email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${key} ไม่ผ่าน: ${JSON.stringify(r.body)}`);
  return r.body.token;
}
async function loginAll() {
  const t = {};
  for (const k of Object.keys(USERS)) t[k] = await login(k);
  return t;
}

// query ตรงเข้าฐานข้อมูลทดสอบ (ใช้ตรวจผลลัพธ์)
async function db(sql, params = []) {
  const c = await conn();
  await c.query(`USE ${TEST_DB}`);
  const [rows] = await c.query(sql, params);
  await c.end();
  return rows;
}
// บัญชีที่ admin สร้างผ่าน API จะถูกบังคับเปลี่ยนรหัสก่อนใช้ — เทสต์ที่ไม่ได้ทดสอบเรื่องนี้ใช้ตัวนี้ข้ามไป
async function clearMustChange(email) {
  await db('UPDATE users SET must_change_password = 0 WHERE email = ?', [email]);
}
async function stockOf(productId, branchId) {
  const [r] = await db(
    'SELECT COALESCE(SUM(IF(type="receive", quantity, -quantity)), 0) AS s FROM transactions WHERE product_id=? AND branch_id=?',
    [productId, branchId]
  );
  return Number(r.s);
}

// ใช้ร่วมกัน: เตรียมระบบ + ล็อกอินทุกบทบาท
async function bootstrap() {
  await resetDatabase();
  await startServer();
  return loginAll();
}

// ช่วยเดินใบขอเบิกจนถึงขั้นที่ต้องการ
async function receiveStock(t, productId, qty) {
  const r = await api(t.manager, 'POST', '/inventory/receive', { product_id: productId, branch_id: B.HQ, quantity: qty });
  if (r.status !== 201) throw new Error(`receive ไม่ผ่าน: ${JSON.stringify(r.body)}`);
}
async function createRequisition(token, items, note = 'test') {
  const r = await api(token, 'POST', '/requisitions', { note, items });
  if (r.status !== 201) throw new Error(`create requisition ไม่ผ่าน: ${JSON.stringify(r.body)}`);
  return r.body.id;
}
async function getRequisition(token, id) {
  return (await api(token, 'GET', `/requisitions/${id}`)).body;
}
async function approveAll(t, id) {
  const d = await getRequisition(t.manager, id);
  const r = await api(t.manager, 'PUT', `/requisitions/${id}/approve`, {
    items: d.items.map((i) => ({ item_id: i.id, approved_qty: Math.min(i.requested_qty, i.warehouse_available) })),
  });
  if (r.status !== 200) throw new Error(`approve ไม่ผ่าน: ${JSON.stringify(r.body)}`);
}

module.exports = {
  B, P, USERS, PASSWORD, bootstrap, stopServer, api, login, db, stockOf, clearMustChange,
  receiveStock, createRequisition, getRequisition, approveAll,
};
