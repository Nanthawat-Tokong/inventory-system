// ============================================================
// Navbar.jsx — แถบเมนูด้านบน
// - แสดงเฉพาะเมนูที่บทบาทนั้นใช้ได้ เรียงตามงานที่ใช้บ่อยของแต่ละบทบาท
// - เมนูที่เปิดอยู่จะเป็นสีเข้ม (รู้ว่าอยู่หน้าไหน)
// - ตัวเลขสีแดงบน "ใบขอเบิก" = จำนวนใบที่รอคุณดำเนินการ
// - จอเล็ก (มือถือ) กดปุ่ม ☰ เพื่อเปิดเมนู
// ============================================================

import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import api from "../services/api";
import { ROLE_LABEL } from "../utils/labels";


// เมนูทั้งหมด: [path, ชื่อ, บทบาทที่เห็น]
const MENU = [
  ["/dashboard", "หน้าแรก", ["admin", "main_manager", "staff", "shipper"]],
  ["/requisitions", "ใบขอเบิก", ["admin", "main_manager", "staff", "shipper"]],
  ["/inventory", "รับ/ออกสินค้า", ["admin", "main_manager", "staff", "shipper"]],
  ["/products", "สินค้า", ["admin", "main_manager", "staff", "shipper"]],
  ["/reports", "รายงาน", ["admin", "main_manager", "staff", "shipper"]],
  ["/alerts", "ตั้งค่าแจ้งเตือน", ["admin", "main_manager"]],
  ["/branch-products", "สินค้าประจำสาขา", ["admin", "main_manager"]],
  ["/users", "ผู้ใช้งาน", ["admin"]],
  ["/branches", "สาขา", ["admin"]],
  ["/help", "❓ วิธีใช้", ["admin", "main_manager", "staff", "shipper"]],
];

export default function Navbar() {
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const [open, setOpen] = useState(false);

  // จำนวนใบขอเบิกที่รอเราดำเนินการ — อัปเดตทุก 60 วินาที และทันทีเมื่อหน้าใบขอเบิกส่ง event
  const [actionCount, setActionCount] = useState(0);
  useEffect(() => {
    const load = () => api.get("/requisitions/meta/action-count")
      .then((res) => setActionCount(res.data.count))
      .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener("requisitions-changed", load);
    return () => { clearInterval(timer); window.removeEventListener("requisitions-changed", load); };
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/");
  };

  const mustChange = Number(user.must_change_password) === 1;
  const items = mustChange ? [] : MENU.filter(([, , roles]) => roles.includes(user.role));
  const linkCls = ({ isActive }) =>
    `relative px-3 py-2 rounded whitespace-nowrap ${isActive ? "bg-blue-800 font-semibold" : "hover:bg-blue-500"}`;

  return (
    <nav className="bg-blue-600 text-white px-4 py-2">
      <div className="flex items-center justify-between gap-4">
        <Link to="/dashboard" className="font-bold text-lg whitespace-nowrap">📦 ระบบสินค้าคงคลัง</Link>

        <div className="hidden lg:flex items-center gap-1 flex-wrap flex-1">
          {items.map(([to, label]) => (
            <NavLink key={to} to={to} className={linkCls}>
              {label}
              {to === "/requisitions" && actionCount > 0 && <Badge n={actionCount} />}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link to="/account" className="hidden sm:block text-right leading-tight hover:underline" title="บัญชีของฉัน / เปลี่ยนรหัสผ่าน">
            <div className="text-sm font-medium">👤 {user.name}</div>
            <div className="text-xs text-blue-100">
              {ROLE_LABEL[user.role] || user.role}{user.branch_name ? ` · ${user.branch_name}` : ""}
            </div>
          </Link>
          <button onClick={handleLogout} className="bg-white text-blue-600 px-3 py-1 rounded text-sm hover:bg-gray-100 whitespace-nowrap">
            ออกจากระบบ
          </button>
          <button onClick={() => setOpen((v) => !v)} className="lg:hidden text-2xl px-2 relative" aria-label="เปิดเมนู">
            ☰{actionCount > 0 && <Badge n={actionCount} />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden flex flex-col gap-1 mt-2 pb-2">
          <NavLink to="/account" className={linkCls} onClick={() => setOpen(false)}>👤 บัญชีของฉัน / เปลี่ยนรหัสผ่าน</NavLink>
          {items.map(([to, label]) => (
            <NavLink key={to} to={to} className={linkCls} onClick={() => setOpen(false)}>
              {label}
              {to === "/requisitions" && actionCount > 0 && <span className="ml-2 bg-red-500 rounded-full px-2 text-xs">{actionCount} รอคุณ</span>}
            </NavLink>
          ))}
        </div>
      )}
    </nav>
  );
}

function Badge({ n }) {
  return (
    <span
      className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full min-w-5 h-5 px-1 flex items-center justify-center"
      title={`มี ${n} ใบที่รอคุณดำเนินการ`}
    >
      {n}
    </span>
  );
}
