// ============================================================
// BranchProductsPage.jsx — หน้ากำหนดสินค้าประจำสาขา (branch_products)
// main_manager (และ admin) เลือกสาขา แล้วติ๊กเลือกว่าสินค้าตัวไหน "เปิดใช้งาน" ให้สาขานั้นบ้าง
// สินค้าที่ไม่ได้ติ๊กไว้จะไม่แสดงในฟอร์มใบขอเบิก/รายการสินค้าของสาขานั้นอีกต่อไป (staff มองไม่เห็น)
// ไม่เกี่ยวกับสต๊อก — เป็นแค่ "สิทธิ์เห็น/ขอเบิก" สินค้าตัวนั้นของสาขา
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import api from "../services/api";

export default function BranchProductsPage() {
  const [branches, setBranches] = useState([]);
  const [branchId, setBranchId] = useState("");
  const [items, setItems] = useState([]);     // [{ product_id, name, sku, category, unit, is_active }]
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState({ text: "", error: false });

  const flash = (text, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg({ text: "", error: false }), 3500);
  };

  // โหลดรายชื่อสาขาทั้งหมดตอนเปิดหน้า (ทุกสาขา ไม่ใช่แค่สาขาตัวเอง)
  useEffect(() => {
    api.get("/branch-products/meta/branches")
      .then((res) => {
        setBranches(res.data);
        if (res.data.length > 0) { setLoading(true); setBranchId(String(res.data[0].id)); }
      })
      .catch(() => flash("โหลดรายชื่อสาขาไม่สำเร็จ", true));
  }, []);

  // โหลดสินค้าทั้งหมด + สถานะ active ของสาขาที่เลือก ทุกครั้งที่เปลี่ยนสาขา
  useEffect(() => {
    if (!branchId) return;
    api.get(`/branch-products/${branchId}`)
      .then((res) => setItems(res.data))
      .catch(() => flash("โหลดรายการสินค้าไม่สำเร็จ", true))
      .finally(() => setLoading(false));
  }, [branchId]);

  const toggle = (productId) => {
    setItems((prev) => prev.map((it) =>
      it.product_id === productId ? { ...it, is_active: it.is_active ? 0 : 1 } : it
    ));
  };

  // ค้นหา + กรองหมวด — "เลือก/ไม่เลือกทั้งหมด" มีผลเฉพาะรายการที่กำลังแสดงอยู่
  // เช่น กรองหมวด "อุปกรณ์ไอที" แล้วกด "เลือกทั้งหมด" = เปิดใช้ทั้งหมวดในคลิกเดียว
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyActive, setOnlyActive] = useState("");
  const categories = useMemo(() => [...new Set(items.map((it) => it.category).filter(Boolean))].sort(), [items]);
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      if (category && it.category !== category) return false;
      if (onlyActive === "on" && !it.is_active) return false;
      if (onlyActive === "off" && it.is_active) return false;
      const hay = `${it.name} ${it.sku} ${it.category || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [items, query, category, onlyActive]);

  const selectAll = (value) => {
    const ids = new Set(visible.map((it) => it.product_id));
    setItems((prev) => prev.map((it) => (ids.has(it.product_id) ? { ...it, is_active: value ? 1 : 0 } : it)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const product_ids = items.filter((it) => it.is_active).map((it) => it.product_id);
      await api.put(`/branch-products/${branchId}`, { product_ids });
      flash("บันทึกรายการสินค้าประจำสาขาแล้ว");
    } catch (err) {
      flash(err.response?.data?.message || "เกิดข้อผิดพลาด", true);
    } finally {
      setSaving(false);
    }
  };

  const activeCount = items.filter((it) => it.is_active).length;

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">สินค้าประจำสาขา</h1>
        <p className="text-sm text-gray-500 mb-6">
          เลือกว่าสินค้าตัวไหนเปิดใช้งานให้สาขาใด — สินค้าที่ไม่ได้เลือกจะไม่แสดงในฟอร์มใบขอเบิกและรายการสินค้าของสาขานั้น
        </p>

        {msg.text && (
          <div className={`mb-4 p-3 rounded text-sm ${msg.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            {msg.text}
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-end justify-between gap-4 mb-4">
            <div className="flex-1">
              <label className="block text-gray-700 mb-1">สาขา</label>
              <select
                value={branchId}
                onChange={(e) => { setLoading(true); setBranchId(e.target.value); }}
                className="w-full border rounded px-3 py-2"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}{b.is_warehouse ? " (คลังหลัก)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-sm text-gray-500 whitespace-nowrap">
              เปิดใช้งาน {activeCount} / {items.length} รายการ
            </div>
          </div>

          {loading ? (
            <p className="text-gray-400 text-sm py-6 text-center">กำลังโหลด...</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                  placeholder="ค้นหาชื่อสินค้า / SKU" className="flex-1 min-w-48 border rounded px-3 py-2 text-sm"
                />
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded px-3 py-2 text-sm">
                  <option value="">ทุกหมวด</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <select value={onlyActive} onChange={(e) => setOnlyActive(e.target.value)} className="border rounded px-3 py-2 text-sm">
                  <option value="">ทั้งเปิด/ปิด</option>
                  <option value="on">เฉพาะที่เปิดใช้</option>
                  <option value="off">เฉพาะที่ปิดอยู่</option>
                </select>
              </div>
              <div className="flex gap-3 mb-2 text-sm items-center">
                <span className="text-gray-500">แสดง {visible.length} รายการ:</span>
                <button type="button" onClick={() => selectAll(true)} className="text-blue-600 hover:underline">
                  เลือกทั้งหมดที่แสดง
                </button>
                <button type="button" onClick={() => selectAll(false)} className="text-gray-500 hover:underline">
                  ไม่เลือกทั้งหมดที่แสดง
                </button>
              </div>

              <div className="border rounded divide-y max-h-[28rem] overflow-y-auto">
                {visible.length === 0 ? (
                  <p className="text-gray-400 text-sm p-4 text-center">{items.length === 0 ? "ยังไม่มีสินค้าในแคตตาล็อก" : "ไม่พบสินค้าที่ตรงกับตัวกรอง"}</p>
                ) : (
                  visible.map((it) => (
                    <label key={it.product_id} className="flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(it.is_active)}
                        onChange={() => toggle(it.product_id)}
                        className="w-4 h-4"
                      />
                      <div className="flex-1">
                        <span className="font-medium">{it.name}</span>{" "}
                        <span className="text-gray-400 text-sm">({it.sku})</span>
                      </div>
                      <span className="text-sm text-gray-500">{it.category}</span>
                      <span className="text-sm text-gray-400 w-16 text-right">{it.unit}</span>
                    </label>
                  ))
                )}
              </div>

              <button
                onClick={handleSave}
                disabled={saving || items.length === 0}
                className="mt-4 bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
