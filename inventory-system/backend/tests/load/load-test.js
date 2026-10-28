/**
 * ทดสอบผู้ใช้งานพร้อมกัน (ตัวชี้วัดใน proposal: รองรับผู้ใช้พร้อมกันอย่างน้อย 10 คน, แสดงผลไม่เกิน 5 วินาที)
 *
 * - ใช้ฐานข้อมูลทดสอบ (inventory_db_test) เหมือน npm test — ไม่แตะข้อมูลจริง
 * - จำลองผู้ใช้ 10 คนพร้อมกัน ทำงานจริงวนไปเรื่อยๆ ตามบทบาทเป็นเวลา DURATION วินาที:
 *     พนักงานสาขา 6 คน : ดูหน้าแรก/สินค้า/ใบขอเบิก, สร้างใบขอเบิก, ตรวจรับของ
 *     ผู้อนุมัติ 2 คน    : ดูรายการ, อนุมัติใบที่รอ, ดูรายงาน
 *     พนักงานจัดส่ง 1 คน: จัดส่งใบที่อนุมัติแล้ว
 *     admin 1 คน        : ดูแดชบอร์ด/รายงานทุกแบบ
 * - จบแล้วตรวจความถูกต้อง: สต๊อกไม่ติดลบ, ยอดคงเหลือ = รับ − ออก ทุกแถว, ไม่มี error 500
 * - เขียนผลลงไฟล์ docs/load-test-result.md
 *
 * รัน: npm run test:load            (ค่าเริ่มต้น 10 คน 60 วินาที)
 *      USERS=20 DURATION=30 npm run test:load
 */

const fs = require('fs');
const path = require('path');
const h = require('../helpers');
const { api, B, P } = h;

const USERS = Number(process.env.USERS || 10);
const DURATION = Number(process.env.DURATION || 60) * 1000;
const lat = []; const errors = []; const byOp = new Map();

