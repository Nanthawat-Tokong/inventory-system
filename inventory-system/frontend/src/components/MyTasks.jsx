// ============================================================
// MyTasks.jsx — กล่อง "งานของคุณวันนี้" บนหน้าแรก
// บอกผู้ใช้ทุกบทบาทว่า "ตอนนี้ต้องทำอะไร" เป็นปุ่มใหญ่ กดแล้วไปหน้านั้นทันที
// ไม่ต้องรู้ว่าระบบมีเมนูอะไรบ้าง
// ============================================================

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import { roleOf } from "../utils/labels";

const INTRO = {
  approver: "คุณเป็นผู้อนุมัติของคลังหลัก — ตรวจใบขอเบิกจากสาขา อนุมัติ/ปฏิเสธ และตอบกลับเมื่อสาขาแจ้งปัญหา",
  shipper: "คุณเป็นพนักงานจัดส่งของคลังหลัก — จัดส่งใบขอเบิกที่ผู้จัดการอนุมัติแล้ว และส่งของชดเชย",
  branch: "คุณเป็นพนักงานสาขา — ขอเบิกของจากคลังหลัก ตรวจรับของเมื่อมาถึง และแจ้งถ้าของชำรุด",
};

export default function MyTasks() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const role = roleOf(user);
  const [rows, setRows] = useState(null);

  useEffect(() => {
    api.get("/requisitions").then((res) => setRows(res.data)).catch(() => setRows([]));
  }, []);

  const count = (fn) => (rows || []).filter(fn).length;
  const tasks = {
    approver: [
      { icon: "✅", title: "ใบขอเบิกรออนุมัติ", n: count((r) => r.status === "pending"), to: "/requisitions?filter=action", hint: "เปิดดูว่าสาขาขออะไร แล้วกดอนุมัติหรือปฏิเสธ" },
      { icon: "⚠️", title: "สาขาแจ้งปัญหา รอคุณตอบ", n: count((r) => r.status === "disputed" && r.dispute_state === "awaiting_response"), to: "/requisitions?filter=disputed", hint: "ของชำรุด/ไม่ครบ — เลือกส่งใหม่ หรือแจ้งว่าของยังไม่พอ" },
      { icon: "📥", title: "รับของเข้าคลัง", to: "/inventory", hint: "บันทึกเมื่อมีของมาส่งที่คลังหลัก" },
      { icon: "📋", title: "ของที่ควรสั่งเพิ่ม", to: "/reports?tab=reorder", hint: "ดูรายการที่ใกล้หมด พร้อมจำนวนที่แนะนำให้สั่ง" },
    ],
    shipper: [
      { icon: "🚚", title: "ใบขอเบิกรอจัดส่ง", n: count((r) => r.status === "approved"), to: "/requisitions?filter=action", hint: "จัดของตามรายการ แล้วกด “ยืนยันจัดส่ง”" },
      { icon: "🔁", title: "ของชดเชยรอส่ง", n: count((r) => r.status === "disputed" && r.preparing_replacements > 0), to: "/requisitions?filter=disputed", hint: "ส่งของแทนชิ้นที่ชำรุด/ขาดให้สาขา" },
    ],
    branch: [
      { icon: "➕", title: "ขอเบิกของจากคลังหลัก", to: "/requisitions?new=1", hint: "เลือกสินค้าและจำนวน แล้วกดส่ง" },
      { icon: "📦", title: "ของมาถึงแล้ว รอตรวจรับ", n: count((r) => r.status === "shipped" || (r.status === "disputed" && r.shipped_replacements > 0)), to: "/requisitions?filter=action", hint: "นับของ แยกชิ้นดี/ชิ้นชำรุด แล้วกดยืนยัน" },
      { icon: "💬", title: "คลังหลักขอปิดเคส / ใบถูกปฏิเสธ", n: count((r) => r.status === "rejected" || r.dispute_state === "close_proposed"), to: "/requisitions?filter=action", hint: "อ่านเหตุผล แล้วยืนยันหรือแก้ไขส่งใหม่" },
      { icon: "🧾", title: "ของที่ฉันเบิก / ยังรออยู่", n: count((r) => ["pending", "approved", "shipped"].includes(r.status)), to: "/reports?tab=by-user", hint: "ดูว่าเบิกอะไรไปเท่าไร ได้รับแล้วกี่ชิ้น ยังรออีกกี่ชิ้น" },
    ],
  }[role];

  return (
    <div className="mb-6">
      <h2 className="text-lg font-bold mb-1">สวัสดี {user.name} 👋</h2>
      <p className="text-sm text-gray-600 mb-3">{INTRO[role]}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {tasks.map((t) => {
          const urgent = t.n > 0;
          return (
            <Link
              key={t.title}
              to={t.to}
              className={`block bg-white rounded-lg shadow p-4 border-2 hover:shadow-md transition ${urgent ? "border-red-400" : "border-transparent"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-2xl">{t.icon}</span>
                {t.n !== undefined && (
                  <span className={`text-2xl font-bold ${urgent ? "text-red-600" : "text-gray-300"}`}>{rows ? t.n : "…"}</span>
                )}
              </div>
              <div className="font-semibold mt-1">{t.title}</div>
              <div className="text-xs text-gray-500 mt-1">{t.n === 0 ? "ไม่มีงานค้าง 👍" : t.hint}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
