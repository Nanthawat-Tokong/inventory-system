# API Reference

Base URL: `http://localhost:5000/api` (ตอนใช้จริงที่ backend เสิร์ฟหน้าเว็บเอง: `/api`)

ทุก endpoint ยกเว้น `POST /auth/login` ต้องส่ง header `Authorization: Bearer <token>`

**บทบาท:** `admin` ผู้ดูแลระบบ · `main_manager` ผู้จัดการ (ถ้าสังกัดคลังหลัก = **ผู้อนุมัติ**) · `staff` พนักงานสาขา · `shipper` พนักงานจัดส่ง (ต้องสังกัดคลังหลัก)

**รูปแบบ error:** `{ "message": "ข้อความภาษาไทย" }` — 400 ข้อมูลไม่ถูกต้อง/สถานะไม่อนุญาต · 401 ยังไม่ล็อกอิน/token หมดอายุ · 403 ไม่มีสิทธิ์ (หรือ `code: "MUST_CHANGE_PASSWORD"` = ต้องเปลี่ยนรหัสก่อน) · 404 ไม่พบ · 500 ระบบขัดข้อง

> สิทธิ์ตามตารางนี้ตรวจที่ route ส่วนเงื่อนไขละเอียด (เช่น "เฉพาะสาขาเจ้าของใบ", "เห็นเฉพาะสาขาตัวเอง") ตรวจต่อใน controller

## Auth `/api/auth`
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| POST | `/login` | ทุกคน | `{ email, password }` → `{ token, user }` (`user.must_change_password` = 1 ต้องเปลี่ยนรหัสก่อน) |
| GET | `/me` | ล็อกอินแล้ว | ข้อมูลผู้ใช้ล่าสุด (บทบาท/สาขา/คลังหลัก) |
| PUT | `/password` | ล็อกอินแล้ว | `{ current_password, new_password }` เปลี่ยนรหัสตัวเอง (≥ 8 ตัว, ห้ามซ้ำเดิม) |

## Products `/api/products`
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/` | ทุกบทบาท | admin/ผู้จัดการเห็นทั้งหมด, อื่นๆ เห็นเฉพาะที่เปิดใช้ในสาขา · แนบ `stock` (สาขาตัวเอง), `warehouse_stock`, `total_stock` (admin/ผู้จัดการ), `threshold` (เกณฑ์ที่ใช้จริง) |
| GET | `/:id` | ทุกบทบาท | สินค้า 1 รายการ |
| POST | `/` | admin, main_manager | `{ name, sku, category, unit, low_stock_threshold }` — เปิดใช้ให้ทุกสาขาอัตโนมัติ |
| PUT | `/:id` | admin, main_manager | แก้ไข (SKU ซ้ำ → 400) |
| DELETE | `/:id` | admin, main_manager | ลบแบบซ่อน (ประวัติยังอยู่) |

## Inventory `/api/inventory`
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| POST | `/receive` | admin, main_manager | `{ product_id, branch_id, quantity, note }` รับเข้า **เฉพาะคลังหลัก** (สาขาย่อยรับผ่านใบขอเบิก) |
| POST | `/issue` | admin, main_manager, staff | ออกสินค้า (staff = สาขาตัวเองเท่านั้น), สต๊อกไม่พอ → 400 |
| GET | `/stock` | ทุกบทบาท | สต๊อกทุกสินค้า × สาขา (admin ทุกสาขา, อื่นๆ สาขาตัวเอง) พร้อม `low_stock_threshold`, `threshold_source` (`branch`/`product`) |
| GET | `/stock/:branchId` | ทุกบทบาท | สต๊อกสาขาเดียว (ไม่ใช่ admin = สาขาตัวเองเท่านั้น) |
| GET | `/history` | ทุกบทบาท | ประวัติ `?branch_id&product_id&type&limit(1–500)&offset` |

จำนวนต้องเป็นจำนวนเต็มบวก, ทุกการตัด/เพิ่มสต๊อกล็อกสินค้าไว้ระหว่างทำรายการ (ทำพร้อมกันไม่ทำให้ยอดเพี้ยน)

## Branches `/api/branches`
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/` | ทุกบทบาท | admin ทุกสาขา, อื่นๆ สาขาตัวเอง |
| POST | `/` | admin | `{ name, location, is_warehouse }` — เปิดใช้สินค้าทุกตัวให้สาขาใหม่ · ติ๊กคลังหลัก = ย้ายคลังหลัก |
| PUT | `/:id` | admin | แก้ไข (ห้ามเอาสถานะคลังหลักออกจากคลังเดียวที่มี) |
| DELETE | `/:id` | admin | ซ่อนสาขา — ห้ามลบคลังหลัก / สาขาที่ยังมีผู้ใช้ / มีใบขอเบิกค้าง |

