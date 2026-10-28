// ============================================================
// LoginPage.jsx — หน้าเข้าสู่ระบบ
// เป็นหน้าแรกที่ผู้ใช้เห็น ต้องกรอกอีเมลและรหัสผ่านเพื่อเข้าใช้งาน
// เมื่อ login สำเร็จ token และข้อมูล user จะถูกเก็บไว้ใน localStorage
// แล้วพาไปหน้า Dashboard โดยอัตโนมัติ
// ============================================================

// useState คือ hook (ฟังก์ชันพิเศษของ React) สำหรับเก็บข้อมูลที่เปลี่ยนแปลงได้
// เมื่อ state เปลี่ยน React จะ render หน้าใหม่อัตโนมัติ
import { useState } from "react";

// axios คือ library สำหรับส่ง HTTP request ไปยัง server
// ในหน้านี้ใช้ axios โดยตรง (ไม่ใช้ api.js) เพราะยังไม่มี token ตอน login
import axios from "axios";

export default function LoginPage() {
  // state เก็บค่าในช่องกรอกอีเมล ตอน user พิมพ์ค่าจะอัปเดตทันที
  const [email, setEmail] = useState("");

  // state เก็บค่าในช่องกรอกรหัสผ่าน
  const [password, setPassword] = useState("");

  // state เก็บข้อความ error ที่จะแสดงใต้ form ถ้า login ไม่สำเร็จ
  // ค่าเริ่มต้นเป็น string ว่าง (ไม่แสดงอะไร)
  const [error, setError] = useState("");

  // ฟังก์ชันจัดการการ submit form เมื่อกดปุ่ม "เข้าสู่ระบบ"
  // รับ parameter e (event object) เพื่อใช้ e.preventDefault()
  const handleLogin = async (e) => {
    // ป้องกันการ reload หน้าแบบปกติของ form HTML
    // ถ้าไม่ใส่บรรทัดนี้ หน้าจะ refresh ทุกครั้งที่กด submit
    e.preventDefault();
    try {
      // ส่ง POST request ไปยัง http://localhost:5000/api/auth/login
      // พร้อมส่งอีเมลและรหัสผ่านเป็น request body
      // รอรับ response กลับมา (async/await หมายความว่ารอจนได้ผลก่อนไปบรรทัดถัดไป)
      const res = await axios.post("http://localhost:5000/api/auth/login", {
        email,
        password,
      });

      // บันทึก token ลงใน localStorage เพื่อใช้ยืนยันตัวตนในทุก request ถัดไป
      // token คือ "บัตรผ่าน" ที่ server ออกให้หลัง login สำเร็จ
      localStorage.setItem("token", res.data.token);

      // บันทึกข้อมูล user เช่น ชื่อ, email, role, สาขา
      // JSON.stringify แปลง object เป็น string เพื่อเก็บใน localStorage
      localStorage.setItem("user", JSON.stringify(res.data.user));

      // พาผู้ใช้ไปหน้า Dashboard โดยใช้ window.location.href (reload หน้าใหม่)
      // ใช้แทน navigate เพื่อให้ React อ่าน token ใหม่จาก localStorage ด้วย
      window.location.href = "/dashboard";
    } catch {
      // ถ้า login ไม่สำเร็จ (เช่น อีเมลหรือรหัสผ่านผิด) แสดงข้อความแจ้งเตือน
      setError("อีเมลหรือรหัสผ่านไม่ถูกต้อง");
    }
  };

  return (
    // จัดให้อยู่กลางหน้าจอทั้งแนวตั้งและแนวนอน
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      {/* กล่อง form สีขาว กว้างสูงสุด 28rem */}
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
        <h1 className="text-2xl font-bold text-center mb-6 text-gray-800">
          ระบบจัดการสินค้าคงคลัง
        </h1>

        {/* แสดงกล่อง error สีแดงเฉพาะเมื่อมีข้อความ error (error ไม่ใช่ string ว่าง) */}
        {error && (
          <div className="bg-red-100 text-red-700 p-3 rounded mb-4">
            {error}
          </div>
        )}

        {/* form onSubmit จะเรียก handleLogin เมื่อกด submit */}
        <form onSubmit={handleLogin}>
          {/* ช่องกรอกอีเมล */}
          <div className="mb-4">
            <label className="block text-gray-700 mb-2">อีเมล</label>
            <input
              type="email"
              value={email}
              // ทุกครั้งที่พิมพ์ จะอัปเดต state email ด้วยค่าใหม่
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border rounded px-3 py-2 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          {/* ช่องกรอกรหัสผ่าน type="password" ทำให้แสดงเป็นจุดแทนตัวอักษร */}
          <div className="mb-6">
            <label className="block text-gray-700 mb-2">รหัสผ่าน</label>
            <input
              type="password"
              value={password}
              // ทุกครั้งที่พิมพ์ จะอัปเดต state password ด้วยค่าใหม่
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border rounded px-3 py-2 focus:outline-none focus:border-blue-500"
              required
            />
          </div>

          {/* ปุ่ม submit จะ trigger onSubmit ของ form */}
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            เข้าสู่ระบบ
          </button>
          <p className="text-xs text-gray-500 text-center mt-4">
            ลืมรหัสผ่าน หรือยังไม่มีบัญชี? ติดต่อผู้ดูแลระบบ (admin) ของร้าน
          </p>
        </form>
      </div>
    </div>
  );
}
