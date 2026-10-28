// ============================================================
// ProtectedRoute.jsx — component ป้องกันหน้าที่ต้อง login ก่อนเข้า
// ถ้ายังไม่ login → ไปหน้า login, ถ้า role ไม่ตรง → ไปหน้า Dashboard
//
// ตอนเปิดเว็บ (ครั้งแรกต่อการโหลดหน้า) จะดึงข้อมูลผู้ใช้ล่าสุดจาก /auth/me มาทับ localStorage
// เพราะ admin อาจเปลี่ยน role / ย้ายสาขา / ย้ายคลังหลักไปแล้ว — ไม่ต้องรอผู้ใช้ออกจากระบบแล้วเข้าใหม่
// (ฝั่ง backend ตรวจสิทธิ์จากฐานข้อมูลทุก request อยู่แล้ว อันนี้แค่ให้หน้าเว็บแสดงเมนู/ปุ่มให้ตรงกัน)
// ============================================================

import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import api from "../services/api";

let refreshed = false; // ดึง /auth/me แค่ครั้งเดียวต่อการโหลดหน้าเว็บ

export default function ProtectedRoute({ children, roles }) {
  const token = localStorage.getItem("token");
  const location = useLocation();
  const [ready, setReady] = useState(refreshed);

  useEffect(() => {
    if (refreshed || !token) return;
    api.get("/auth/me")
      .then((res) => {
        const old = JSON.parse(localStorage.getItem("user") || "{}");
        localStorage.setItem("user", JSON.stringify({ ...old, ...res.data }));
      })
      .catch(() => {}) // 401 → interceptor พาไปหน้า login เอง
      .finally(() => { refreshed = true; setReady(true); });
  }, [token]);

  if (!token) return <Navigate to="/" />;
  if (!ready) return <p className="p-6 text-gray-400">กำลังโหลด...</p>;

  const user = JSON.parse(localStorage.getItem("user") || "{}");
  // ยังไม่ได้เปลี่ยนรหัสผ่านเริ่มต้น → ต้องไปเปลี่ยนก่อน (backend ก็บล็อกคำสั่งอื่นไว้เช่นกัน)
  if (Number(user.must_change_password) === 1 && location.pathname !== "/account") return <Navigate to="/account" />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" />;

  return children;
}
