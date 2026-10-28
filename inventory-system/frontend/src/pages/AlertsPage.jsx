// ============================================================
// AlertsPage.jsx — หน้าตั้งค่ากฎแจ้งเตือนสต๊อกต่ำ
// admin และ main_manager สามารถเพิ่ม แก้ไข และลบ "กฎแจ้งเตือน" ได้
// กฎแจ้งเตือนคือการกำหนดว่า: สินค้า X ที่สาขา Y ถ้าสต๊อกต่ำกว่า Z ให้แจ้งเตือน
// (แตกต่างจาก Dashboard ซึ่งใช้ products.low_stock_threshold อัตโนมัติ)
// หน้านี้จัดการกฎแบบ manual ผ่านตาราง alerts ใน database
// ============================================================

// useEffect ใช้ดึงข้อมูลตอนโหลดหน้า
// useState ใช้เก็บข้อมูลกฎ, สินค้า, สาขา, form และสถานะ editing
import { useEffect, useState } from "react";

// Navbar คือแถบเมนูด้านบน
import Navbar from "../components/Navbar";
import ProductSearchSelect from "../components/ProductSearchSelect";

// api คือ axios instance สำหรับเรียก backend
import api from "../services/api";

export default function AlertsPage() {
  // state เก็บรายการกฎแจ้งเตือนทั้งหมด (จาก /alerts/settings)
  // แต่ละ rule มี: id, product_name, sku, branch_name, min_quantity, stock, unit
  const [rules, setRules]       = useState([]);

  // state เก็บรายชื่อสินค้าสำหรับ dropdown "เลือกสินค้า" ในฟอร์มเพิ่มกฎ
  const [products, setProducts] = useState([]);

  // state เก็บรายชื่อสาขาสำหรับ dropdown "เลือกสาขา" ในฟอร์มเพิ่มกฎ
  const [branches, setBranches] = useState([]);

  // state เก็บข้อมูลในฟอร์มเพิ่มกฎใหม่
  const [form, setForm]         = useState({ product_id: "", branch_id: "", min_quantity: "" });

  // state เก็บ id ของกฎที่กำลังแก้ไข (null = ไม่ได้แก้ไขอยู่)
  const [editing, setEditing]   = useState(null); // alert id ที่กำลัง edit

  // state เก็บค่า min_quantity ที่กำลังแก้ไข (ใช้เฉพาะตอน edit inline)
  const [editQty, setEditQty]   = useState("");

  // state เก็บข้อความแจ้งผลลัพธ์ (สำเร็จหรือผิดพลาด)
  // { text: "...", error: true/false }
  const [msg, setMsg]           = useState({ text: "", error: false });

  // ดึงข้อมูล user จาก localStorage เพื่อรู้ว่าเป็น admin หรือไม่
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  // ถ้าเป็น admin: เห็นทุกสาขา, dropdown สาขาแสดง
  // ถ้าเป็น main_manager/staff: เห็นแค่สาขาตัวเอง, dropdown สาขาซ่อน
  const isAdmin = user.role === "admin";

  // ฟังก์ชันแสดงข้อความแจ้งเตือนชั่วคราว (3 วินาทีแล้วหาย)
  // text คือข้อความ, error คือ true/false สำหรับเลือกสี
  const flash = (text, error = false) => {
    setMsg({ text, error });
    // setTimeout รอ 3000ms (3 วินาที) แล้วล้างข้อความ
    setTimeout(() => setMsg({ text: "", error: false }), 3000);
  };

  // ฟังก์ชันดึงรายการกฎแจ้งเตือนจาก /alerts/settings
  // แยกออกมาเพื่อเรียกซ้ำได้ง่ายหลังเพิ่ม/แก้ไข/ลบ
  const fetchRules = async () => {
    // GET /api/alerts/settings — ดึงกฎทั้งหมดที่ active อยู่ (ไม่กรองตาม stock)
    // แตกต่างจาก /api/alerts ที่ใช้ใน Dashboard ซึ่งกรองเฉพาะสินค้าที่ต่ำกว่า threshold
    const res = await api.get("/alerts/settings");
    setRules(res.data);
  };

  // useEffect รันครั้งเดียวตอนโหลดหน้า
  useEffect(() => {
    const init = async () => {
      try {
        // ดึง 3 อย่างพร้อมกัน: กฎแจ้งเตือน, รายชื่อสินค้า, รายชื่อสาขา
        const [r, p, b] = await Promise.all([
          // GET /api/alerts/settings — กฎแจ้งเตือนทั้งหมด
          api.get("/alerts/settings"),
          // GET /api/products — สินค้าทั้งหมดสำหรับ dropdown
          api.get("/products"),
          // GET /api/branches — สาขาทั้งหมดสำหรับ dropdown
          api.get("/branches"),
        ]);
        setRules(r.data);
        setProducts(p.data);
        setBranches(b.data);

        // ถ้าไม่ใช่ admin (เป็น main_manager/staff) ให้ pre-select สาขาของตัวเองใน form
        // เพราะมีได้แค่สาขาเดียว ไม่ต้องเลือก
        if (!isAdmin && b.data.length > 0) {
          setForm((f) => ({ ...f, branch_id: b.data[0].id }));
        }
      } catch (err) {
        console.error("Failed to load alert settings:", err);
      }
    };
    init();
  }, [isAdmin]);

  // ฟังก์ชัน submit ฟอร์มเพิ่มกฎแจ้งเตือนใหม่
  const handleAdd = async (e) => {
    // ป้องกัน form reload หน้า
    e.preventDefault();
    try {
      // POST /api/alerts — สร้างกฎแจ้งเตือนใหม่ (หรืออัปเดตถ้ามีกฎเดิมอยู่แล้ว)
      // ส่ง product_id, branch_id, min_quantity เป็น request body
      await api.post("/alerts", form);

      // ล้างฟอร์ม โดย reset branch_id ตาม role (admin = ว่าง, manager = สาขาตัวเอง)
      setForm({ product_id: "", branch_id: isAdmin ? "" : (branches[0]?.id ?? ""), min_quantity: "" });

      // ดึงกฎทั้งหมดใหม่เพื่ออัปเดตตาราง
      await fetchRules();
      flash("เพิ่มกฎแจ้งเตือนสำเร็จ");
    } catch (err) {
      flash(err.response?.data?.message || "เกิดข้อผิดพลาด", true);
    }
  };

  // ฟังก์ชันเริ่ม edit กฎที่ระบุ (แบบ inline ในตาราง)
  // รับ rule = object ของกฎที่ต้องการแก้ไข
  const startEdit = (rule) => {
    // บันทึก id ของกฎที่จะแก้ไข
    setEditing(rule.id);
    // เติมค่า min_quantity เดิมเข้า input ที่จะปรากฏในแถวนั้น
    setEditQty(String(rule.min_quantity));
  };

  // ฟังก์ชันยกเลิก edit กลับสู่สถานะปกติ
  const cancelEdit = () => setEditing(null);

  // ฟังก์ชันบันทึกการแก้ไข min_quantity ของกฎที่ระบุ
  // รับ id = id ของกฎที่จะบันทึก
  const saveEdit = async (id) => {
    try {
      // PUT /api/alerts/:id — อัปเดต min_quantity ของกฎ
      // ส่ง min_quantity (แปลงเป็นตัวเลขด้วย Number()) และ is_active = 1
      await api.put(`/alerts/${id}`, { min_quantity: Number(editQty), is_active: 1 });
      // ออกจาก edit mode
      setEditing(null);
      // ดึงกฎใหม่เพื่ออัปเดตตาราง
      await fetchRules();
      flash("แก้ไขกฎแจ้งเตือนสำเร็จ");
    } catch (err) {
      flash(err.response?.data?.message || "เกิดข้อผิดพลาด", true);
    }
  };

  // ฟังก์ชันลบกฎแจ้งเตือน รับ id ของกฎที่ต้องการลบ
  const handleDelete = async (id) => {
    // ขอ confirm ก่อนลบ
    if (!confirm("ยืนยันลบกฎแจ้งเตือนนี้?")) return;
    try {
      // DELETE /api/alerts/:id — ลบกฎตาม id
      await api.delete(`/alerts/${id}`);
      await fetchRules();
      flash("ลบกฎแจ้งเตือนสำเร็จ");
    } catch (err) {
      flash(err.response?.data?.message || "เกิดข้อผิดพลาด", true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">ตั้งค่าการแจ้งเตือนสต็อก</h1>

        {/* ข้อความแจ้งผลลัพธ์ชั่วคราว (หายเองใน 3 วินาที) */}
        {msg.text && (
          <div className={`mb-4 p-3 rounded text-sm ${msg.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            {msg.text}
          </div>
        )}

        {/* ฟอร์มเพิ่มกฎแจ้งเตือนใหม่ */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="font-bold mb-4">เพิ่มกฎแจ้งเตือนใหม่</h2>
          <form onSubmit={handleAdd} className="flex flex-wrap gap-4 items-end">

            {/* Dropdown เลือกสินค้า */}
            <div className="flex-1 min-w-48">
              <label className="block text-sm text-gray-700 mb-1">สินค้า</label>
              <ProductSearchSelect
                products={products}
                value={form.product_id}
                onChange={(id) => setForm((f) => ({ ...f, product_id: id }))}
                required
              />
            </div>

            {/* Dropdown เลือกสาขา — แสดงเฉพาะ admin
                manager ไม่เห็นเพราะ backend ใช้สาขาของตัวเองอัตโนมัติ */}
            {isAdmin && (
              <div className="flex-1 min-w-48">
                <label className="block text-sm text-gray-700 mb-1">สาขา</label>
                <select
                  value={form.branch_id}
                  onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm"
                  required
                >
                  <option value="">เลือกสาขา</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* ช่องกรอกจำนวนขั้นต่ำที่จะให้แจ้งเตือน */}
            <div className="w-36">
              <label className="block text-sm text-gray-700 mb-1">จำนวนขั้นต่ำ</label>
              <input
                type="number"
                value={form.min_quantity}
                onChange={(e) => setForm({ ...form, min_quantity: e.target.value })}
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="0"
                required
                min="1"
              />
            </div>

            <button
              type="submit"
              className="bg-blue-600 text-white px-5 py-2 rounded hover:bg-blue-700 text-sm whitespace-nowrap"
            >
              + เพิ่มกฎ
            </button>
          </form>
        </div>

        {/* ตารางแสดงกฎแจ้งเตือนทั้งหมด */}
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th className="p-3 text-left">สินค้า</th>
                <th className="p-3 text-left">SKU</th>
                {/* คอลัมน์สาขาแสดงเฉพาะ admin (manager เห็นแค่สาขาตัวเอง) */}
                {isAdmin && <th className="p-3 text-left">สาขา</th>}
                <th className="p-3 text-right">จำนวนขั้นต่ำ</th>
                <th className="p-3 text-right">สต็อกปัจจุบัน</th>
                <th className="p-3 text-center">สถานะ</th>
                <th className="p-3 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {/* ถ้าไม่มีกฎเลย แสดงข้อความแจ้ง */}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="p-6 text-center text-gray-400">
                    ยังไม่มีกฎแจ้งเตือน
                  </td>
                </tr>
              ) : (
                rules.map((rule) => {
                  // เช็คว่าสต๊อกปัจจุบันต่ำกว่า threshold ที่กำหนดหรือไม่
                  const isLow = rule.stock < rule.min_quantity;

                  // เช็คว่ากฎนี้กำลังอยู่ใน edit mode หรือไม่
                  const isEditing = editing === rule.id;

                  return (
                    <tr key={rule.id} className="border-t hover:bg-gray-50">
                      <td className="p-3 font-medium">{rule.product_name}</td>
                      <td className="p-3 text-gray-500">{rule.sku}</td>
                      {isAdmin && <td className="p-3">{rule.branch_name}</td>}

                      {/* คอลัมน์ min_quantity: แสดงเป็น input ตอน edit, เป็น text ตอนปกติ */}
                      <td className="p-3 text-right">
                        {isEditing ? (
                          // ตอน edit mode: แสดง input ให้กรอกค่าใหม่
                          <input
                            type="number"
                            value={editQty}
                            onChange={(e) => setEditQty(e.target.value)}
                            className="w-20 border rounded px-2 py-1 text-right text-sm"
                            min="1"
                            autoFocus  // focus input นี้อัตโนมัติเมื่อเริ่ม edit
                          />
                        ) : (
                          // ตอนปกติ: แสดงตัวเลขพร้อมหน่วย
                          <span>{rule.min_quantity} {rule.unit}</span>
                        )}
                      </td>

                      {/* สต๊อกปัจจุบัน: สีแดงถ้าต่ำกว่า threshold, สีเขียวถ้าพอ */}
                      <td className={`p-3 text-right font-medium ${isLow ? "text-red-600" : "text-green-600"}`}>
                        {rule.stock} {rule.unit}
                      </td>

                      {/* badge สถานะ: แดง = ต่ำกว่าเกณฑ์, เขียว = เพียงพอ */}
                      <td className="p-3 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${isLow ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                          {isLow ? "ต่ำกว่าเกณฑ์" : "เพียงพอ"}
                        </span>
                      </td>

                      {/* ปุ่มจัดการ: เปลี่ยนเป็นปุ่มบันทึก/ยกเลิกตอน edit mode */}
                      <td className="p-3 text-center">
                        {isEditing ? (
                          // ตอน edit mode: แสดงปุ่ม "บันทึก" และ "ยกเลิก"
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => saveEdit(rule.id)}
                              className="bg-green-500 text-white px-3 py-1 rounded text-xs hover:bg-green-600"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="bg-gray-300 text-gray-700 px-3 py-1 rounded text-xs hover:bg-gray-400"
                            >
                              ยกเลิก
                            </button>
                          </div>
                        ) : (
                          // ตอนปกติ: แสดงปุ่ม "แก้ไข" และ "ลบ"
                          <div className="flex justify-center gap-2">
                            <button
                              onClick={() => startEdit(rule)}
                              className="bg-yellow-400 text-white px-3 py-1 rounded text-xs hover:bg-yellow-500"
                            >
                              แก้ไข
                            </button>
                            <button
                              onClick={() => handleDelete(rule.id)}
                              className="bg-red-500 text-white px-3 py-1 rounded text-xs hover:bg-red-600"
                            >
                              ลบ
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
