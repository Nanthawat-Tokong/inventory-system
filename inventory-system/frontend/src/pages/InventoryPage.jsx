// ============================================================
// InventoryPage.jsx — หน้าบันทึกการรับเข้า / ออกสินค้า และดูสต๊อก
// ใช้สำหรับบันทึก transaction ว่าสินค้าไหน สาขาไหน รับเข้า/ออกกี่ชิ้น
// แสดงประวัติ transaction ย้อนหลัง 50 รายการด้านล่างฟอร์ม
// ทุก role เข้าหน้านี้ได้ แต่สิทธิ์บันทึกต่างกัน:
//   - admin/main_manager: บันทึกได้ทั้งรับเข้า (เฉพาะคลังหลัก) และออกสินค้า (ทุกสาขา)
//   - staff: บันทึกได้เฉพาะ "ออกสินค้า" ของสาขาตัวเองเท่านั้น (ล็อกสาขา, ไม่มีตัวเลือกรับเข้า)
//     เพราะสาขาย่อยต้องรับสินค้าผ่านใบขอเบิกเท่านั้น ไม่ใช่ฟอร์มนี้ — ดู inventoryRoutes.js
// ============================================================

// useEffect ใช้ดึงข้อมูลสินค้า สาขา และประวัติตอนโหลดหน้า
// useState ใช้เก็บข้อมูลต่างๆ
import { useEffect, useState } from "react";

// Navbar คือแถบเมนูด้านบน
import Navbar from "../components/Navbar";
import ProductSearchSelect from "../components/ProductSearchSelect";

// api คือ axios instance สำหรับเรียก backend
import api from "../services/api";

