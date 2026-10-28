// ============================================================
// AccountPage.jsx — บัญชีของฉัน / เปลี่ยนรหัสผ่าน
// ทุกคนเปลี่ยนรหัสของตัวเองได้ ถ้าบัญชีถูกตั้งให้ "ต้องเปลี่ยนรหัส" (admin เพิ่งสร้าง/รีเซ็ต
// หรือยังใช้รหัสเริ่มต้น) ระบบจะพามาหน้านี้ก่อนเสมอ และใช้หน้าอื่นไม่ได้จนกว่าจะเปลี่ยน
// ============================================================

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../services/api";
import { ROLE_LABEL } from "../utils/labels";

export default function AccountPage() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const forced = Number(user.must_change_password) === 1;
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [msg, setMsg] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);

  const problems = [];
  if (form.next && form.next.length < 8) problems.push("รหัสใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
  if (form.next && form.current && form.next === form.current) problems.push("รหัสใหม่ต้องไม่ซ้ำรหัสเดิม");
  if (form.confirm && form.next !== form.confirm) problems.push("ช่อง “ยืนยันรหัสใหม่” ไม่ตรงกับรหัสใหม่");

  const submit = async (e) => {
    e.preventDefault();
    if (problems.length || !form.current || !form.next || !form.confirm) return;
    setBusy(true);
    try {
      const res = await api.put("/auth/password", { current_password: form.current, new_password: form.next });
      localStorage.setItem("user", JSON.stringify({ ...user, must_change_password: 0 }));
      setMsg({ text: res.data.message, error: false });
      setForm({ current: "", next: "", confirm: "" });
      if (forced) setTimeout(() => navigate("/dashboard"), 1200);
    } catch (err) {
      setMsg({ text: err.response?.data?.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ", error: true });
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, auto) => (
    <div>
      <label className="block text-gray-700 mb-1">{label}</label>
      <input
        type={show ? "text" : "password"} value={form[key]} autoComplete={auto}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full border rounded px-3 py-2" required
      />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6 max-w-lg mx-auto">
        <h1 className="text-2xl font-bold mb-4">บัญชีของฉัน</h1>

        {forced && (
          <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-4 mb-4">
            <b>กรุณาตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน</b>
            <p className="text-sm mt-1">บัญชีนี้ยังใช้รหัสผ่านที่ผู้ดูแลระบบตั้งให้ — เปลี่ยนเป็นรหัสของคุณเอง เพื่อไม่ให้คนอื่นใช้บัญชีคุณได้</p>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-5 mb-4 text-sm">
          <div className="grid grid-cols-3 gap-y-1">
            <span className="text-gray-500">ชื่อ</span><span className="col-span-2">{user.name}</span>
            <span className="text-gray-500">อีเมล</span><span className="col-span-2">{user.email}</span>
            <span className="text-gray-500">บทบาท</span><span className="col-span-2">{ROLE_LABEL[user.role] || user.role}</span>
            <span className="text-gray-500">สาขา</span><span className="col-span-2">{user.branch_name || "-"}</span>
          </div>
        </div>

        <form onSubmit={submit} className="bg-white rounded-lg shadow p-5 space-y-3">
          <h2 className="font-bold">เปลี่ยนรหัสผ่าน</h2>
          {msg.text && <p className={`text-sm p-2 rounded ${msg.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>{msg.text}</p>}
          {field("current", "รหัสผ่านปัจจุบัน", "current-password")}
          {field("next", "รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)", "new-password")}
          {field("confirm", "ยืนยันรหัสผ่านใหม่ (พิมพ์ซ้ำอีกครั้ง)", "new-password")}
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> แสดงรหัสผ่าน
          </label>
          {problems.length > 0 && <ul className="text-sm text-red-600 list-disc pl-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <button
            type="submit" disabled={busy || problems.length > 0}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
          </button>
        </form>
      </div>
    </div>
  );
}
