// ============================================================
// BranchesPage.jsx — หน้าจัดการสาขา
// เฉพาะ admin เท่านั้นที่เข้าหน้านี้ได้ (กำหนดใน App.jsx)
// admin สามารถเพิ่ม แก้ไข และลบสาขาได้ — ทุกที่ในระบบที่มี dropdown เลือกสาขา
// (ใบขอเบิก, มอบหมายผู้ใช้, รับ/ออกสินค้า, รายงาน ฯลฯ) ดึงจาก GET /api/branches
// อยู่แล้ว จึงเห็นสาขาใหม่ทันทีโดยไม่ต้องแก้โค้ดที่อื่น
// ใช้ฟอร์มเดียวสำหรับทั้งเพิ่มและแก้ไข โดยเปลี่ยน mode ตาม state `editing`
// ============================================================

import { useEffect, useState } from "react";

// Navbar คือแถบเมนูด้านบน
import Navbar from "../components/Navbar";

// api คือ axios instance สำหรับเรียก backend
import api from "../services/api";

// ค่าเริ่มต้นของฟอร์ม แยกออกมาเป็น constant เพื่อใช้ reset ง่ายๆ
const EMPTY_FORM = { name: "", location: "", is_warehouse: false };

export default function BranchesPage() {
  // state เก็บรายชื่อสาขาทั้งหมด
  const [branches, setBranches] = useState([]);

  // state เก็บข้อมูลที่กรอกในฟอร์ม
  const [form, setForm] = useState(EMPTY_FORM);

  // state เก็บ id ของสาขาที่กำลังแก้ไข — null = mode "เพิ่มใหม่"
  const [editing, setEditing] = useState(null);

  // state เก็บข้อความแจ้งผลลัพธ์ — { text, isError }
  const [msg, setMsg] = useState({ text: "", isError: false });

  const fetchBranches = async () => {
    // GET /api/branches — admin เห็นทุกสาขา
    const res = await api.get("/branches");
    setBranches(res.data);
  };

  useEffect(() => {
    api.get("/branches").then((res) => setBranches(res.data)).catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // ย้ายคลังหลักกระทบสิทธิ์ทั้งระบบ (ใครอนุมัติใบขอเบิก/รับสินค้าเข้าได้) จึงต้องยืนยันก่อนทุกครั้ง
    const currentWarehouse = branches.find((b) => b.is_warehouse);
    const movesWarehouse = form.is_warehouse && (!currentWarehouse || currentWarehouse.id !== editing);
    if (movesWarehouse && currentWarehouse && !confirm(
      `ยืนยันย้ายคลังหลักจาก "${currentWarehouse.name}" ไปเป็น "${form.name}"?\n\n` +
      `- "${currentWarehouse.name}" จะไม่ใช่คลังหลักอีกต่อไป\n` +
      `- การรับสินค้าเข้าและการอนุมัติใบขอเบิกจะย้ายไปอยู่ที่ "${form.name}"\n` +
      `- มีผลกับสิทธิ์ผู้ใช้ทันที`
    )) return;

    const payload = { name: form.name, location: form.location || null, is_warehouse: form.is_warehouse };
    try {
      if (editing) {
        // PUT /api/branches/:id — แก้ไขสาขาที่มีอยู่
        await api.put(`/branches/${editing}`, payload);
        setMsg({ text: "แก้ไขสาขาสำเร็จ!", isError: false });
        setEditing(null);
      } else {
        // POST /api/branches — สร้างสาขาใหม่
        await api.post("/branches", payload);
        setMsg({ text: "เพิ่มสาขาสำเร็จ!", isError: false });
      }
      setForm(EMPTY_FORM);
      await fetchBranches();
    } catch (err) {
      setMsg({ text: err.response?.data?.message || "เกิดข้อผิดพลาด", isError: true });
    }
  };

  const handleEdit = (b) => {
    setEditing(b.id);
    setForm({ name: b.name, location: b.location || "", is_warehouse: Boolean(b.is_warehouse) });
    setMsg({ text: "", isError: false });
  };

  const handleCancel = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMsg({ text: "", isError: false });
  };

  const handleDelete = async (b) => {
    // ลบแบบซ่อน: สาขาหายจากรายการ แต่ประวัติรับ/ออกสินค้าและใบขอเบิกเก่ายังอยู่ครบ
    // backend ไม่ยอมลบถ้าเป็นคลังหลัก / ยังมีผู้ใช้ในสาขา / ยังมีใบขอเบิกที่ยังไม่จบ
    if (!confirm(`ยืนยันลบสาขา "${b.name}"?\n\nสาขาจะถูกซ่อนจากระบบ แต่ประวัติรับ/ออกสินค้าและใบขอเบิกเดิมยังเก็บไว้ครบ`)) return;
    try {
      // DELETE /api/branches/:id
      await api.delete(`/branches/${b.id}`);
      await fetchBranches();
      setMsg({ text: "ลบสาขาแล้ว", isError: false });
    } catch (err) {
      setMsg({ text: err.response?.data?.message || "ไม่สามารถลบสาขาได้", isError: true });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">จัดการสาขา</h1>

        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="font-bold mb-4">{editing ? "แก้ไขสาขา" : "เพิ่มสาขาใหม่"}</h2>

          {msg.text && (
            <p className={`mb-4 ${msg.isError ? "text-red-600" : "text-green-600"}`}>{msg.text}</p>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-700 mb-1">ชื่อสาขา</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>

            <div>
              <label className="block text-gray-700 mb-1">ที่ตั้ง</label>
              <input
                type="text"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="w-full border rounded px-3 py-2"
                placeholder="ไม่บังคับ"
              />
            </div>

            {/* ตั้งเป็นคลังหลัก — มีได้แค่สาขาเดียว ติ๊กสาขานี้จะยกเลิกคลังหลักเดิมอัตโนมัติ (backend จัดการให้) */}
            <div className="col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.is_warehouse}
                  onChange={(e) => setForm({ ...form, is_warehouse: e.target.checked })}
                />
                ตั้งเป็นสาขาคลังหลัก (รับใบขอเบิกจากสาขาอื่น, รับสินค้าเข้าตรงได้เฉพาะสาขานี้)
              </label>
              {(() => {
                const current = branches.find((b) => b.is_warehouse);
                if (!form.is_warehouse || !current || current.id === editing) return null;
                return (
                  <p className="text-sm text-orange-700 bg-orange-50 rounded px-3 py-2 mt-2">
                    ⚠ ตอนนี้คลังหลักคือ "{current.name}" — ถ้าบันทึก "{current.name}" จะไม่ใช่คลังหลักอีกต่อไป (มีได้สาขาเดียว)
                  </p>
                );
              })()}
            </div>

            <div className="col-span-2 flex gap-2">
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">
                {editing ? "บันทึกการแก้ไข" : "เพิ่มสาขา"}
              </button>
              {editing && (
                <button type="button" onClick={handleCancel}
                  className="bg-gray-400 text-white px-6 py-2 rounded hover:bg-gray-500">
                  ยกเลิก
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">ชื่อสาขา</th>
                <th className="p-3 text-left">ที่ตั้ง</th>
                <th className="p-3 text-left">คลังหลัก</th>
                <th className="p-3 text-left">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {branches.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-gray-400">ยังไม่มีสาขา</td></tr>
              ) : (
                branches.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-3">{b.name}</td>
                    <td className="p-3">{b.location || "-"}</td>
                    <td className="p-3">
                      {Boolean(b.is_warehouse) && (
                        <span className="px-2 py-1 rounded text-sm bg-blue-100 text-blue-700">คลังหลัก</span>
                      )}
                    </td>
                    <td className="p-3 flex gap-2">
                      <button onClick={() => handleEdit(b)} className="bg-yellow-400 text-white px-3 py-1 rounded text-sm hover:bg-yellow-500">แก้ไข</button>
                      <button onClick={() => handleDelete(b)} className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600">ลบ</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
