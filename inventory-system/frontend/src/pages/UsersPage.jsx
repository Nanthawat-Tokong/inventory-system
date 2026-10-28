// ============================================================
// UsersPage.jsx — หน้าจัดการผู้ใช้งาน
// เฉพาะ admin เท่านั้นที่เข้าหน้านี้ได้ (กำหนดใน App.jsx)
// admin สามารถเพิ่ม แก้ไข และลบบัญชีผู้ใช้งานได้
// ใช้ฟอร์มเดียวสำหรับทั้งเพิ่มและแก้ไข โดยเปลี่ยน mode ตาม state `editing`
// เมื่อแก้ไข password ช่อง password เป็น optional — ถ้าเว้นว่าง password เดิมยังใช้ได้
// ============================================================

// useEffect ใช้ดึงข้อมูล users และ branches ตอนโหลดหน้า
// useState ใช้เก็บข้อมูลต่างๆ
import { useEffect, useState } from "react";

// Navbar คือแถบเมนูด้านบน
import Navbar from "../components/Navbar";

// api คือ axios instance สำหรับเรียก backend
import api from "../services/api";

// ค่าเริ่มต้นของฟอร์ม แยกออกมาเป็น constant เพื่อใช้ reset ง่ายๆ
const EMPTY_FORM = { name: "", email: "", password: "", role: "staff", branch_id: "" };

