/**
 * Seed script – safe to run on a fresh or already-populated database.
 * Every INSERT uses ON DUPLICATE KEY UPDATE (or INSERT IGNORE) so re-runs
 * are idempotent.
 *
 * Usage:
 *   node seed.js              – seed everything
 *   node seed.js --users-only – only insert/update users
 *
 * Default credentials (all roles):
 *   admin@inventory.com   / password123  (admin,        no branch)
 *   manager@inventory.com / password123  (main_manager, branch สาขาหลัก)
 *   staff@inventory.com   / password123  (staff, branch สาขาหลัก)
 *   shipper@inventory.com / password123  (shipper พนักงานจัดส่ง, สาขาหลัก)
 *   cnx@inventory.com     / password123  (staff, สาขาเชียงใหม่ — ใช้ลองขอเบิก)
 */

require('dotenv').config();
const mysql  = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const SEED_PASSWORD = 'password123';
const ROUNDS        = 10;

async function main() {
  const usersOnly = process.argv.includes('--users-only');

  const conn = await mysql.createConnection({
    host    : process.env.DB_HOST     || 'localhost',
    port    : Number(process.env.DB_PORT) || 3306,
    user    : process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'inventory_db',
    charset : 'utf8mb4',
    multipleStatements: true,
  });

  await conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");

  console.log('Hashing passwords…');
  const hash = await bcrypt.hash(SEED_PASSWORD, ROUNDS);
  console.log(`  hash = ${hash}`);

  // ── 1. Branches ──────────────────────────────────────────────────────────
  if (!usersOnly) {
    console.log('\nSeeding branches…');
    const branches = [
      { name: 'สาขาหลัก',    location: 'กรุงเทพ'  },
      { name: 'สาขาเชียงใหม่', location: 'เชียงใหม่' },
      { name: 'สาขาภูเก็ต',   location: 'ภูเก็ต'   },
    ];
    for (const b of branches) {
      // branches table has no UNIQUE on name, so use find-or-create
      const [existing] = await conn.query('SELECT id FROM branches WHERE name = ? LIMIT 1', [b.name]);
      if (existing.length === 0) {
        await conn.query(
          'INSERT INTO branches (name, location, is_warehouse) VALUES (?, ?, ?)',
          [b.name, b.location, b.name === 'สาขาหลัก' ? 1 : 0]
        );
        console.log(`  inserted branch: ${b.name}`);
      } else {
        console.log(`  skipped  branch: ${b.name} (id=${existing[0].id})`);
      }
    }
  }

  // ── 2. Resolve branch ids by name ────────────────────────────────────────
  const [branchRows] = await conn.query('SELECT id, name FROM branches');
  const branchMap = {};
  for (const b of branchRows) branchMap[b.name] = b.id;

  const mainBranchId = branchMap['สาขาหลัก'];
  if (!mainBranchId) {
    console.error('ERROR: branch "สาขาหลัก" not found. Run without --users-only first.');
    await conn.end();
    process.exit(1);
  }

  // ── 3. Users ─────────────────────────────────────────────────────────────
  console.log('\nSeeding users…');
  const users = [
    { name: 'Admin',          email: 'admin@inventory.com',   role: 'admin',        branch_id: null         },
    { name: 'ผู้จัดการสาขาหลัก', email: 'manager@inventory.com', role: 'main_manager', branch_id: mainBranchId },
    { name: 'พนักงานสาขาหลัก',  email: 'staff@inventory.com',   role: 'staff', branch_id: mainBranchId },
    // ครบทุกบทบาทในขั้นตอนใบขอเบิก: สาขาย่อยขอ → ผู้จัดการอนุมัติ → พนักงานจัดส่งส่ง → สาขาย่อยตรวจรับ
    { name: 'พนักงานจัดส่ง',     email: 'shipper@inventory.com', role: 'shipper', branch_id: mainBranchId },
    { name: 'พนักงานสาขาเชียงใหม่', email: 'cnx@inventory.com',  role: 'staff', branch_id: branchMap['สาขาเชียงใหม่'] || mainBranchId },
  ];
  for (const u of users) {
    const [r] = await conn.query(
      // รหัสตัวอย่าง (password123) ใครก็รู้ → บังคับให้เปลี่ยนตอนเข้าใช้ครั้งแรก
      `INSERT INTO users (name, email, password_hash, role, branch_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         name          = VALUES(name),
         password_hash = VALUES(password_hash),
         role          = VALUES(role),
         branch_id     = VALUES(branch_id),
         must_change_password = 1`,
      [u.name, u.email, hash, u.role, u.branch_id]
    );
    const action = r.affectedRows === 1 ? 'inserted' : r.affectedRows === 2 ? 'updated' : 'unchanged';
    console.log(`  ${action} user: ${u.email} (${u.role})`);
  }

  if (usersOnly) {
    await conn.end();
    console.log('\nDone (--users-only).');
    return;
  }

  // ── 4. Products ──────────────────────────────────────────────────────────
  console.log('\nSeeding products…');
  const products = [
    { name: 'น้ำดื่ม',  sku: 'WTR001', category: 'เครื่องดื่ม', unit: 'ขวด'  },
    { name: 'ขนม',     sku: 'SNK001', category: 'อาหาร',       unit: 'ถุง'   },
    { name: 'กาแฟ',    sku: 'COF001', category: 'เครื่องดื่ม', unit: 'แก้ว'  },
    { name: 'ปากกา',   sku: 'PEN001', category: 'เครื่องเขียน', unit: 'ด้าม' },
    { name: 'กระดาษ A4', sku: 'PAP001', category: 'เครื่องเขียน', unit: 'รีม' },
  ];
  for (const p of products) {
    const [r] = await conn.query(
      `INSERT INTO products (name, sku, category, unit)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         name     = VALUES(name),
         category = VALUES(category),
         unit     = VALUES(unit)`,
      [p.name, p.sku, p.category, p.unit]
    );
    const action = r.affectedRows === 1 ? 'inserted' : r.affectedRows === 2 ? 'updated' : 'unchanged';
    console.log(`  ${action} product: ${p.sku} – ${p.name}`);
  }

  // ── 5. Sample transactions (only if the main branch has none yet) ─────────
  const [txCheck] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM transactions WHERE branch_id = ?', [mainBranchId]
  );
  if (txCheck[0].cnt === 0) {
    console.log('\nSeeding sample transactions…');

    const [prodRows] = await conn.query('SELECT id, sku FROM products');
    const prodMap = {};
    for (const p of prodRows) prodMap[p.sku] = p.id;

    const [adminRow] = await conn.query(
      "SELECT id FROM users WHERE role = 'main_manager' AND branch_id = ? LIMIT 1", [mainBranchId]
    );
    const userId = adminRow[0]?.id;

    const txSeed = [
      { sku: 'WTR001', type: 'receive', qty: 100, after: 100, note: 'รับสต็อกเริ่มต้น' },
      { sku: 'SNK001', type: 'receive', qty: 80,  after: 80,  note: 'รับสต็อกเริ่มต้น' },
      { sku: 'COF001', type: 'receive', qty: 60,  after: 60,  note: 'รับสต็อกเริ่มต้น' },
      { sku: 'PEN001', type: 'receive', qty: 50,  after: 50,  note: 'รับสต็อกเริ่มต้น' },
      { sku: 'PAP001', type: 'receive', qty: 40,  after: 40,  note: 'รับสต็อกเริ่มต้น' },
      { sku: 'WTR001', type: 'issue',   qty: 10,  after: 90,  note: 'เบิกใช้งาน'      },
      { sku: 'SNK001', type: 'issue',   qty: 5,   after: 75,  note: 'เบิกใช้งาน'      },
    ];
    for (const t of txSeed) {
      await conn.query(
        'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES (?,?,?,?,?,?,?)',
        [prodMap[t.sku], mainBranchId, userId, t.type, t.qty, t.after, t.note]
      );
      console.log(`  inserted tx: ${t.sku} ${t.type} ${t.qty}`);
    }
  } else {
    console.log(`\nSkipping sample transactions – branch already has ${txCheck[0].cnt} transaction(s).`);
  }

  // ── 6. Branch products (เปิดใช้งานสินค้าทั้งหมดให้ทุกสาขาเป็นค่าเริ่มต้น) ──────
  console.log('\nSeeding branch_products…');
  const [prodRowsBp] = await conn.query('SELECT id FROM products');
  for (const b of branchRows) {
    for (const p of prodRowsBp) {
      await conn.query(
        `INSERT INTO branch_products (branch_id, product_id, is_active) VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE is_active = is_active`,
        [b.id, p.id]
      );
    }
  }
  console.log(`  ensured ${branchRows.length} branch(es) x ${prodRowsBp.length} product(s)`);

  // ── 7. Alerts ────────────────────────────────────────────────────────────
  console.log('\nSeeding alerts…');
  const [prodRows2] = await conn.query('SELECT id, sku FROM products');
  const prodMap2 = {};
  for (const p of prodRows2) prodMap2[p.sku] = p.id;

  const alertSeeds = [
    { sku: 'WTR001', branch_id: mainBranchId, min_qty: 20 },
    { sku: 'SNK001', branch_id: mainBranchId, min_qty: 15 },
    { sku: 'COF001', branch_id: mainBranchId, min_qty: 10 },
  ];
  for (const a of alertSeeds) {
    if (!prodMap2[a.sku]) continue;
    const [r] = await conn.query(
      `INSERT INTO alerts (product_id, branch_id, min_quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE min_quantity = VALUES(min_quantity), is_active = 1`,
      [prodMap2[a.sku], a.branch_id, a.min_qty]
    );
    const action = r.affectedRows === 1 ? 'inserted' : r.affectedRows === 2 ? 'updated' : 'unchanged';
    console.log(`  ${action} alert: ${a.sku} min=${a.min_qty}`);
  }

  await conn.end();
  console.log('\nSeed complete.');
  console.log('\nTest credentials (password: password123)');
  console.log('  admin@inventory.com   – admin');
  console.log('  manager@inventory.com – main_manager');
  console.log('  staff@inventory.com   – staff (สาขาหลัก)');
  console.log('  shipper@inventory.com – shipper (พนักงานจัดส่ง)');
  console.log('  cnx@inventory.com     – staff (สาขาเชียงใหม่)');
}

main().catch(err => { console.error(err); process.exit(1); });
