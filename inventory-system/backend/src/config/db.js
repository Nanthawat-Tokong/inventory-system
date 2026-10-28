const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

// ใช้ READ COMMITTED: ทุกคำสั่ง SELECT เห็นข้อมูลล่าสุดที่ commit แล้ว
// ค่าเริ่มต้นของ MariaDB/MySQL (REPEATABLE READ) จะ "จำภาพข้อมูล" ตั้งแต่ SELECT แรกของ transaction —
// ถ้า request รอล็อกสินค้า (utils/stock.js lockStock) อยู่ แล้วอีก request บันทึกสต๊อกเสร็จไปก่อน
// การคำนวณสต๊อกหลังได้ล็อกจะยังเห็นยอดเก่า → รับเข้า/จัดส่งพร้อมกันแล้วยอดเพี้ยน (เจอจาก tests/03_inventory)
pool.pool.on('connection', (conn) => {
  conn.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
});

module.exports = pool;
