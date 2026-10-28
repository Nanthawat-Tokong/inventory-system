// ============================================================
// ProductsPage.jsx — หน้าจัดการสินค้า (Product Master Data)
// admin สามารถเพิ่ม แก้ไข และลบสินค้าได้
// แสดงตารางสินค้าทั้งหมดพร้อมฟอร์มเพิ่ม/แก้ไขด้านบน
// ใช้ฟอร์มเดียวกันสำหรับทั้งเพิ่มและแก้ไข โดยเปลี่ยน mode ตาม state `editing`
// ============================================================

// useEffect ใช้ดึงข้อมูลสินค้าตอนโหลดหน้า
// useState ใช้เก็บข้อมูลสินค้า ข้อมูลฟอร์ม และสถานะต่างๆ
import { useEffect, useMemo, useState } from "react";

// Navbar คือแถบเมนูด้านบน
import Navbar from "../components/Navbar";

// api คือ axios instance สำหรับเรียก backend API
import api from "../services/api";
import Pager from "../components/Pager";

const PAGE_SIZE = 50;

// สถานะสต๊อกเทียบกับเกณฑ์แจ้งเตือนของสินค้านั้น
const stockLevel = (p) => {
  const n = Number(p.stock) || 0;
  if (n <= 0) return "out";
  if (n < Number(p.threshold ?? p.low_stock_threshold)) return "low"; // เกณฑ์เฉพาะสาขา (ถ้าตั้ง) หรือค่ากลาง
  return "ok";
};
const LEVEL = {
  out: { text: "หมด", cls: "bg-red-100 text-red-700", num: "text-red-600" },
  low: { text: "ใกล้หมด", cls: "bg-amber-100 text-amber-800", num: "text-amber-700" },
  ok: { text: "มีของ", cls: "bg-green-100 text-green-700", num: "text-gray-900" },
};

