# ระบบจัดการสินค้าคงคลังแบบเซ็นทรัลไลซ์ (Centralized Inventory Management System)

ระบบจัดการสินค้าคงคลังสำหรับธุรกิจหลายสาขา — ข้อมูลทุกสาขาอยู่ในฐานข้อมูลเดียว สาขาขอเบิกของจากคลังหลักผ่านใบขอเบิก
(สร้าง → อนุมัติ → จัดส่ง → ตรวจรับ) ดูยอดคงเหลือแบบเรียลไทม์ แจ้งเตือนสินค้าใกล้หมด และออกรายงานรายวัน/รายสัปดาห์/รายเดือน

โครงงานปีการศึกษา 2569 — นันทวัฒน์ โตกอง (66160134) · อาจารย์ที่ปรึกษา: อาจารย์วิทวัส พันธุมจินดา

## ความสามารถหลัก

| ขอบเขตงาน (proposal 3.1) | สิ่งที่ระบบทำได้ |
|---|---|
| ระบบจัดการสินค้าคงคลังหลัก | สินค้า/SKU, รับเข้า (คลังหลัก), ออกสินค้า, ใบขอเบิกระหว่างสาขา (สร้าง–อนุมัติ–จัดส่ง–ตรวจรับ แยกของดี/ชำรุด), ยอดคงเหลือเรียลไทม์, ประวัติความเคลื่อนไหว, จัดการเคสของชำรุด/ส่งไม่ครบ |
| แดชบอร์ด | งานที่รอแต่ละคน, สรุปสต๊อก หมด/ใกล้หมด/ปกติ, กราฟสต๊อกรวมแยกสาขา, รีเฟรชอัตโนมัติทุก 30 วินาที |
| เข้าสู่ระบบ + สิทธิ์ตามบทบาท (RBAC) | JWT, 4 บทบาท (admin / ผู้จัดการ / พนักงานสาขา / พนักงานจัดส่ง), เปลี่ยนรหัสผ่านเอง, บังคับเปลี่ยนรหัสที่ admin ตั้งให้ |
| รายงาน รายวัน/รายสัปดาห์/รายเดือน | รายงาน 7 แบบ (ภาพรวม, รายวัน/สัปดาห์/เดือน, ความเคลื่อนไหว, ออกมาก/ค้างสต๊อก, ควรสั่งเพิ่ม, ใบขอเบิก, การเบิกรายคน) ส่งออก Excel ได้ |
| แจ้งเตือนสต๊อกต่ำ ตั้งค่าได้ต่อสินค้าและต่อสาขา | ค่ากลางต่อสินค้า + ตั้งค่าเฉพาะสาขาได้ (มีผลทุกหน้า) |

## เทคโนโลยี
React 19 + Vite + Tailwind CSS · Node.js + Express · MariaDB/MySQL (XAMPP) · JWT · Jest · Git

## โครงสร้างโปรเจกต์
```
inventory-system/
├── backend/               Express API
│   ├── src/
│   │   ├── controllers/   logic ของแต่ละส่วน (requisitionController = ขั้นตอนใบขอเบิก)
│   │   ├── routes/        เส้นทาง API + สิทธิ์ของแต่ละบทบาท
│   │   ├── middleware/    ตรวจ token / บทบาท
│   │   ├── utils/         permissions.js (สิทธิ์), stock.js (ล็อก/คำนวณสต๊อก)
│   │   └── server.js
│   ├── tests/             ชุดทดสอบ Jest (134 ข้อ) + load test
│   ├── scripts/           สำรองฐานข้อมูล
│   ├── schema.sql         โครงสร้างฐานข้อมูลทั้งหมด + ข้อมูลตัวอย่าง
│   └── migration_*.sql    ไฟล์อัปเดตฐานข้อมูลเดิม (เรียงตามวันที่สร้าง)
├── frontend/              React
│   └── src/pages/         หน้าต่างๆ  (scripts/smoke.cjs = ทดสอบหน้าเว็บอัตโนมัติ)
docs/                      เอกสารออกแบบ / API / คู่มือ / ผลทดสอบ
```

