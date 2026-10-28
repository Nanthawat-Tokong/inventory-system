# นำระบบขึ้นเซิร์ฟเวอร์ (Railway)

ระบบถูกเตรียมให้ขึ้นเป็น **บริการเดียว**: Railway build หน้าเว็บ แล้ว backend เสิร์ฟทั้ง API (`/api`) และหน้าเว็บจากที่อยู่เดียวกัน
ไฟล์ที่เกี่ยวข้อง: `package.json` และ `railway.json` ที่ root ของโปรเจกต์ (ทดสอบ build + start จากสำเนาสะอาดแล้ว)

## สิ่งที่ต้องมี
- บัญชี [GitHub](https://github.com) และ [Railway](https://railway.com) (ล็อกอินด้วย GitHub ได้)
- โปรเจกต์นี้อยู่ใน git แล้ว (`git log` ดูได้)

## ขั้นตอน

### 1. ส่งโค้ดขึ้น GitHub
สร้าง repository ใหม่บน GitHub (แบบ Private) แล้วในโฟลเดอร์โปรเจกต์:
```bash
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```
> `.env` และไฟล์สำรองข้อมูลถูกกันไว้ใน `.gitignore` แล้ว จะไม่ขึ้น GitHub

### 2. สร้างฐานข้อมูลบน Railway
1. Railway → **New Project** → **Deploy MySQL**
2. เปิด service MySQL → แท็บ **Variables** จด `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`
3. สร้างตาราง: แท็บ **Data** → Query แล้ววางเนื้อหา `inventory-system/backend/schema.sql`
   (แก้บรรทัด `CREATE DATABASE` / `USE inventory_db` เป็นชื่อฐานของ Railway — ปกติคือ `railway`)
   หรือจากเครื่องตัวเอง: `mysql -h <MYSQLHOST> -P <MYSQLPORT> -u root -p railway < schema.sql`

### 3. Deploy ระบบ
1. ในโปรเจกต์เดียวกัน → **New** → **GitHub Repo** → เลือก repo
2. Railway อ่าน `railway.json` เอง (build: `npm run build`, start: `npm start`, health check: `/api/health`)
3. แท็บ **Variables** ของ service นี้ ใส่:

| ตัวแปร | ค่า |
|---|---|
| `DB_HOST` | `${{MySQL.MYSQLHOST}}` |
| `DB_PORT` | `${{MySQL.MYSQLPORT}}` |
| `DB_USER` | `${{MySQL.MYSQLUSER}}` |
| `DB_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}` |
| `DB_NAME` | `${{MySQL.MYSQLDATABASE}}` |
| `JWT_SECRET` | ค่าสุ่มยาว — สร้าง: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `7d` |

> ไม่ต้องตั้ง `PORT` (Railway ตั้งให้เอง) และไม่ต้องตั้ง `CORS_ORIGIN` / `VITE_API_URL` เพราะหน้าเว็บกับ API อยู่ที่อยู่เดียวกัน

4. แท็บ **Settings** → **Networking** → **Generate Domain** → ได้ที่อยู่ เช่น `https://xxx.up.railway.app`

### 4. สร้างบัญชีตัวอย่าง
จากเครื่องตัวเอง (ชี้ไปฐานบน Railway ชั่วคราว):
```bash
cd inventory-system/backend
DB_HOST=<MYSQLHOST> DB_PORT=<MYSQLPORT> DB_USER=root DB_PASSWORD=<...> DB_NAME=railway npm run seed
```
แล้วเข้าระบบด้วย `admin@inventory.com` / `password123` → ระบบบังคับตั้งรหัสใหม่ทันที (บัญชีตัวอย่างทุกบัญชีเป็นแบบนี้) — ลบหรือเปลี่ยนบทบาทบัญชีตัวอย่างที่ไม่ใช้ก่อนเปิดให้คนอื่นใช้

### 5. ตรวจว่าใช้งานได้
- `https://<domain>/api/health` → `{"status":"ok"}`
- เปิด `https://<domain>` → หน้าเข้าสู่ระบบ

## อัปเดตระบบครั้งถัดไป
แก้โค้ด → `git commit` → `git push` → Railway build/deploy ใหม่อัตโนมัติ
ถ้าเปลี่ยนโครงสร้างฐานข้อมูล: รันไฟล์ `migration_*.sql` ใหม่กับฐานบน Railway ก่อน push

## ทางเลือก: หน้าเว็บกับ backend แยกที่อยู่
- build หน้าเว็บด้วย `VITE_API_URL=https://<backend>/api npm run build` แล้วนำ `frontend/dist` ไปวางที่ไหนก็ได้
- ที่ backend ตั้ง `CORS_ORIGIN=https://<ที่อยู่หน้าเว็บ>`

## ค่าใช้จ่าย
Railway มีเครดิตทดลองฟรี (ตรงกับงบประมาณใน proposal 8.2) — ตรวจโควตาปัจจุบันที่หน้า Pricing ของ Railway
