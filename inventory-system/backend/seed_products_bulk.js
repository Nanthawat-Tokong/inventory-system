/**
 * เพิ่มสินค้าจำนวนมาก (ค่าเริ่มต้น 2,000 รายการ) สำหรับทดสอบระบบ
 * - SKU ไม่ซ้ำ รูปแบบ <prefix หมวด>-<เลข 5 หลัก> เช่น STN-00001
 * - รันซ้ำได้: ถ้า SKU มีอยู่แล้วจะอัปเดตแทนการเพิ่มใหม่
 * - เปิดใช้งานสินค้าใหม่ให้ทุกสาขาใน branch_products
 *
 * Usage:
 *   node seed_products_bulk.js          – 2000 รายการ
 *   node seed_products_bulk.js 500      – กำหนดจำนวนเอง
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const COUNT = parseInt(process.argv[2], 10) || 2000;

const CATEGORIES = [
  {
    name: 'เครื่องเขียน', prefix: 'STN',
    items: [['ปากกาลูกลื่น', 'ด้าม'], ['ปากกาเจล', 'ด้าม'], ['ดินสอ 2B', 'แท่ง'], ['ยางลบ', 'ก้อน'],
      ['ไม้บรรทัด', 'อัน'], ['ปากกาเน้นข้อความ', 'ด้าม'], ['ปากกาเมจิก', 'ด้าม'], ['สมุดโน้ต', 'เล่ม'],
      ['กระดาษโน้ต', 'แพ็ค'], ['ลวดเย็บกระดาษ', 'กล่อง'], ['คลิปหนีบกระดาษ', 'กล่อง'], ['เทปใส', 'ม้วน']],
    variants: ['สีน้ำเงิน', 'สีแดง', 'สีดำ', 'สีเขียว', 'คละสี', 'ขนาดเล็ก', 'ขนาดกลาง', 'ขนาดใหญ่'],
  },
  {
    name: 'อุปกรณ์สำนักงาน', prefix: 'OFF',
    items: [['กระดาษ A4 70g', 'รีม'], ['กระดาษ A4 80g', 'รีม'], ['แฟ้มเอกสาร', 'อัน'], ['ซองเอกสาร', 'แพ็ค'],
      ['หมึกพิมพ์', 'ตลับ'], ['แม็กเย็บกระดาษ', 'อัน'], ['เครื่องเจาะกระดาษ', 'อัน'], ['กรรไกร', 'อัน'],
      ['คัตเตอร์', 'อัน'], ['กาวแท่ง', 'แท่ง'], ['ถาดเอกสาร', 'อัน'], ['ป้ายชื่อ', 'แพ็ค']],
    variants: ['สีขาว', 'สีฟ้า', 'สีเหลือง', 'สีชมพู', 'รุ่นมาตรฐาน', 'รุ่นพรีเมียม', 'แพ็คประหยัด', 'ขนาด F4'],
  },
  {
    name: 'เครื่องดื่ม', prefix: 'BEV',
    items: [['น้ำดื่ม', 'ขวด'], ['น้ำแร่', 'ขวด'], ['ชาเขียว', 'ขวด'], ['กาแฟกระป๋อง', 'กระป๋อง'],
      ['น้ำผลไม้', 'กล่อง'], ['นมจืด', 'กล่อง'], ['นมช็อกโกแลต', 'กล่อง'], ['น้ำอัดลม', 'กระป๋อง'],
      ['กาแฟซอง 3in1', 'แพ็ค'], ['ชาซอง', 'กล่อง'], ['เครื่องดื่มเกลือแร่', 'ขวด'], ['โซดา', 'ขวด']],
    variants: ['250 มล.', '330 มล.', '500 มล.', '600 มล.', '1 ลิตร', '1.5 ลิตร', 'สูตรไม่มีน้ำตาล', 'สูตรหวานน้อย'],
  },
  {
    name: 'อาหาร', prefix: 'FOD',
    items: [['บะหมี่กึ่งสำเร็จรูป', 'ซอง'], ['ข้าวสาร', 'ถุง'], ['ปลากระป๋อง', 'กระป๋อง'], ['ขนมปังกรอบ', 'ห่อ'],
      ['มันฝรั่งทอด', 'ถุง'], ['ถั่วอบ', 'ถุง'], ['ซีเรียล', 'กล่อง'], ['บิสกิต', 'ห่อ'],
      ['ข้าวต้มกึ่งสำเร็จรูป', 'ถ้วย'], ['โจ๊กซอง', 'ซอง'], ['ลูกอม', 'ถุง'], ['ช็อกโกแลต', 'แท่ง']],
    variants: ['รสต้นตำรับ', 'รสต้มยำ', 'รสหมูสับ', 'รสไก่', 'รสสาหร่าย', 'รสบาร์บีคิว', 'ขนาดเล็ก', 'ขนาดครอบครัว'],
  },
  {
    name: 'ทำความสะอาด', prefix: 'CLN',
    items: [['น้ำยาล้างจาน', 'ขวด'], ['น้ำยาถูพื้น', 'ขวด'], ['น้ำยาล้างห้องน้ำ', 'ขวด'], ['ผงซักฟอก', 'ถุง'],
      ['น้ำยาปรับผ้านุ่ม', 'ถุง'], ['ถุงขยะ', 'แพ็ค'], ['ฟองน้ำล้างจาน', 'แพ็ค'], ['ไม้ถูพื้น', 'อัน'],
      ['ไม้กวาด', 'อัน'], ['ผ้าเช็ดทำความสะอาด', 'ผืน'], ['สเปรย์ฆ่าเชื้อ', 'กระป๋อง'], ['น้ำยาเช็ดกระจก', 'ขวด']],
    variants: ['กลิ่นมะนาว', 'กลิ่นลาเวนเดอร์', 'กลิ่นฟลอรัล', 'ไม่มีกลิ่น', 'ขนาด 500 มล.', 'ขนาด 1 ลิตร', 'ชนิดเติม', 'แพ็คคู่'],
  },
  {
    name: 'ของใช้ส่วนตัว', prefix: 'PER',
    items: [['สบู่ก้อน', 'ก้อน'], ['สบู่เหลว', 'ขวด'], ['แชมพู', 'ขวด'], ['ครีมนวดผม', 'ขวด'],
      ['ยาสีฟัน', 'หลอด'], ['แปรงสีฟัน', 'ด้าม'], ['กระดาษทิชชู่', 'แพ็ค'], ['ผ้าเย็น', 'ห่อ'],
      ['เจลล้างมือ', 'ขวด'], ['หน้ากากอนามัย', 'กล่อง'], ['สำลี', 'ห่อ'], ['โลชั่นทาผิว', 'ขวด']],
    variants: ['สูตรอ่อนโยน', 'สูตรเย็น', 'สูตรผิวแพ้ง่าย', 'ขนาดพกพา', 'ขนาดกลาง', 'ขนาดใหญ่', 'แพ็ค 3', 'แพ็ค 6'],
  },
  {
    name: 'อุปกรณ์ไอที', prefix: 'ITE',
    items: [['เมาส์', 'ชิ้น'], ['คีย์บอร์ด', 'ชิ้น'], ['สาย USB', 'เส้น'], ['แฟลชไดรฟ์', 'ชิ้น'],
      ['หูฟัง', 'ชิ้น'], ['ปลั๊กพ่วง', 'ชิ้น'], ['ถ่าน AA', 'แพ็ค'], ['ถ่าน AAA', 'แพ็ค'],
      ['แผ่นรองเมาส์', 'ชิ้น'], ['สาย LAN', 'เส้น'], ['อะแดปเตอร์ชาร์จ', 'ชิ้น'], ['เว็บแคม', 'ชิ้น']],
    variants: ['รุ่นมาตรฐาน', 'รุ่นไร้สาย', 'Type-C', 'ยาว 1 ม.', 'ยาว 3 ม.', '32GB', '64GB', 'สีดำ'],
  },
  {
    name: 'บรรจุภัณฑ์', prefix: 'PKG',
    items: [['กล่องลูกฟูก', 'ใบ'], ['เทปปิดกล่อง', 'ม้วน'], ['บับเบิ้ลกันกระแทก', 'ม้วน'], ['ถุงพลาสติก', 'แพ็ค'],
      ['ถุงซิปล็อค', 'แพ็ค'], ['ฟิล์มยืด', 'ม้วน'], ['ซองไปรษณีย์', 'แพ็ค'], ['สติกเกอร์ระวังแตก', 'ม้วน'],
      ['เชือกฟาง', 'ม้วน'], ['ถุงกระดาษ', 'แพ็ค'], ['กล่องอาหาร', 'แพ็ค'], ['แก้วพลาสติก', 'แพ็ค']],
    variants: ['เบอร์ 00', 'เบอร์ A', 'เบอร์ B', 'เบอร์ C', 'ขนาด S', 'ขนาด M', 'ขนาด L', 'ขนาด XL'],
  },
];

function buildProducts(count) {
  // สร้างชื่อแบบ รายการ + ตัวเลือก (+ ล็อตที่ n ถ้าเกินจำนวนคอมโบ) วนทีละหมวดให้กระจายเท่าๆ กัน
  const pools = CATEGORIES.map(c => {
    const list = [];
    for (const v of c.variants) for (const [item, unit] of c.items) list.push({ item, unit, v });
    return { cat: c, list, idx: 0, seq: 0 };
  });
  const out = [];
  while (out.length < count) {
    for (const p of pools) {
      if (out.length >= count) break;
      const combo = p.list[p.idx % p.list.length];
      const lot = Math.floor(p.idx / p.list.length);
      p.idx++; p.seq++;
      out.push({
        name: `${combo.item} ${combo.v}${lot > 0 ? ` รุ่น ${lot + 1}` : ''}`,
        sku: `${p.cat.prefix}-${String(p.seq).padStart(5, '0')}`,
        category: p.cat.name,
        unit: combo.unit,
        low_stock_threshold: [10, 20, 30, 50, 100][(p.seq * 7) % 5],
      });
    }
  }
  return out;
}

async function main() {
  const conn = await mysql.createConnection({
    host    : process.env.DB_HOST     || 'localhost',
    user    : process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'inventory_db',
    charset : 'utf8mb4',
  });
  await conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");

  const products = buildProducts(COUNT);
  console.log(`กำลังเพิ่มสินค้า ${products.length} รายการ…`);

  await conn.beginTransaction();
  try {
    const BATCH = 500;
    let inserted = 0, updated = 0;
    for (let i = 0; i < products.length; i += BATCH) {
      const rows = products.slice(i, i + BATCH)
        .map(p => [p.name, p.sku, p.category, p.unit, p.low_stock_threshold]);
      const [r] = await conn.query(
        `INSERT INTO products (name, sku, category, unit, low_stock_threshold)
         VALUES ?
         ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category),
           unit = VALUES(unit), low_stock_threshold = VALUES(low_stock_threshold), is_deleted = 0`,
        [rows]
      );
      // affectedRows: 1 ต่อแถวใหม่, 2 ต่อแถวที่อัปเดต
      const upd = r.affectedRows - rows.length;
      updated += Math.max(upd, 0);
      inserted += rows.length - Math.max(upd, 0);
    }

    const skus = products.map(p => p.sku);
    const [bp] = await conn.query(
      `INSERT INTO branch_products (branch_id, product_id, is_active)
       SELECT b.id, p.id, 1 FROM branches b JOIN products p ON p.sku IN (?)
       ON DUPLICATE KEY UPDATE is_active = is_active`,
      [skus]
    );

    await conn.commit();
    console.log(`  เพิ่มใหม่ ~${inserted} รายการ, อัปเดต ~${updated} รายการ`);
    console.log(`  branch_products: ${bp.affectedRows} แถว`);
  } catch (e) {
    await conn.rollback();
    throw e;
  }

  const [[{ c }]] = await conn.query('SELECT COUNT(*) c FROM products WHERE is_deleted = 0');
  console.log(`เสร็จสิ้น — สินค้าทั้งหมดในระบบตอนนี้: ${c} รายการ`);
  await conn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
