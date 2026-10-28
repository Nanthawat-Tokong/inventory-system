/**
 * เติมสต๊อกคลังหลักให้พอใช้ — บันทึกเป็นรายการ "รับเข้า" ปกติ (ประวัติ/รายงานตรงกัน)
 * - เป้าหมายต่อสินค้า = เกณฑ์ขั้นต่ำ × 5–10 (ต่างกันไปตามสินค้า) ปัดเป็นหลักสิบ
 * - เติมเฉพาะสินค้าที่ต่ำกว่าเป้า ไม่แตะสินค้าที่มีของพออยู่แล้ว → รันซ้ำได้ไม่เพิ่มเกิน
 * - ทุกรายการมีหมายเหตุ "[เติมสต๊อกเริ่มต้น]" ถ้าต้องการย้อนกลับ ลบรายการที่มีหมายเหตุนี้ได้
 *
 * Usage:
 *   node seed_stock.js          – เติมจริง
 *   node seed_stock.js --dry    – ดูว่าจะเติมอะไรบ้าง (ไม่บันทึก)
 */

require('dotenv').config();
const pool = require('./src/config/db');

const NOTE = '[เติมสต๊อกเริ่มต้น]';
const dry = process.argv.includes('--dry');

async function main() {
  const [[wh]] = await pool.query('SELECT id, name FROM branches WHERE is_warehouse = 1 AND is_deleted = 0 LIMIT 1');
  if (!wh) throw new Error('ไม่พบสาขาคลังหลัก');
  const [[user]] = await pool.query(
    "SELECT id FROM users WHERE (role = 'main_manager' AND branch_id = ?) OR role = 'admin' ORDER BY role = 'main_manager' DESC LIMIT 1",
    [wh.id]
  );

  const [rows] = await pool.query(`
    SELECT p.id, p.low_stock_threshold AS threshold, COALESCE(cs.stock, 0) AS stock
    FROM products p
    LEFT JOIN current_stock cs ON cs.product_id = p.id AND cs.branch_id = ?
    WHERE p.is_deleted = 0
  `, [wh.id]);

  const plan = rows
    .map((r) => {
      const factor = 5 + (r.id * 7) % 6;                       // 5–10 เท่า กระจายตามสินค้า
      const target = Math.ceil((Math.max(1, r.threshold) * factor) / 10) * 10;
      return { id: r.id, stock: Number(r.stock), add: target - Number(r.stock) };
    })
    .filter((r) => r.add > 0);

  const total = plan.reduce((a, r) => a + r.add, 0);
  console.log(`คลังหลัก: ${wh.name} — จะเติม ${plan.length} รายการ รวม ${total.toLocaleString()} ชิ้น`);
  if (dry || plan.length === 0) { await pool.end(); return; }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < plan.length; i += 500) {
      const batch = plan.slice(i, i + 500)
        .map((r) => [r.id, wh.id, user.id, 'receive', r.add, r.stock + r.add, NOTE]);
      await conn.query(
        'INSERT INTO transactions (product_id, branch_id, user_id, type, quantity, stock_after, note) VALUES ?',
        [batch]
      );
    }
    await conn.commit();
    console.log('เติมสต๊อกเรียบร้อย');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
