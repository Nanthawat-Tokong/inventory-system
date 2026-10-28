// ============================================================
// scripts/smoke.cjs — ทดสอบหน้าเว็บจริงด้วย Chrome แบบไม่มีหน้าต่าง (headless)
// ล็อกอินทีละบทบาท แล้วเปิดทุกหน้าที่บทบาทนั้นเข้าได้ ตรวจว่า:
//   - ไม่มี JavaScript error (หน้าขาว)
//   - หน้าแสดงเนื้อหาจริง (ไม่ว่างเปล่า)
// ต้องเปิด frontend (npm run dev) และ backend ไว้ก่อน
// รัน: npm run smoke            (ค่าเริ่มต้น http://localhost:5173)
//      npm run smoke -- <url>
// ============================================================

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = process.argv[2] || 'http://localhost:5173';
const PASSWORD = 'password123';
const ROLES = {
  'admin@inventory.com': ['/dashboard', '/products', '/inventory', '/reports', '/reports?tab=movement', '/reports?tab=top',
    '/reports?tab=reorder', '/reports?tab=requisitions', '/requisitions', '/alerts', '/branch-products', '/users', '/branches', '/help'],
  'manager@inventory.com': ['/dashboard', '/requisitions', '/reports', '/alerts', '/branch-products'],
  'shipper@inventory.com': ['/dashboard', '/requisitions', '/inventory', '/reports'],
  'rayong@inventory.com': ['/dashboard', '/products', '/inventory', '/requisitions', '/requisitions?new=1', '/reports', '/help'],
};
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!CHROME) throw new Error('ไม่พบ Chrome/Edge');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9334', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40 && !targets; i++) { try { targets = await (await fetch('http://127.0.0.1:9334/json')).json(); } catch { await sleep(250); } }
  const ws = new WebSocket(targets.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); let errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description?.split('\n')[0]);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value;
  await send('Runtime.enable');

  let failed = 0;
  for (const [email, pages] of Object.entries(ROLES)) {
    console.log(`\n${email}`);
    await send('Page.navigate', { url: `${APP}/` }); await sleep(1500);
    await evalJs('localStorage.clear()');
    const login = await (await fetch(`${await evalJs('location.origin')}/`)).ok; // dev server ขึ้นอยู่
    if (!login) throw new Error('frontend ไม่ตอบ');
    await evalJs(`(() => {
      const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
      const i = document.querySelectorAll('input'); set(i[0], ${JSON.stringify(email)}); set(i[1], ${JSON.stringify(PASSWORD)});
      document.querySelector('button[type=submit], form button').click();
    })()`);
    await sleep(2500);
    for (const p of pages) {
      errors = [];
      await send('Page.navigate', { url: APP + p }); await sleep(2500);
      // หน้าใบขอเบิก: ลองเปิดรายละเอียดใบแรกด้วย
      if (p === '/requisitions') {
        await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('ดูรายละเอียด'))?.click()`);
        await sleep(1500);
      }
      const len = await evalJs(`document.getElementById('root')?.innerText.length || 0`);
      const ok = errors.length === 0 && len > 50;
      if (!ok) failed++;
      console.log(`  ${ok ? '✓' : '✗'} ${p.padEnd(28)} ${ok ? '' : `เนื้อหา ${len} ตัวอักษร ${errors.join(' | ')}`}`);
    }
    await evalJs(`[...document.querySelectorAll('button')].find(b => b.innerText.includes('ออกจากระบบ'))?.click()`);
  }
  console.log(failed ? `\nไม่ผ่าน ${failed} หน้า` : '\nผ่านทุกหน้า');
  ws.close(); chrome.kill();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