export default function InventoryPage() {
  // ฟอร์มเต็ม (รับเข้า+ออกสินค้า, เลือกสาขาได้): เฉพาะ admin และ main_manager
  // ฟอร์มจำกัด (ออกสินค้าอย่างเดียว, ล็อกสาขาตัวเอง): staff
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const canManage = user.role === "admin" || user.role === "main_manager";
  const isStaffIssueOnly = user.role === "staff";

  // ฟอร์มเริ่มต้นตาม role: staff ล็อก type="issue" และ branch_id เป็นสาขาตัวเองเสมอ
  const defaultFormForRole = () => ({
    product_id: "",
    branch_id: isStaffIssueOnly ? String(user.branch_id || "") : "",
    type: isStaffIssueOnly ? "issue" : "receive",
    quantity: "",
    note: "",
  });

  // state เก็บรายการสินค้าทั้งหมดสำหรับ dropdown "เลือกสินค้า"
  const [products, setProducts] = useState([]);

  // state เก็บรายการสาขาสำหรับ dropdown "เลือกสาขา"
  // (admin เห็นทุกสาขา, main_manager/staff เห็นแค่สาขาตัวเอง — backend กรองให้)
  const [branches, setBranches] = useState([]);

  // state เก็บประวัติ transaction ย้อนหลัง (สูงสุด 50 รายการ)
  // แต่ละ item มี: id, product_name, branch_name, type, quantity, stock_after, created_at
  const [history, setHistory] = useState([]);

  // state เก็บสต๊อกปัจจุบันของสาขาที่เลือก — ใช้กรอง dropdown สินค้าตอน "ออกสินค้า"
  // เพื่อไม่ให้เลือกสินค้าที่สาขานั้นไม่มีสต๊อกแล้วโดนปฏิเสธตอน submit
  const [branchStock, setBranchStock] = useState([]);

  // state เก็บข้อมูลที่กรอกในฟอร์ม บันทึก transaction
  const [form, setForm] = useState(defaultFormForRole());

  // state เก็บข้อความแจ้งผลลัพธ์การบันทึก — { text, error } เพื่อแสดงสีต่างกันตามผลลัพธ์
  const [msg, setMsg] = useState({ text: "", error: false });

  // useEffect รันครั้งเดียวตอนโหลดหน้า (dependency = [] คืออาร์เรย์ว่าง)
  // ดึงข้อมูล 3 อย่างพร้อมกัน: รายชื่อสินค้า, สาขา, ประวัติ transaction
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Promise.all ส่ง 3 request พร้อมกันเพื่อประหยัดเวลา
        const [p, b, h] = await Promise.all([
          // GET /api/products — รายชื่อสินค้าทั้งหมดสำหรับ dropdown
          api.get("/products"),
          // GET /api/branches — รายชื่อสาขา (admin เห็นทุกสาขา, อื่นๆ เห็นสาขาตัวเอง)
          api.get("/branches"),
          // GET /api/inventory/history — ประวัติ transaction ล่าสุด 50 รายการ
          api.get("/inventory/history"),
        ]);
        setProducts(p.data);
        setBranches(b.data);
        setHistory(h.data);
      } catch (err) {
        console.error("Failed to load inventory data:", err);
      }
    };
    fetchData();
  }, []);

  // ตอน "รับเข้า": รับตรงได้เฉพาะคลังหลัก (is_warehouse=1) — สาขาย่อยต้องรับผ่านใบขอเบิกเท่านั้น
  // ตอน "ออกสินค้า": ได้ทุกสาขา (เช่น ตัดสต๊อกกรณีเสียหาย/สูญหาย)
  const branchOptions = form.type === "receive" ? branches.filter((b) => b.is_warehouse) : branches;

  // สาขาที่ใช้จริง: ตอนรับเข้าถ้ามีคลังหลักแห่งเดียว ล็อกเป็นคลังหลักอัตโนมัติ
  // (คำนวณจากค่าปัจจุบันแทนการ setForm ใน effect — ไม่ต้อง render ซ้ำ)
  const branchId = form.type === "receive" && branchOptions.length === 1
    ? String(branchOptions[0].id)
    : form.branch_id;

  // ดึงสต๊อกของสาขาที่เลือก — ใช้กรองสินค้าตอนออกสินค้า
  // ดึงใหม่ทั้งตอนเปลี่ยนสาขา และตอนกลับมาโฟกัสหน้าต่างนี้ (สต๊อกอาจเปลี่ยนจากหน้าอื่น)
  useEffect(() => {
    if (!branchId) return;
    const fetchStock = () => {
      api.get(`/inventory/stock/${branchId}`)
        .then((res) => setBranchStock(res.data))
        .catch(() => setBranchStock([]));
    };
    fetchStock();
    window.addEventListener("focus", fetchStock);
    return () => window.removeEventListener("focus", fetchStock);
  }, [branchId]);

  // ตอนออกสินค้าและเลือกสาขาแล้ว: แสดงเฉพาะสินค้าที่สาขานั้นมีสต๊อก > 0
  const stockByProduct = new Map(branchStock.map((s) => [String(s.product_id), Number(s.stock)]));
  const productOptions = form.type === "issue" && branchId
    ? products.filter((p) => (stockByProduct.get(String(p.id)) || 0) > 0)
    : products;

  // ถ้าสินค้าที่เลือกไว้ไม่อยู่ในรายการแล้ว (เปลี่ยนสาขา/ประเภทแล้วสต๊อกหมด) ถือว่ายังไม่ได้เลือก
  const productId = productOptions.some((p) => String(p.id) === String(form.product_id)) ? form.product_id : "";

  const flash = (text, error = false) => setMsg({ text, error });

  // ฟังก์ชัน submit ฟอร์มบันทึก transaction
  const handleSubmit = async (e) => {
    // ป้องกัน form reload หน้า
    e.preventDefault();
    try {
      // ส่ง POST request ไปตาม type ที่เลือก:
      // - form.type = "receive" → POST /api/inventory/receive (รับสินค้าเข้า)
      // - form.type = "issue"   → POST /api/inventory/issue   (ออกสินค้า)
      // ส่ง form ทั้งหมดเป็น request body (product_id, branch_id, quantity, note)
      await api.post(`/inventory/${form.type}`, { ...form, branch_id: branchId, product_id: productId });

      // แจ้งว่าบันทึกสำเร็จ
      flash("บันทึกสำเร็จ!");

      // ล้างฟอร์มกลับเป็นค่าเริ่มต้น (ตาม role — staff ยังคงล็อก type="issue" และสาขาตัวเองไว้)
      setForm(defaultFormForRole());

      // ดึงประวัติ transaction ใหม่เพื่ออัปเดตตารางด้านล่าง
      const h = await api.get("/inventory/history");
      setHistory(h.data);
    } catch (err) {
      // แสดงเหตุผลจริงจาก backend เช่น "Insufficient stock. Current: 0" แทนข้อความรวมๆ
      // ที่ทำให้ดูเหมือนไม่มีอะไรเกิดขึ้นเลย
      flash(err.response?.data?.message || "เกิดข้อผิดพลาด", true);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">รับ/ออกสินค้า</h1>

        {/* กล่องฟอร์มบันทึก transaction — admin/main_manager ใช้ฟอร์มเต็ม, staff ใช้ฟอร์มออกสินค้าอย่างเดียว */}
        {(canManage || isStaffIssueOnly) && (
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="font-bold mb-1">{isStaffIssueOnly ? "บันทึกออกสินค้า" : "บันทึกรับ/ออกสินค้า"}</h2>
          <p className="text-sm text-gray-500 mb-4">
            {isStaffIssueOnly
              ? "ใช้เมื่อของในสาขาถูกขาย ใช้ไป หรือเสียหาย — ถ้าต้องการของเพิ่ม ให้ไปที่เมนู “ใบขอเบิก”"
              : "รับเข้า = มีของมาส่งที่คลังหลัก (เช่น จากผู้ขาย) · ออกสินค้า = ของถูกใช้/ขาย/เสียหาย — การส่งของไปสาขาให้ทำผ่าน “ใบขอเบิก”"}
          </p>
          {/* แสดงข้อความผลลัพธ์เฉพาะเมื่อมีค่า — สีเขียวถ้าสำเร็จ, สีแดงถ้า error */}
          {msg.text && (
            <p className={`mb-4 font-bold ${msg.error ? "text-red-600" : "text-green-600"}`}>{msg.text}</p>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            {/* Dropdown เลือกสินค้า — ตอน "ออกสินค้า" และเลือกสาขาแล้ว จะกรองให้เหลือเฉพาะสินค้าที่สาขานั้นมีสต๊อก > 0 */}
            <div>
              <label className="block text-gray-700 mb-1">สินค้า</label>
              <ProductSearchSelect
                products={productOptions}
                value={productId}
                onChange={(id) => setForm((f) => ({ ...f, product_id: id }))}
                getExtra={form.type === "issue" && branchId
                  ? (p) => `คงเหลือ ${stockByProduct.get(String(p.id)) || 0}`
                  : undefined}
                required
              />
              {form.type === "issue" && branchId && productOptions.length === 0 && (
                <p className="text-xs text-red-500 mt-1">สาขานี้ไม่มีสินค้าที่มีสต๊อกให้เบิกออก</p>
              )}
            </div>

            {/* Dropdown เลือกสาขา — เฉพาะ admin/main_manager เท่านั้น (staff ล็อกสาขาตัวเองไว้แล้ว ไม่มีให้เลือก)
                ตอน "รับเข้า" จำกัดให้เลือกได้เฉพาะคลังหลัก (สาขาย่อยต้องรับผ่านใบขอเบิกเท่านั้น) */}
            {canManage && (
            <div>
              <label className="block text-gray-700 mb-1">สาขา</label>
              <select
                value={branchId}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                className="w-full border rounded px-3 py-2 disabled:bg-gray-100 disabled:text-gray-500"
                required
                disabled={form.type === "receive" && branchOptions.length === 1}
              >
                <option value="">เลือกสาขา</option>
                {/* ตอน receive: เฉพาะคลังหลัก, ตอน issue: ทุกสาขา (admin เห็นทุกสาขา, อื่นๆ เห็นแค่สาขาตัวเอง) */}
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              {form.type === "receive" && (
                <p className="text-xs text-gray-500 mt-1">รับสินค้าเข้าตรงได้เฉพาะคลังหลัก — สาขาย่อยรับผ่านใบขอเบิกเท่านั้น</p>
              )}
            </div>
            )}

            {/* staff: แสดงสาขา+ประเภทเป็นข้อความล็อกไว้แทน dropdown (ออกสินค้าจากสาขาตัวเองเสมอ) */}
            {isStaffIssueOnly && (
              <div>
                <label className="block text-gray-700 mb-1">สาขา</label>
                <p className="w-full border rounded px-3 py-2 bg-gray-100 text-gray-600">{user.branch_name || "-"}</p>
              </div>
            )}

            {/* Dropdown เลือกประเภท: รับเข้า หรือ ออกสินค้า — เฉพาะ admin/main_manager (staff ล็อกเป็นออกสินค้าเสมอ) */}
            {canManage && (
            <div>
              <label className="block text-gray-700 mb-1">ประเภท</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="receive">รับเข้า</option>
                <option value="issue">ออกสินค้า</option>
              </select>
            </div>
            )}
            {isStaffIssueOnly && (
              <div>
                <label className="block text-gray-700 mb-1">ประเภท</label>
                <p className="w-full border rounded px-3 py-2 bg-gray-100 text-gray-600">ออกสินค้า</p>
              </div>
            )}

            {/* ช่องกรอกจำนวน ต้องมากกว่า 0 */}
            <div>
              <label className="block text-gray-700 mb-1">จำนวน</label>
              <input
                type="number"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                className="w-full border rounded px-3 py-2"
                required
                min="1"
              />
            </div>

            {/* ช่องหมายเหตุ — ไม่บังคับกรอก ครอบ 2 คอลัมน์ */}
            <div className="col-span-2">
              <label className="block text-gray-700 mb-1">หมายเหตุ</label>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>

            <div className="col-span-2">
              <button
                type="submit"
                className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700"
              >
                บันทึก
              </button>
            </div>
          </form>
        </div>
        )}

        {/* ตารางประวัติ transaction */}
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">วันที่</th>
                <th className="p-3 text-left">สินค้า</th>
                <th className="p-3 text-left">สาขา</th>
                <th className="p-3 text-left">ประเภท</th>
                <th className="p-3 text-left">จำนวน</th>
                <th className="p-3 text-left">คงเหลือ</th>
              </tr>
            </thead>
            <tbody>
              {/* วนลูปแสดงประวัติแต่ละรายการ */}
              {history.map((h) => (
                <tr key={h.id} className="border-t">
                  {/* แปลงวันที่จาก ISO string เป็นรูปแบบไทย เช่น "5/8/2568" */}
                  <td className="p-3">{new Date(h.created_at).toLocaleDateString("th-TH")}</td>
                  <td className="p-3">{h.product_name}</td>
                  <td className="p-3">{h.branch_name}</td>

                  {/* badge สี: เขียว = รับเข้า, แดง = ออกสินค้า
                      ternary (เงื่อนไข ? ค่าถ้าจริง : ค่าถ้าเท็จ) เลือก class ตาม type */}
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-sm ${h.type === "receive" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {h.type === "receive" ? "รับเข้า" : "ออกสินค้า"}
                    </span>
                  </td>

                  {/* จำนวนที่รับเข้า/ออก */}
                  <td className="p-3">{h.quantity}</td>

                  {/* สต๊อกหลังจาก transaction นี้ (คำนวณโดย backend ตอนบันทึก) */}
                  <td className="p-3">{h.stock_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