export default function ProductsPage() {
  // เพิ่ม/แก้ไข/ลบสินค้าได้เฉพาะ admin และ main_manager (staff ดูได้อย่างเดียว)
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const canManage = user.role === "admin" || user.role === "main_manager";
  // อยู่ฝั่งคลังหลักไหม (admin / ผู้ใช้ที่สังกัดคลังหลัก) — ใช้เลือกว่าคอลัมน์คงเหลือแสดงของที่ไหน
  const atWarehouse = user.role === "admin" || Number(user.is_warehouse) === 1;

  // state เก็บรายการสินค้าทั้งหมดที่ดึงมาจาก server
  // แต่ละ item มี: id, name, sku, category, unit
  const [products, setProducts] = useState([]);

  // state เก็บข้อมูลในฟอร์ม (ผูกกับ input แต่ละช่อง)
  // เมื่อกรอกข้อมูลในช่องไหน ค่าใน form จะอัปเดตตาม
  const [form, setForm] = useState({ name: "", sku: "", category: "", unit: "ชิ้น", low_stock_threshold: 50 });

  // state เก็บ id ของสินค้าที่กำลังแก้ไข
  // null = กำลัง "เพิ่มใหม่", มีค่า = กำลัง "แก้ไข" สินค้าตัวนั้น
  const [editing, setEditing] = useState(null);

  // state เก็บข้อความแจ้งผลลัพธ์และประเภท (สำเร็จหรือผิดพลาด)
  // { text: "...", isError: true/false } — isError ใช้เลือกสีแสดงผล (แดง/เขียว)
  const [msg, setMsg] = useState({ text: "", isError: false });

  // ฟังก์ชันดึงข้อมูลสินค้าทั้งหมดจาก server
  // แยกออกมาเพื่อเรียกซ้ำได้ง่ายหลังเพิ่ม/แก้ไข/ลบ
  const fetchProducts = async () => {
    // GET /api/products — ดึงรายการสินค้าทั้งหมด เรียงตามวันที่สร้างล่าสุด
    const res = await api.get("/products");
    // อัปเดต state products ด้วยข้อมูลที่ได้จาก server
    setProducts(res.data);
  };

  // useEffect นี้รันครั้งเดียวตอนที่ component โหลดขึ้นมาครั้งแรก
  // [] หมายความว่าไม่มี dependency จึงรันแค่ครั้งเดียวตอน mount (โหลดหน้า)
  useEffect(() => {
    api.get("/products").then((res) => setProducts(res.data)).catch(() => {});
  }, []);

  // ค้นหา / กรองหมวด / แบ่งหน้า — สินค้ามีเป็นพันรายการ แสดงทีเดียวหมดไม่ไหว
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(1);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(), [products]);
  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      if (level && stockLevel(p) !== level) return false;
      const hay = `${p.name} ${p.sku} ${p.category || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [products, query, category, level]);
  const summary = useMemo(() => {
    const s = { units: 0, out: 0, low: 0 };
    products.forEach((p) => {
      s.units += Math.max(0, Number(p.stock) || 0);
      const lv = stockLevel(p);
      if (lv === "out") s.out++;
      if (lv === "low") s.low++;
    });
    return s;
  }, [products]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  // ฟังก์ชัน submit ฟอร์ม ทำงานเมื่อกดปุ่ม "เพิ่มสินค้า" หรือ "บันทึกการแก้ไข"
  const handleSubmit = async (e) => {
    // ป้องกันการ reload หน้าแบบ default ของ form HTML
    e.preventDefault();
    try {
      if (editing) {
        // ถ้า editing มีค่า = กำลัง "แก้ไข" สินค้าที่มีอยู่แล้ว
        // PUT /api/products/:id — อัปเดตข้อมูลสินค้าตาม id ที่ระบุ
        await api.put(`/products/${editing}`, form);
        setMsg({ text: "แก้ไขสำเร็จ!", isError: false });
        // ล้าง editing state กลับเป็น null เพื่อกลับสู่ mode "เพิ่มใหม่"
        setEditing(null);
      } else {
        // ถ้า editing เป็น null = กำลัง "เพิ่ม" สินค้าใหม่
        // POST /api/products — สร้างสินค้าใหม่ด้วยข้อมูลจาก form
        await api.post("/products", form);
        setMsg({ text: "เพิ่มสินค้าสำเร็จ!", isError: false });
      }
      // ล้างฟอร์มกลับเป็นค่าเริ่มต้นหลังบันทึกสำเร็จ
      setForm({ name: "", sku: "", category: "", unit: "ชิ้น", low_stock_threshold: 50 });
      // ดึงข้อมูลสินค้าใหม่เพื่ออัปเดตตารางทันที
      fetchProducts();
    } catch (err) {
      // ถ้าเกิด error (เช่น SKU ซ้ำ) แสดงข้อความผิดพลาด
      setMsg({ text: err.response?.data?.message || "เกิดข้อผิดพลาด (SKU อาจซ้ำกับสินค้าอื่น)", isError: true });
    }
  };

  // ฟังก์ชันโหลดข้อมูลสินค้าที่ต้องการแก้ไขเข้าฟอร์ม
  // รับ p = object ของสินค้าที่กดปุ่มแก้ไข
  const handleEdit = (p) => {
    // บันทึก id ของสินค้าที่จะแก้ไข เพื่อให้ handleSubmit รู้ว่าต้อง PUT ไปที่ id ไหน
    setEditing(p.id);
    // เติมข้อมูลสินค้าเข้าฟอร์มเพื่อให้ user แก้ไขได้ทันที
    setForm({ name: p.name, sku: p.sku, category: p.category, unit: p.unit, low_stock_threshold: p.low_stock_threshold ?? 50 });
    // ฟอร์มอยู่ด้านบนสุด — เลื่อนขึ้นไปให้เห็นทันที (ไม่ต้องเลื่อนหาเองเวลากดแก้จากหน้าท้ายๆ)
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ฟังก์ชันลบสินค้า รับ id ของสินค้าที่ต้องการลบ
  const handleDelete = async (id) => {
    // แสดง dialog ยืนยันก่อนลบ ถ้ากด "ยกเลิก" จะหยุดทำงาน
    if (!confirm("ยืนยันลบสินค้า?")) return;
    try {
      // DELETE /api/products/:id — soft delete สินค้า (ตั้ง is_deleted = 1 แทนลบจริง)
      await api.delete(`/products/${id}`);
      // await รอให้ดึงข้อมูลใหม่เสร็จก่อน เพื่อให้ตารางอัปเดตแน่นอน
      await fetchProducts();
    } catch (err) {
      // แสดงข้อความ error จาก server พร้อมสีแดงเพื่อบอกว่าเป็น error
      setMsg({ text: "ไม่สามารถลบสินค้าได้: " + (err.response?.data?.message || "เกิดข้อผิดพลาด"), isError: true });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">จัดการสินค้า</h1>

        {/* กล่องฟอร์ม เปลี่ยนหัวข้อตาม mode: แก้ไข หรือ เพิ่มใหม่ — เฉพาะ admin/main_manager */}
        {canManage && (
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          {/* ถ้า editing มีค่า (กำลังแก้ไข) แสดง "แก้ไขสินค้า", ถ้าไม่มี แสดง "เพิ่มสินค้าใหม่" */}
          <h2 className="font-bold mb-4">{editing ? "แก้ไขสินค้า" : "เพิ่มสินค้าใหม่"}</h2>

          {/* แสดงข้อความผลลัพธ์เฉพาะเมื่อมีค่า — สีแดงถ้าเป็น error, สีเขียวถ้าสำเร็จ */}
          {msg.text && (
            <p className={`mb-4 ${msg.isError ? "text-red-600" : "text-green-600"}`}>{msg.text}</p>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            {/* ช่องชื่อสินค้า */}
            <div>
              <label className="block text-gray-700 mb-1">ชื่อสินค้า</label>
              <input
                type="text"
                value={form.name}
                // spread operator {...form} คัดลอก field อื่นทั้งหมด แล้วแทนที่แค่ name
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>

            {/* ช่อง SKU (รหัสสินค้าที่ไม่ซ้ำกัน) */}
            <div>
              <label className="block text-gray-700 mb-1">รหัสสินค้า (SKU) <span className="text-xs text-gray-400">— ห้ามซ้ำกับสินค้าอื่น</span></label>
              <input
                type="text"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>

            {/* ช่องหมวดหมู่ (ไม่บังคับกรอก) */}
            <div>
              <label className="block text-gray-700 mb-1">หมวดหมู่</label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            {/* ช่องหน่วย เช่น ชิ้น, รีม, ด้าม */}
            <div>
              <label className="block text-gray-700 mb-1">หน่วย</label>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            {/* ช่องจำนวนขั้นต่ำก่อนแจ้งเตือนสต๊อกต่ำ (ใช้โดยหน้า Dashboard และ Alerts) */}
            <div>
              <label className="block text-gray-700 mb-1">แจ้งเตือนเมื่อสต๊อกต่ำกว่า</label>
              <input
                type="number"
                value={form.low_stock_threshold}
                onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                className="w-full border rounded px-3 py-2"
                min="0"
              />
            </div>

            {/* ปุ่ม submit + ปุ่มยกเลิก (ปรากฏเฉพาะใน edit mode) */}
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">
                {/* เปลี่ยน label ตาม mode */}
                {editing ? "บันทึกการแก้ไข" : "เพิ่มสินค้า"}
              </button>

              {/* ปุ่มยกเลิกแสดงเฉพาะตอนแก้ไข — กดแล้วล้างฟอร์มและออกจาก edit mode */}
              {editing && (
                <button type="button" onClick={() => { setEditing(null); setForm({ name: "", sku: "", category: "", unit: "ชิ้น", low_stock_threshold: 50 }); }}
                  className="bg-gray-400 text-white px-6 py-2 rounded hover:bg-gray-500">
                  ยกเลิก
                </button>
              )}
            </div>
          </form>
        </div>
        )}

        {/* ตารางแสดงสินค้า — ค้นหา/กรองหมวด/แบ่งหน้า */}
        <div className="bg-white rounded-lg shadow">
          <div className="flex flex-wrap gap-3 p-4 border-b">
            <input
              type="text" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="ค้นหาชื่อสินค้า / SKU" className="flex-1 min-w-56 border rounded px-3 py-2 text-sm"
            />
            <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="border rounded px-3 py-2 text-sm">
              <option value="">ทุกหมวด</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={level} onChange={(e) => { setLevel(e.target.value); setPage(1); }} className="border rounded px-3 py-2 text-sm">
              <option value="">ทุกสถานะสต๊อก</option>
              <option value="out">หมด</option>
              <option value="low">ใกล้หมด</option>
              <option value="ok">มีของ</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-3 text-sm border-b bg-gray-50">
            <span>สินค้า <b>{products.length.toLocaleString()}</b> รายการ</span>
            <span>คงเหลือรวม{atWarehouse ? "ที่คลังหลัก" : "ที่สาขาคุณ"} <b>{summary.units.toLocaleString()}</b> ชิ้น</span>
            <button onClick={() => { setLevel("out"); setPage(1); }} className="text-red-600 hover:underline">หมด <b>{summary.out.toLocaleString()}</b></button>
            <button onClick={() => { setLevel("low"); setPage(1); }} className="text-amber-700 hover:underline">ใกล้หมด <b>{summary.low.toLocaleString()}</b></button>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">ชื่อสินค้า</th>
                <th className="p-3 text-left">รหัสสินค้า</th>
                <th className="p-3 text-left">หมวดหมู่</th>
                <th className="p-3 text-right">{atWarehouse ? "คงเหลือคลังหลัก" : "คงเหลือที่สาขาคุณ"}</th>
                <th className="p-3 text-right">{atWarehouse ? (products.some((p) => p.total_stock !== undefined) ? "รวมทุกสาขา" : "") : "คลังหลักมี"}</th>
                <th className="p-3 text-left">หน่วย</th>
                <th className="p-3 text-right">แจ้งเตือนเมื่อต่ำกว่า</th>
                {canManage && <th className="p-3 text-left">จัดการ</th>}
              </tr>
            </thead>
            <tbody>
              {/* วนลูปแสดงสินค้าแต่ละรายการ */}
              {pageRows.length === 0 && (
                <tr><td colSpan={8} className="p-6 text-center text-gray-400">ไม่พบสินค้า</td></tr>
              )}
              {pageRows.map((p) => (
                // key={p.id} ช่วยให้ React ติดตาม element แต่ละแถวได้ถูกต้อง
                <tr key={p.id} className="border-t">
                  <td className="p-3">{p.name}</td>
                  <td className="p-3">{p.sku}</td>
                  <td className="p-3">{p.category}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <b className={`tabular-nums ${LEVEL[stockLevel(p)].num}`}>{Number(p.stock || 0).toLocaleString()}</b>
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${LEVEL[stockLevel(p)].cls}`}>{LEVEL[stockLevel(p)].text}</span>
                  </td>
                  <td className="p-3 text-right tabular-nums text-gray-600">
                    {atWarehouse ? (p.total_stock !== undefined ? Number(p.total_stock).toLocaleString() : "") : Number(p.warehouse_stock || 0).toLocaleString()}
                  </td>
                  <td className="p-3">{p.unit}</td>
                  <td className="p-3 text-right">
                    {p.threshold ?? p.low_stock_threshold}
                    {p.threshold_source === "branch" && <div className="text-xs text-blue-600" title={`ค่ากลางของสินค้า = ${p.low_stock_threshold}`}>ตั้งเฉพาะสาขา</div>}
                  </td>
                  {canManage && (
                    <td className="p-3 flex gap-2">
                      {/* ปุ่มแก้ไข: โหลดข้อมูลสินค้านี้เข้าฟอร์มด้านบน */}
                      <button onClick={() => handleEdit(p)} className="bg-yellow-400 text-white px-3 py-1 rounded text-sm hover:bg-yellow-500">แก้ไข</button>
                      {/* ปุ่มลบ: ถามยืนยันก่อนลบ */}
                      <button onClick={() => handleDelete(p.id)} className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600">ลบ</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <Pager page={current} pages={pages} total={filtered.length} onPage={setPage} pageSize={PAGE_SIZE} />
        </div>
      </div>
    </div>
  );
}
