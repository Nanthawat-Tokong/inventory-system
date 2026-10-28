// ============================================================
// server.js — จุดเริ่มต้นของ backend server ทั้งหมด
// ไฟล์นี้ตั้งค่า Express app, เชื่อม middleware ต่างๆ
// และกำหนดว่า URL path ไหนจะใช้ route file ไหน
// เมื่อรัน "node server.js" หรือ "nodemon" server จะเริ่มฟังที่ port 5000
// ============================================================

// โหลดค่าจากไฟล์ .env (environment variables) เช่น DB_HOST, JWT_SECRET, PORT
// ต้องเรียก dotenv ก่อนทุกอย่างเพื่อให้ process.env.XXX มีค่าใช้ได้
require('dotenv').config();

// Express คือ framework สำหรับสร้าง web server ด้วย Node.js
// ช่วยจัดการ HTTP request/response และ routing ได้ง่ายขึ้น
const express = require('express');

// cors คือ middleware ที่อนุญาตให้ browser ของ frontend (localhost:5173)
// เรียก API จาก backend (localhost:5000) ได้
// โดยค่าเริ่มต้น browser จะบล็อก request ข้าม domain (Cross-Origin) เพื่อความปลอดภัย
const cors = require('cors');

// สร้าง Express application instance
const app = express();

// เปิดใช้ CORS สำหรับทุก request (อนุญาตให้ frontend เรียกได้)
// CORS: ตอนพัฒนาอนุญาตทุกที่ / ตอนใช้จริงตั้ง CORS_ORIGIN เป็นที่อยู่หน้าเว็บ (คั่นหลายที่ด้วย ,)
// ถ้า backend เสิร์ฟหน้าเว็บเอง (ที่อยู่เดียวกัน) ไม่ต้องตั้ง
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(',').map((s) => s.trim()) } : undefined));

// บอก Express ให้แปลง request body ที่เป็น JSON อัตโนมัติ
// ทำให้ controller เข้าถึง req.body.name, req.body.email ฯลฯ ได้
app.use(express.json());

// ─── ลงทะเบียน route files ───────────────────────────────────
// แต่ละบรรทัดบอกว่า: URL ที่ขึ้นต้นด้วย path นี้ ให้ส่งไปจัดการที่ route file นั้น

// /api/auth/... → authRoutes.js (login, ตรวจ token)
app.use('/api/auth',      require('./routes/authRoutes'));

// /api/products/... → productRoutes.js (CRUD สินค้า)
app.use('/api/products',  require('./routes/productRoutes'));

// /api/inventory/... → inventoryRoutes.js (รับ/ออกสินค้า, ดูสต๊อก, ประวัติ)
app.use('/api/inventory', require('./routes/inventoryRoutes'));

// /api/branches/... → branchRoutes.js (CRUD สาขา)
app.use('/api/branches',  require('./routes/branchRoutes'));

// /api/reports/... → reportRoutes.js (รายงาน daily/weekly/monthly)
app.use('/api/reports',   require('./routes/reportRoutes'));

// /api/alerts/... → alertRoutes.js (กฎแจ้งเตือนสต๊อกต่ำ)
app.use('/api/alerts',    require('./routes/alertRoutes'));

// /api/requisitions/... → requisitionRoutes.js (workflow ใบขอเบิกสินค้า)
app.use('/api/requisitions', require('./routes/requisitionRoutes'));

// /api/branch-products/... → branchProductRoutes.js (mapping สินค้า ↔ สาขา)
app.use('/api/branch-products', require('./routes/branchProductRoutes'));

// /api/users/... → userRoutes.js (CRUD ผู้ใช้งาน)
app.use('/api/users',     require('./routes/userRoutes'));

// ─── Health check endpoint ───────────────────────────────────
// GET /api/health — ใช้ตรวจสอบว่า server ทำงานอยู่หรือไม่
// ตอบกลับ { status: 'ok' } ถ้า server ปกติ
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ─── เสิร์ฟหน้าเว็บ (ตอนใช้จริง) ──────────────────────────────────
// ถ้ามีโฟลเดอร์ frontend/dist (ได้จาก npm run build) ให้ backend เสิร์ฟหน้าเว็บด้วย
// → ขึ้นเซิร์ฟเวอร์ (เช่น Railway) เป็นบริการเดียว ที่อยู่เดียว ไม่ต้องตั้ง CORS
const path = require('path');
const fs = require('fs');
const DIST = process.env.FRONTEND_DIST || path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(path.join(DIST, 'index.html'))) {
  app.use(express.static(DIST));
  // เส้นทางของหน้าเว็บ (เช่น /dashboard) ส่ง index.html ให้ React จัดการต่อ — ยกเว้น /api
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
  console.log(`Serving frontend from ${DIST}`);
}
// /api ที่ไม่มีอยู่ → ตอบ JSON (ไม่ใช่หน้า HTML)
app.use('/api', (req, res) => res.status(404).json({ message: 'ไม่พบ API นี้' }));

// ─── เริ่มฟัง request ────────────────────────────────────────
// อ่าน PORT จาก .env ถ้าไม่มีให้ใช้ 5000 เป็น default
const PORT = process.env.PORT || 5000;

// เริ่มให้ server รับ request ที่ PORT ที่กำหนด
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
