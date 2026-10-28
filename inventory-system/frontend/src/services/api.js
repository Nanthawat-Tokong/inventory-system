// ============================================================
// api.js — ตัวกลางสำหรับติดต่อ backend server ทุก request
// ไฟล์นี้สร้าง "instance" ของ axios ที่ตั้งค่าล่วงหน้าไว้แล้ว
// ทุกหน้าใน frontend จะ import api จากไฟล์นี้แทนการ import axios โดยตรง
// ============================================================

// axios คือ library สำหรับส่ง HTTP request (เรียก API) ไปยัง backend
// เทียบได้กับการส่งจดหมายไปหา server แล้วรอรับคำตอบกลับมา
import axios from "axios";

// สร้าง axios instance พิเศษที่มีค่าเริ่มต้นตั้งไว้แล้ว
// baseURL คือ URL หลักของ backend server ทุก request จะเริ่มจากที่นี่
// เช่น api.get("/products") จะส่งไปที่ http://localhost:5000/api/products จริงๆ
const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

// interceptors.request คือ "ตัวดักจับ" ที่รันก่อน request ทุกอันจะถูกส่งออกไป
// ทำหน้าที่แนบ token (รหัสยืนยันตัวตน) เข้าไปใน header ทุกครั้งอัตโนมัติ
// ทำให้ไม่ต้องเขียน headers ซ้ำทุกครั้งที่เรียก API
api.interceptors.request.use((config) => {
  // ดึง token ที่เก็บไว้ใน localStorage (บันทึกตอน login สำเร็จ)
  const token = localStorage.getItem("token");

  // ถ้ามี token อยู่ ให้แนบเข้า header ในรูปแบบ "Bearer <token>"
  // server จะใช้ token นี้เพื่อรู้ว่าใครเป็นคนส่ง request มา
  if (token) config.headers.Authorization = `Bearer ${token}`;

  // คืน config ที่แก้ไขแล้วเพื่อส่ง request ต่อไป
  return config;
});

// interceptors.response คือ "ตัวดักจับ" ที่รันหลังได้รับ response กลับมา
// ทำหน้าที่จัดการกรณีที่ server ตอบกลับมาว่า "ไม่มีสิทธิ์" (status 401)
api.interceptors.response.use(
  // กรณีสำเร็จ: ส่ง response กลับไปตามปกติโดยไม่แก้ไขอะไร
  (res) => res,

  // กรณีเกิด error: ตรวจสอบว่าเป็น error 401 (Unauthorized = ไม่ได้ login หรือ token หมดอายุ) หรือไม่
  (err) => {
    if (err.response?.data?.code === "MUST_CHANGE_PASSWORD" && window.location.pathname !== "/account") {
      const u = JSON.parse(localStorage.getItem("user") || "{}");
      localStorage.setItem("user", JSON.stringify({ ...u, must_change_password: 1 }));
      window.location.href = "/account";
    }
    if (err.response?.status === 401) {
      // ลบ token และข้อมูล user ที่เก็บไว้ออกจาก localStorage
      // เพราะ token นี้ใช้ไม่ได้แล้ว (หมดอายุ หรือไม่ถูกต้อง)
      localStorage.removeItem("token");

      // พาผู้ใช้กลับไปหน้า login โดยอัตโนมัติ
      window.location.href = "/";
    }
    // ส่ง error ต่อไปให้โค้ดที่เรียก API จัดการเอง (เช่น แสดงข้อความผิดพลาด)
    return Promise.reject(err);
  }
);

// ส่งออก api instance นี้เพื่อให้ทุกไฟล์ import ไปใช้งาน
export default api;
