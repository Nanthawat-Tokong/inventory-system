# Centralized Inventory Management System
## Prompt สำหรับ Claude Code

---

## Tech Stack
- **Frontend**: React + Tailwind CSS
- **Backend**: Node.js + Express
- **Database**: MySQL
- **Auth**: JWT
- **Deploy**: Railway

---

## โครงสร้างโปรเจกต์ที่ต้องการ

```
inventory-system/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   ├── productController.js
│   │   │   ├── inventoryController.js
│   │   │   ├── branchController.js
│   │   │   ├── reportController.js
│   │   │   └── alertController.js
│   │   ├── middleware/
│   │   │   ├── authMiddleware.js     (JWT verify)
│   │   │   └── roleMiddleware.js     (Admin/Manager/Staff)
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── productRoutes.js
│   │   │   ├── inventoryRoutes.js
│   │   │   ├── branchRoutes.js
│   │   │   ├── reportRoutes.js
│   │   │   └── alertRoutes.js
│   │   ├── config/
│   │   │   └── db.js                (MySQL connection)
│   │   └── server.js
│   ├── .env.example
│   └── package.json
│
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── LoginPage.jsx
    │   │   ├── DashboardPage.jsx
    │   │   ├── ProductsPage.jsx
    │   │   ├── InventoryPage.jsx
    │   │   ├── ReportPage.jsx
    │   │   └── UsersPage.jsx
    │   ├── components/
    │   │   ├── Navbar.jsx
    │   │   ├── Sidebar.jsx
    │   │   ├── StockCard.jsx
    │   │   ├── AlertBadge.jsx
    │   │   └── ProtectedRoute.jsx
    │   ├── services/
    │   │   └── api.js               (axios instance)
    │   └── App.jsx
    └── package.json
```

---

## Database Schema (MySQL)

```sql
-- 1. branches (สาขา)
CREATE TABLE branches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  location VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. users (ผู้ใช้งาน)
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin', 'manager', 'staff') DEFAULT 'staff',
  branch_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (branch_id) REFERENCES branches(id)
);

-- 3. products (สินค้า)
CREATE TABLE products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  sku VARCHAR(50) UNIQUE NOT NULL,
  category VARCHAR(100),
  unit VARCHAR(50) DEFAULT 'ชิ้น',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. transactions (ประวัติรับ/ออกสินค้า)
CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  branch_id INT NOT NULL,
  user_id INT NOT NULL,
  type ENUM('receive', 'issue') NOT NULL,
  quantity INT NOT NULL,
  stock_after INT NOT NULL,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 5. alerts (การแจ้งเตือน)
CREATE TABLE alerts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  branch_id INT NOT NULL,
  min_quantity INT NOT NULL DEFAULT 10,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (branch_id) REFERENCES branches(id)
);

-- View: stock ปัจจุบันแต่ละสาขา
CREATE VIEW current_stock AS
SELECT
  product_id,
  branch_id,
  SUM(CASE WHEN type = 'receive' THEN quantity ELSE -quantity END) AS stock
FROM transactions
GROUP BY product_id, branch_id;
```

---

## API Endpoints ทั้งหมด

### Auth
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | /api/auth/login | เข้าสู่ระบบ | ทุกคน |
| GET | /api/auth/me | ดูข้อมูลตัวเอง | ทุกคน |

### Products
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/products | ดูสินค้าทั้งหมด | ทุกคน |
| GET | /api/products/:id | ดูสินค้าชิ้นเดียว | ทุกคน |
| POST | /api/products | เพิ่มสินค้า | admin |
| PUT | /api/products/:id | แก้ไขสินค้า | admin |
| DELETE | /api/products/:id | ลบสินค้า | admin |

### Inventory (รับ/ออกสินค้า)
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| POST | /api/inventory/receive | รับสินค้าเข้า | staff, manager, admin |
| POST | /api/inventory/issue | ออกสินค้า | staff, manager, admin |
| GET | /api/inventory/stock | ดู stock ปัจจุบันทุกสาขา | manager, admin |
| GET | /api/inventory/stock/:branchId | ดู stock สาขาเดียว | ทุกคน |
| GET | /api/inventory/history | ดูประวัติ transaction | manager, admin |

### Branches
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/branches | ดูสาขาทั้งหมด | ทุกคน |
| POST | /api/branches | เพิ่มสาขา | admin |
| PUT | /api/branches/:id | แก้ไขสาขา | admin |
| DELETE | /api/branches/:id | ลบสาขา | admin |

### Reports
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/reports/daily | รายงานรายวัน | manager, admin |
| GET | /api/reports/weekly | รายงานรายสัปดาห์ | manager, admin |
| GET | /api/reports/monthly | รายงานรายเดือน | manager, admin |

### Alerts
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/alerts | ดูการแจ้งเตือนทั้งหมด | manager, admin |
| POST | /api/alerts | ตั้งค่าแจ้งเตือน | manager, admin |
| PUT | /api/alerts/:id | แก้ไขแจ้งเตือน | manager, admin |

### Users
| Method | Endpoint | Description | Role |
|--------|----------|-------------|------|
| GET | /api/users | ดูผู้ใช้ทั้งหมด | admin |
| POST | /api/users | เพิ่มผู้ใช้ | admin |
| PUT | /api/users/:id | แก้ไขผู้ใช้ | admin |
| DELETE | /api/users/:id | ลบผู้ใช้ | admin |

---

## .env.example

```
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=inventory_db
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d
```

---

## สิ่งที่ต้องการจาก Claude Code

1. สร้างโครงสร้างโฟลเดอร์ตามที่กำหนด
2. เขียน Backend ทั้งหมดให้ครบทุก endpoint
3. เขียน Frontend React พร้อม Tailwind CSS
4. เชื่อม Frontend กับ Backend ผ่าน axios
5. ระบบ Login ใช้ JWT เก็บใน localStorage
6. Protected Route ตาม role ของผู้ใช้
7. Dashboard แสดงกราฟ stock รวมทุกสาขา

---

## หมายเหตุ

- Stock คำนวณจาก SUM ของ transactions ไม่ใช่ตารางแยก
- role: admin เห็นทุกสาขา, manager เห็นสาขาตัวเอง, staff บันทึกได้อย่างเดียว
- แจ้งเตือนเมื่อ stock ต่ำกว่า min_quantity ที่กำหนดใน alerts table