## Branch products `/api/branch-products` (สินค้าที่เปิดให้แต่ละสาขา)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/meta/branches` | admin, main_manager | รายชื่อสาขาทั้งหมด |
| GET | `/:branchId` | admin, main_manager | สินค้าทั้งหมด + `is_active` ของสาขานี้ |
| PUT | `/:branchId` | admin, main_manager | `{ product_ids: [] }` สินค้าที่เปิดใช้ (ที่เหลือปิด) |

## Alerts `/api/alerts` (เกณฑ์แจ้งเตือนเฉพาะสาขา)
| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/` | ทุกบทบาท | สินค้าที่ต่ำกว่าเกณฑ์ (เกณฑ์เฉพาะสาขา ถ้าตั้ง / ไม่งั้นค่ากลาง) |
| GET | `/settings` | admin, main_manager | กฎที่ตั้งไว้ |
| POST | `/` | admin, main_manager | `{ product_id, branch_id (admin), min_quantity }` ตั้งซ้ำ = อัปเดต |
| PUT | `/:id` | admin, main_manager | `{ min_quantity, is_active }` |
| DELETE | `/:id` | admin, main_manager | ลบกฎ (กลับไปใช้ค่ากลาง) |

## Requisitions `/api/requisitions` (ใบขอเบิก)
สถานะ: `pending` รออนุมัติ → `approved` รอจัดส่ง → `shipped` รอตรวจรับ → `completed` / `disputed` มีปัญหา · `rejected` ถูกปฏิเสธ
สถานะย่อยเมื่อมีปัญหา (`dispute_state`): `awaiting_response`, `reshipping`, `awaiting_stock`, `close_proposed`

| Method | Path | สิทธิ์ | คำอธิบาย |
|---|---|---|---|
| GET | `/meta/warehouse-stock` | ทุกบทบาท | ของที่คลังหลัก "เบิกได้" (คงเหลือ − ที่อนุมัติแล้วยังไม่ส่ง) |
| GET | `/meta/action-count` | ทุกบทบาท | จำนวนใบที่รอผู้ใช้คนนี้ |
| GET | `/` | ทุกบทบาท | รายการ (สาขาเห็นของตัวเอง) `?status=` · แต่ละใบมี `needs_action` |
| GET | `/:id` | ทุกบทบาท | รายละเอียด + `warehouse_available` ต่อรายการ + ของชดเชย + ของชำรุด + ไทม์ไลน์ |
| POST | `/` | staff, main_manager (สาขาย่อย) | `{ note, items: [{ product_id, requested_qty }] }` — ขอได้ไม่เกินที่คลังมีให้เบิก |
| PUT | `/:id` | สาขาเจ้าของ, admin | แก้ใบที่ถูกปฏิเสธแล้วส่งใหม่ |
| DELETE | `/:id` | สาขาเจ้าของ, admin | ยกเลิก (เฉพาะ pending/rejected) |
| PUT | `/:id/approve` | ผู้อนุมัติ | `{ items: [{ item_id, approved_qty }] }` ไม่เกินที่เบิกได้ (= จองของ) |
| PUT | `/:id/reject` | ผู้อนุมัติ | `{ reason }` |
| PUT | `/:id/cancel-approval` | ผู้อนุมัติ | `{ reason }` ยกเลิกใบที่อนุมัติแล้วแต่ยังไม่ส่ง (ปล่อยของที่จอง) |
| PUT | `/:id/ship` | **shipper เท่านั้น** | จัดส่ง — ตัดสต๊อกคลังหลัก |
| PUT | `/:id/receive` | สาขาเจ้าของ | `{ items: [{ item_id, received_qty, defective_qty }], issue_note }` ของดีเข้าสต๊อก, ชำรุด/ขาด → `disputed` |
| POST | `/:id/messages` | ผู้เกี่ยวข้อง | `{ message }` ข้อความในไทม์ไลน์ |
| PUT | `/:id/respond` | ผู้อนุมัติ | `{ state: reshipping \| awaiting_stock, message }` ตอบกลับเคส |
| PUT | `/:id/propose-close` | ผู้อนุมัติ | `{ message }` ขอปิดเคส (ต้องตอบกลับแล้ว, ไม่มีของชดเชยค้าง, จัดการของชำรุดครบ) |
| PUT | `/:id/accept-close` | สาขาเจ้าของ | ยืนยันปิดเคส |
| PUT | `/:id/decline-close` | สาขาเจ้าของ | `{ message }` ไม่ยอมรับการปิด |
| POST | `/:id/replacements` | ผู้อนุมัติ | `{ items: [{ requisition_item_id, replacement_qty }], note }` เตรียมของชดเชย |
| PUT | `/:id/replacements/:rid/ship` | **shipper เท่านั้น** | ส่งของชดเชย (ตัดสต๊อก) |
| PUT | `/:id/replacements/:rid/receive` | สาขาเจ้าของ | `{ items: [{ replacement_item_id, received_qty, defective_qty }] }` รับครบ → ปิดเคสอัตโนมัติ |
| POST | `/:id/defects` | ผู้อนุมัติ | `{ items: [{ requisition_item_id, qty, action: write_off \| return }], note }` ของชำรุดไปไหน |
| PUT | `/:id/defects/:did/received` | ผู้อนุมัติ, shipper | ยืนยันได้รับของชำรุดคืนที่คลังหลัก |

## Reports `/api/reports` (ทุกบทบาท — สาขาเห็นเฉพาะสาขาตัวเอง)
Query ร่วม: `from`, `to` (YYYY-MM-DD, ค่าเริ่มต้น 30 วันล่าสุด), `branch_id` (ฝั่งคลังหลักเลือกได้)

| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/periodic?group=day\|week\|month` | สรุปรับเข้า/ออก **รายวัน / รายสัปดาห์ / รายเดือน** + รายละเอียดต่อสินค้าในแต่ละช่วง |
| GET | `/daily`, `/weekly`, `/monthly` | ทางลัด: วันนี้ / สัปดาห์นี้ / เดือนนี้ |
| GET | `/summary` | ยอดรวม, รายวัน, สถานะสต๊อก, จำนวนใบขอเบิก |
| GET | `/movement` | ยกมา → รับ → ออก → คงเหลือ ต่อสินค้า×สาขา + อัตราหมุนเวียน |
| GET | `/top` | 20 อันดับออกมาก + สินค้าค้างสต๊อก |
| GET | `/reorder` | ควรสั่งเพิ่ม (ใช้/วัน, พอใช้อีกกี่วัน, แนะนำจำนวน) |
| GET | `/requisitions` | ประสิทธิภาพใบขอเบิกรายสาขา, ของชำรุด, ของที่ส่งไม่ครบ |
| GET | `/by-user` | การเบิกรายคน (staff = ของตัวเอง) `?user_id` |

## Users `/api/users` (admin เท่านั้น)
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/` | รายชื่อผู้ใช้ |
| POST | `/` | `{ name, email, password(≥8), role, branch_id }` — ผู้ใช้ต้องเปลี่ยนรหัสตอนเข้าครั้งแรก |
| PUT | `/:id` | แก้ไข (ใส่ password = รีเซ็ตรหัส) — ห้ามเปลี่ยน admin คนสุดท้าย |
| DELETE | `/:id` | ห้ามลบตัวเอง / admin คนสุดท้าย / คนที่เคยทำรายการ |

## อื่นๆ
| Method | Path | คำอธิบาย |
|---|---|---|
| GET | `/api/health` | ตรวจว่า server ทำงาน `{ status: "ok" }` |