export default function UsersPage() {
  // state เก็บรายชื่อผู้ใช้งานทั้งหมด
  // แต่ละ user มี: id, name, email, role, branch_id, branch_name
  const [users, setUsers] = useState([]);

  // state เก็บรายชื่อสาขาสำหรับ dropdown "เลือกสาขา" ในฟอร์ม
  const [branches, setBranches] = useState([]);

  // state เก็บข้อมูลที่กรอกในฟอร์ม (ผูกกับ input แต่ละช่อง)
  const [form, setForm] = useState(EMPTY_FORM);

  // state เก็บ id ของ user ที่กำลังแก้ไข
  // null = mode "เพิ่มใหม่", มีค่า = mode "แก้ไข"
  const [editing, setEditing] = useState(null);

  // state เก็บข้อความแจ้งผลลัพธ์
  // { text: "...", isError: true/false } — isError กำหนดว่าจะแสดงสีแดงหรือเขียว
  const [msg, setMsg] = useState({ text: "", isError: false });

  // ฟังก์ชันดึงข้อมูล users และ branches พร้อมกัน
  const fetchData = async () => {
    // Promise.all ส่ง 2 request พร้อมกันเพื่อประหยัดเวลา
    const [u, b] = await Promise.all([
      // GET /api/users — ดึงรายชื่อ user ทั้งหมด พร้อม branch_name จาก JOIN
      api.get("/users"),
      // GET /api/branches — ดึงรายชื่อสาขาสำหรับ dropdown
      api.get("/branches"),
    ]);
    setUsers(u.data);
    setBranches(b.data);
  };

  // useEffect รันครั้งเดียวตอนโหลดหน้า ([] = ไม่มี dependency)
  useEffect(() => {
    Promise.all([api.get("/users"), api.get("/branches")])
      .then(([u, b]) => { setUsers(u.data); setBranches(b.data); })
      .catch(() => {});
  }, []);

  // ฟังก์ชัน submit ฟอร์ม ทำงานเมื่อกดปุ่ม "เพิ่มผู้ใช้" หรือ "บันทึกการแก้ไข"
  const handleSubmit = async (e) => {
    // ป้องกัน form reload หน้า
    e.preventDefault();
    try {
      if (editing) {
        // mode "แก้ไข": คัดลอก form ทั้งหมดแล้วตรวจสอบ password
        const payload = { ...form };

        // ถ้าช่อง password ว่างเปล่า ลบ key password ออกจาก payload
        // backend จะ skip การ hash password ถ้าไม่ได้ส่ง password มา
        if (!payload.password) delete payload.password;

        // PUT /api/users/:id — อัปเดตข้อมูล user ตาม id
        await api.put(`/users/${editing}`, payload);
        setMsg({ text: "แก้ไขผู้ใช้สำเร็จ!", isError: false });
        // ล้าง editing กลับเป็น null เพื่อกลับสู่ mode "เพิ่มใหม่"
        setEditing(null);
      } else {
        // mode "เพิ่มใหม่": ส่ง form ทั้งหมดรวมถึง password (บังคับกรอก)
        // POST /api/users — สร้าง user ใหม่ backend จะ hash password ก่อนบันทึก
        await api.post("/users", form);
        setMsg({ text: "เพิ่มผู้ใช้สำเร็จ!", isError: false });
      }
      // ล้างฟอร์มกลับเป็นค่าเริ่มต้น
      setForm(EMPTY_FORM);
      // ดึงข้อมูล users ใหม่เพื่ออัปเดตตาราง
      fetchData();
    } catch (err) {
      // ดึงข้อความ error จาก server (เช่น "Email already exists")
      const detail = err.response?.data?.message || "เกิดข้อผิดพลาด";
      setMsg({ text: detail, isError: true });
    }
  };

  // ฟังก์ชันโหลดข้อมูล user ที่ต้องการแก้ไขเข้าฟอร์ม
  // รับ u = object ของ user ที่กดปุ่มแก้ไข
  const handleEdit = (u) => {
    // บันทึก id ของ user ที่จะแก้ไข
    setEditing(u.id);
    // เติมข้อมูลเข้าฟอร์ม ยกเว้น password (ให้ว่างไว้เพื่อความปลอดภัย)
    setForm({ name: u.name, email: u.email, password: "", role: u.role, branch_id: u.branch_id || "" });
    // ล้างข้อความแจ้งเตือนเก่า
    setMsg({ text: "", isError: false });
  };

  // ฟังก์ชันยกเลิกการแก้ไข กลับสู่ mode "เพิ่มใหม่"
  const handleCancel = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMsg({ text: "", isError: false });
  };

  // ฟังก์ชันลบ user รับ id ของ user ที่ต้องการลบ
  const handleDelete = async (id) => {
    // ขอ confirm ก่อนลบ ถ้ากด "ยกเลิก" จะหยุดทำงาน
    if (!confirm("ยืนยันลบผู้ใช้?")) return;
    try {
      // DELETE /api/users/:id — ลบ user ตาม id ออกจาก database
      await api.delete(`/users/${id}`);
      // ดึงรายชื่อ user ใหม่เพื่ออัปเดตตาราง
      fetchData();
    } catch (err) {
      setMsg({ text: err.response?.data?.message || "ไม่สามารถลบผู้ใช้ได้", isError: true });
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-6">จัดการผู้ใช้งาน</h1>

        {/* กล่องฟอร์ม เปลี่ยนหัวข้อตาม mode */}
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          {/* editing มีค่า = แก้ไข, editing เป็น null = เพิ่มใหม่ */}
          <h2 className="font-bold mb-4">{editing ? "แก้ไขผู้ใช้" : "เพิ่มผู้ใช้ใหม่"}</h2>

          {/* แสดงข้อความผลลัพธ์: สีแดงถ้า error, สีเขียวถ้าสำเร็จ */}
          {msg.text && (
            <p className={`mb-4 ${msg.isError ? "text-red-600" : "text-green-600"}`}>{msg.text}</p>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-4">
            {/* ช่องชื่อผู้ใช้ */}
            <div>
              <label className="block text-gray-700 mb-1">ชื่อ</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>

            {/* ช่องอีเมล (ต้องไม่ซ้ำกันในระบบ) */}
            <div>
              <label className="block text-gray-700 mb-1">อีเมล</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border rounded px-3 py-2"
                required
              />
            </div>

            {/* ช่อง password:
                - ตอนเพิ่มใหม่: required (บังคับกรอก)
                - ตอนแก้ไข: ไม่บังคับ ถ้าเว้นว่างจะไม่เปลี่ยน password เดิม */}
            <div>
              <label className="block text-gray-700 mb-1">
                รหัสผ่าน
                {/* แสดง hint เฉพาะตอน edit mode เพื่อบอก user ว่าเว้นว่างได้ */}
                {editing && <span className="text-gray-400 text-sm ml-1">(เว้นว่างไว้ถ้าไม่ต้องการเปลี่ยน)</span>}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full border rounded px-3 py-2"
                // required เป็น false ตอน editing (ไม่บังคับ), true ตอนเพิ่มใหม่
                required={!editing}
                minLength={8}
                placeholder={editing ? "เว้นว่าง = ไม่เปลี่ยนรหัสผ่าน" : "อย่างน้อย 8 ตัวอักษร"}
              />
            </div>

            {/* Dropdown เลือก role */}
            <div>
              <label className="block text-gray-700 mb-1">สิทธิ์</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="staff">พนักงาน</option>
                <option value="shipper">พนักงานจัดส่ง (คลังหลัก)</option>
                <option value="main_manager">ผู้จัดการสาขาหลัก</option>
                <option value="admin">Admin</option>
              </select>
              {form.role === "shipper" && (
                <p className="text-xs text-gray-500 mt-1">จัดส่งใบขอเบิกที่อนุมัติแล้ว + ส่งของชดเชย — ต้องสังกัดสาขาคลังหลัก</p>
              )}
            </div>

            {/* Dropdown เลือกสาขา ครอบ 2 คอลัมน์ */}
            <div className="col-span-2">
              <label className="block text-gray-700 mb-1">สาขา</label>
              <select
                value={form.branch_id}
                onChange={(e) => setForm({ ...form, branch_id: e.target.value })}
                className="w-full border rounded px-3 py-2"
              >
                <option value="">เลือกสาขา</option>
                {/* วนลูปแสดงสาขาทั้งหมดจาก state branches */}
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* ปุ่ม submit + ปุ่มยกเลิก (เฉพาะ edit mode) */}
            <div className="col-span-2 flex gap-2">
              <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700">
                {editing ? "บันทึกการแก้ไข" : "เพิ่มผู้ใช้"}
              </button>
              {/* ปุ่มยกเลิกแสดงเฉพาะตอนแก้ไข */}
              {editing && (
                <button type="button" onClick={handleCancel}
                  className="bg-gray-400 text-white px-6 py-2 rounded hover:bg-gray-500">
                  ยกเลิก
                </button>
              )}
            </div>
          </form>
        </div>

        {/* ตารางแสดงรายชื่อ user ทั้งหมด */}
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-3 text-left">ชื่อ</th>
                <th className="p-3 text-left">อีเมล</th>
                <th className="p-3 text-left">สิทธิ์</th>
                <th className="p-3 text-left">สาขา</th>
                <th className="p-3 text-left">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-3">{u.name}</td>
                  <td className="p-3">{u.email}</td>

                  {/* badge สี แสดง role ด้วยสีที่ต่างกัน:
                      แดง = admin, เหลือง = main_manager, เขียว = staff */}
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-sm ${
                      u.role === "admin" ? "bg-red-100 text-red-700" :
                      u.role === "main_manager" ? "bg-yellow-100 text-yellow-700" :
                      u.role === "shipper" ? "bg-indigo-100 text-indigo-700" :
                      "bg-green-100 text-green-700"
                    }`}>
                      {u.role === "admin" ? "Admin" : u.role === "main_manager" ? "ผู้จัดการสาขาหลัก" : u.role === "shipper" ? "พนักงานจัดส่ง" : "พนักงาน"}
                    </span>
                  </td>

                  {/* แสดงชื่อสาขา ถ้าไม่มี branch_name แสดง "-" (เช่น admin ไม่สังกัดสาขา) */}
                  <td className="p-3">{u.branch_name || "-"}</td>

                  <td className="p-3 flex gap-2">
                    {/* ปุ่มแก้ไข: โหลดข้อมูล user นี้เข้าฟอร์ม */}
                    <button onClick={() => handleEdit(u)} className="bg-yellow-400 text-white px-3 py-1 rounded text-sm hover:bg-yellow-500">แก้ไข</button>
                    {/* ปุ่มลบ: ขอ confirm ก่อนลบ */}
                    <button onClick={() => handleDelete(u.id)} className="bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600">ลบ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