async function timed(op, token, method, url, body) {
  const t0 = performance.now();
  const r = await api(token, method, url, body);
  const ms = performance.now() - t0;
  lat.push(ms);
  const s = byOp.get(op) || { n: 0, ms: [] }; s.n++; s.ms.push(ms); byOp.set(op, s);
  if (r.status >= 500) errors.push(`${op} → ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
  return r;
}
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const t = await h.bootstrap();
  for (const pid of Object.values(P)) await h.receiveStock(t, pid, 5000);

  // ผู้ใช้ 10 คน: พนักงานสาขาเพิ่ม 3 คน (รวม 6) + ผู้อนุมัติคนที่ 2
  const extra = [['cnx2', B.CNX, 'staff'], ['pkt2', B.PKT, 'staff'], ['cnx3', B.CNX, 'staff'], ['mgr2', B.HQ, 'main_manager']];
  const tok = { ...t };
  for (const [name, branch, role] of extra) {
    const email = `${name}@t.test`;
    await api(t.admin, 'POST', '/users', { name, email, password: 'password123', role, branch_id: branch });
    await h.clearMustChange(email);
    tok[name] = (await api(null, 'POST', '/auth/login', { email, password: 'password123' })).body.token;
  }
  const staff = ['cnxStaff', 'pktStaff', 'cnxMgr', 'cnx2', 'pkt2', 'cnx3'];
  const roles = [...staff.map((k) => ['branch', k]), ['approver', 'manager'], ['approver', 'mgr2'], ['shipper', 'shipper'], ['admin', 'admin']].slice(0, USERS);

  const end = Date.now() + DURATION;
  const counters = { created: 0, approved: 0, shipped: 0, received: 0 };

  const loops = {
    async branch(k) {
      await timed('หน้าแรก: ดูสต๊อก', tok[k], 'GET', '/inventory/stock');
      await timed('ดูสินค้า', tok[k], 'GET', '/products');
      const list = (await timed('ดูใบขอเบิก', tok[k], 'GET', '/requisitions')).body || [];
      const toReceive = list.find((r) => r.status === 'shipped');
      if (toReceive) {
        const d = (await timed('เปิดรายละเอียด', tok[k], 'GET', `/requisitions/${toReceive.id}`)).body;
        const r = await timed('ตรวจรับ', tok[k], 'PUT', `/requisitions/${toReceive.id}/receive`, {
          items: d.items.map((i) => ({ item_id: i.id, received_qty: i.shipped_qty || 0, defective_qty: 0 })) });
        if (r.status === 200) counters.received++;
      } else {
        const r = await timed('สร้างใบขอเบิก', tok[k], 'POST', '/requisitions', { note: 'load', items: [
          { product_id: pick([P.WATER, P.PEN, P.SNACK]), requested_qty: 1 + Math.floor(Math.random() * 5) }] });
        if (r.status === 201) counters.created++;
      }
    },
    async approver(k) {
      const list = (await timed('ดูใบขอเบิก', tok[k], 'GET', '/requisitions?status=pending')).body || [];
      const one = pick(list);
      if (one) {
        const d = (await timed('เปิดรายละเอียด', tok[k], 'GET', `/requisitions/${one.id}`)).body;
        if (d?.items) {
          const r = await timed('อนุมัติ', tok[k], 'PUT', `/requisitions/${one.id}/approve`, {
            items: d.items.map((i) => ({ item_id: i.id, approved_qty: Math.min(i.requested_qty, i.warehouse_available) })) });
          if (r.status === 200) counters.approved++;
        }
      }
      await timed('รายงานภาพรวม', tok[k], 'GET', '/reports/summary');
    },
    async shipper(k) {
      const list = (await timed('ดูใบขอเบิก', tok[k], 'GET', '/requisitions?status=approved')).body || [];
      const one = pick(list);
      if (one) {
        const r = await timed('จัดส่ง', tok[k], 'PUT', `/requisitions/${one.id}/ship`, {});
        if (r.status === 200) counters.shipped++;
      } else await sleep(100);
    },
    async admin(k) {
      await timed('หน้าแรก: ดูสต๊อก', tok[k], 'GET', '/inventory/stock');
      await timed(`รายงาน`, tok[k], 'GET', `/reports/${pick(['summary', 'movement', 'reorder', 'requisitions', 'by-user', 'periodic'])}`);
    },
  };

  console.log(`เริ่มทดสอบ: ผู้ใช้ ${roles.length} คนพร้อมกัน นาน ${DURATION / 1000} วินาที...`);
  const t0 = Date.now();
  await Promise.all(roles.map(async ([role, k]) => { while (Date.now() < end) await loops[role](k); }));
  const secs = (Date.now() - t0) / 1000;

  // ตรวจความถูกต้องหลังทดสอบ
  const neg = await h.db(`SELECT COUNT(*) AS n FROM current_stock WHERE stock < 0`);
  const badAfter = await h.db(`
    SELECT COUNT(*) AS n FROM transactions t
    WHERE t.stock_after <> (SELECT SUM(IF(x.type='receive', x.quantity, -x.quantity)) FROM transactions x
                            WHERE x.product_id = t.product_id AND x.branch_id = t.branch_id AND x.id <= t.id)`);
  const ok = errors.length === 0 && Number(neg[0].n) === 0 && Number(badAfter[0].n) === 0 && pct(lat, 0.95) < 5000;

  const rows = [...byOp.entries()].sort((a, b) => b[1].n - a[1].n)
    .map(([op, s]) => `| ${op} | ${s.n} | ${pct(s.ms, 0.5).toFixed(0)} | ${pct(s.ms, 0.95).toFixed(0)} | ${Math.max(...s.ms).toFixed(0)} |`);
  const md = `# ผลทดสอบผู้ใช้งานพร้อมกัน (Load Test)

ทดสอบเมื่อ: ${new Date().toLocaleString('th-TH')}
คำสั่ง: \`npm run test:load\` (backend/tests/load/load-test.js) — ใช้ฐานข้อมูลทดสอบ ไม่แตะข้อมูลจริง

## เงื่อนไข
- ผู้ใช้พร้อมกัน **${roles.length} คน** (พนักงานสาขา ${roles.filter((r) => r[0] === 'branch').length}, ผู้อนุมัติ ${roles.filter((r) => r[0] === 'approver').length}, พนักงานจัดส่ง ${roles.filter((r) => r[0] === 'shipper').length}, admin ${roles.filter((r) => r[0] === 'admin').length}) ทำงานต่อเนื่องไม่หยุดพัก ${secs.toFixed(0)} วินาที
- สินค้า ${Object.keys(P).length} รายการ × สาขา 3 แห่ง, เครื่องเดียวกับฐานข้อมูล (XAMPP MariaDB)

## ผลรวม
| ตัวชี้วัด | ผล | เกณฑ์ (proposal) |
|---|---|---|
| จำนวนคำขอทั้งหมด | ${lat.length.toLocaleString()} (${(lat.length / secs).toFixed(1)} คำขอ/วินาที) | — |
| เวลาตอบสนองกลาง (p50) | ${pct(lat, 0.5).toFixed(0)} ms | — |
| เวลาตอบสนอง 95% (p95) | ${pct(lat, 0.95).toFixed(0)} ms | ไม่เกิน 5,000 ms |
| ช้าสุด | ${Math.max(...lat).toFixed(0)} ms | — |
| Error ฝั่งเซิร์ฟเวอร์ (5xx) | ${errors.length} | 0 |
| สต๊อกติดลบ | ${neg[0].n} แถว | 0 |
| ยอดคงเหลือ (stock_after) ไม่ตรงกับ รับ−ออก | ${badAfter[0].n} รายการ | 0 |
| งานที่ทำสำเร็จ | สร้างใบขอเบิก ${counters.created}, อนุมัติ ${counters.approved}, จัดส่ง ${counters.shipped}, ตรวจรับ ${counters.received} | — |

**สรุป: ${ok ? '✅ ผ่าน' : '❌ ไม่ผ่าน'}** — รองรับผู้ใช้พร้อมกัน ${roles.length} คน${ok ? ' ข้อมูลถูกต้องครบ และตอบสนองภายในเกณฑ์' : ''}

## แยกตามการใช้งาน (ms)
| การใช้งาน | จำนวนครั้ง | p50 | p95 | ช้าสุด |
|---|---|---|---|---|
${rows.join('\n')}
${errors.length ? `\n## Error\n${errors.slice(0, 20).map((e) => `- ${e}`).join('\n')}\n` : ''}`;
  const out = path.join(__dirname, '..', '..', '..', '..', 'docs', 'load-test-result.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  console.log(md);
  h.stopServer();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); h.stopServer(); process.exit(1); });
