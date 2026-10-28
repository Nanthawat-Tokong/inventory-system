/**
 * สำรองฐานข้อมูลทั้งหมดเป็นไฟล์ .sql
 * - ไฟล์อยู่ที่ backend/backups/inventory_db_YYYY-MM-DD_HHMM.sql
 * - เก็บไว้ 30 ไฟล์ล่าสุด ที่เก่ากว่านั้นลบอัตโนมัติ (กันดิสก์เต็ม)
 * - Windows Task Scheduler เรียกทุกวันผ่าน scripts/backup-db.cmd
 *
 * รันเอง:   npm run backup
 * กู้คืน:   mysql -u root -p inventory_db < backups\inventory_db_....sql
 *           (XAMPP: C:\xampp\mysql\bin\mysql.exe)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const KEEP = 30;
const DIR = path.join(__dirname, '..', 'backups');
const DB = process.env.DB_NAME || 'inventory_db';
const DUMP = [process.env.MYSQLDUMP, 'C:/xampp/mysql/bin/mysqldump.exe', 'mysqldump']
  .find((p) => p && (p === 'mysqldump' || fs.existsSync(p)));

const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
fs.mkdirSync(DIR, { recursive: true });
const file = path.join(DIR, `${DB}_${stamp}.sql`);

const out = fs.createWriteStream(file);
const child = spawn(DUMP, [
  '-h', process.env.DB_HOST || 'localhost',
  '-P', String(process.env.DB_PORT || 3306),
  '-u', process.env.DB_USER || 'root',
  '--single-transaction',   // สำรองได้ขณะระบบเปิดใช้งาน ข้อมูลไม่ขาดครึ่งๆ กลางๆ
  '--routines', '--triggers',
  '--default-character-set=utf8mb4',
  '--databases', DB,        // ใส่ CREATE DATABASE/USE ไว้ในไฟล์ กู้คืนง่าย
], { env: { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD || '' } }); // ส่งรหัสผ่านทาง env ไม่ให้โผล่ใน command line

child.stdout.pipe(out);
let err = '';
child.stderr.on('data', (c) => { err += c; });
child.on('close', (code) => {
  out.end(() => {
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (code !== 0 || size < 1000) {
      console.error(`[${new Date().toISOString()}] สำรองไม่สำเร็จ (code ${code}): ${err.trim()}`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      process.exit(1);
    }
    // ลบไฟล์เก่าเกิน KEEP ไฟล์
    const old = fs.readdirSync(DIR).filter((f) => f.startsWith(`${DB}_`) && f.endsWith('.sql')).sort().reverse().slice(KEEP);
    old.forEach((f) => fs.unlinkSync(path.join(DIR, f)));
    console.log(`[${new Date().toISOString()}] สำรองแล้ว: ${path.basename(file)} (${(size / 1024 / 1024).toFixed(1)} MB)${old.length ? `, ลบไฟล์เก่า ${old.length} ไฟล์` : ''}`);
  });
});