## ติดตั้งและรัน (เครื่องพัฒนา)

**ต้องมี:** Node.js 18 ขึ้นไป, XAMPP (MariaDB/MySQL)

```bash
# 1) เปิด MySQL ใน XAMPP Control Panel

# 2) สร้างฐานข้อมูล + ข้อมูลตัวอย่าง
cd inventory-system/backend
C:\xampp\mysql\bin\mysql.exe -u root -p < schema.sql
copy .env.example .env          # แล้วแก้ DB_PASSWORD และ JWT_SECRET (สุ่มยาวๆ)
npm install
npm run seed                    # บัญชีตัวอย่าง รหัส password123 (เข้าครั้งแรกระบบให้ตั้งรหัสใหม่)

# 3) รัน backend (port 5000)
npm start

# 4) รันหน้าเว็บ (อีกหน้าต่างหนึ่ง) แล้วเปิด http://localhost:5173
cd inventory-system/frontend
npm install
npm run dev
```

**บัญชีตัวอย่าง** (รหัส `password123` — เข้าครั้งแรกระบบจะให้ตั้งรหัสใหม่)

| อีเมล | บทบาท |
|---|---|
| admin@inventory.com | ผู้ดูแลระบบ |
| manager@inventory.com | ผู้จัดการคลังหลัก (อนุมัติใบขอเบิก) |
| shipper@inventory.com | พนักงานจัดส่ง |
| cnx@inventory.com | พนักงานสาขาเชียงใหม่ (ลองขอเบิก) |
| staff@inventory.com | พนักงานสาขาหลัก |

> ฐานข้อมูลที่ใช้อยู่แล้ว (สร้างก่อนหน้า) ให้รันไฟล์ `migration_*.sql` ที่ยังไม่เคยรันแทนการรัน `schema.sql`

## ทดสอบ
```bash
cd inventory-system/backend
npm test             # Jest 134 ข้อ — ใช้ฐานข้อมูลแยก inventory_db_test ไม่แตะข้อมูลจริง
npm run test:load    # ผู้ใช้พร้อมกัน 10 คน 60 วินาที → docs/load-test-result.md

cd inventory-system/frontend
npm run smoke        # เปิดทุกหน้าด้วย Chrome ทุกบทบาท (ต้องรัน backend + npm run dev ก่อน)
```
รายละเอียด: [docs/testing.md](docs/testing.md) · Postman: [docs/postman_collection.json](docs/postman_collection.json)

## สำรองข้อมูล
```bash
cd inventory-system/backend
npm run backup       # → backend/backups/inventory_db_YYYY-MM-DD_HHMM.sql (เก็บ 30 ไฟล์ล่าสุด)
```
ตั้งให้สำรองอัตโนมัติทุกวัน 21:00 (Windows, รันครั้งเดียว):
```powershell
schtasks /Create /TN "InventoryDB Backup" /SC DAILY /ST 21:00 /F /TR "\"<path>\inventory-system\backend\scripts\backup-db.cmd\""
```
กู้คืน: `C:\xampp\mysql\bin\mysql.exe -u root -p < backups\inventory_db_....sql`

## เอกสาร
| เอกสาร | เนื้อหา |
|---|---|
| [docs/design.md](docs/design.md) | สถาปัตยกรรม, บทบาทและสิทธิ์, ขั้นตอนใบขอเบิก (state diagram), การคำนวณสต๊อก |
| [docs/database.md](docs/database.md) | ER diagram และคำอธิบายทุกตาราง |
| [docs/api.md](docs/api.md) | API ทั้งหมด พร้อมสิทธิ์ของแต่ละบทบาท |
| [docs/user-manual.md](docs/user-manual.md) | คู่มือการใช้งานแยกตามบทบาท |
| [docs/testing.md](docs/testing.md) | การทดสอบ และผลทดสอบ |
| [docs/uat-questionnaire.md](docs/uat-questionnaire.md) | แบบสอบถามความพึงพอใจผู้ใช้ (UAT) |
| [docs/deploy-railway.md](docs/deploy-railway.md) | วิธีนำขึ้นเซิร์ฟเวอร์ Railway |
"# inventory-system" 
