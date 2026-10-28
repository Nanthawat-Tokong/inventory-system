// ============================================================
// DashboardPage.jsx — ภาพรวมสต๊อก
// เดิมสร้างการ์ดทุกสินค้า × ทุกสาขา (หลายพันใบ) และกล่องแจ้งเตือนยาวหลายพันบรรทัด
// ตอนนี้: ตัวเลขสรุปด้านบน (กดเพื่อกรองได้) + ตารางที่ค้นหา/กรองสาขา/กรองสถานะ/แบ่งหน้าได้
// สถานะสต๊อกใช้ threshold เดียวกับระบบแจ้งเตือน (products.low_stock_threshold)
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../services/api";
import Pager from "../components/Pager";
import MyTasks from "../components/MyTasks";

const PAGE_SIZE = 50;

const levelOf = (row) => {
  const stock = Number(row.stock);
  if (stock <= 0) return "out";
  if (stock < Number(row.low_stock_threshold)) return "low";
  return "ok";
};
const LEVEL = {
  out: { text: "หมด",       cls: "bg-red-100 text-red-700",     num: "text-red-600" },
  low: { text: "ใกล้หมด",   cls: "bg-amber-100 text-amber-800", num: "text-amber-700" },
  ok:  { text: "ปกติ",      cls: "bg-green-100 text-green-700", num: "text-green-700" },
};

export default function DashboardPage() {
  const [stock, setStock] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [level, setLevel] = useState("");
  const [page, setPage] = useState(1);
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    api.get("/inventory/stock")
      .then((res) => { if (!cancelled) { setStock(res.data); setError(""); } })
      .catch((err) => { if (!cancelled) setError(err.response?.data?.message || "โหลดข้อมูลสต๊อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [location.key]);

  const branches = useMemo(() => [...new Map(stock.map((r) => [r.branch_id, r.branch_name])).entries()], [stock]);

  // ตัวเลขสรุป (ตามสาขาที่เลือก ถ้าเลือก)
  const summary = useMemo(() => {
    const rows = branch ? stock.filter((r) => String(r.branch_id) === branch) : stock;
    const s = { total: rows.length, out: 0, low: 0, ok: 0, units: 0 };
    rows.forEach((r) => { s[levelOf(r)]++; s.units += Math.max(0, Number(r.stock)); });
    return s;
  }, [stock, branch]);

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return stock.filter((r) => {
      if (branch && String(r.branch_id) !== branch) return false;
      if (level && levelOf(r) !== level) return false;
      if (words.length) {
        const hay = `${r.product_name} ${r.sku} ${r.category || ""}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    }).sort((a, b) => {
      // เรียงให้ของหมด/ใกล้หมดขึ้นก่อน แล้วค่อยตามชื่อ
      const order = { out: 0, low: 1, ok: 2 };
      return order[levelOf(a)] - order[levelOf(b)] || a.product_name.localeCompare(b.product_name, "th");
    });
  }, [stock, query, branch, level]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const setFilter = (fn) => (v) => { fn(v); setPage(1); };


  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6 max-w-7xl mx-auto">
        <MyTasks />
        <h2 className="text-xl font-bold mb-1">สต๊อกสินค้าตอนนี้</h2>
        <p className="text-sm text-gray-500 mb-4">กดที่กล่องตัวเลขเพื่อดูเฉพาะรายการนั้น เช่น กด “หมดสต๊อก” เพื่อดูของที่หมด</p>

        {error && <div className="bg-red-100 border border-red-400 text-red-700 p-4 rounded mb-6">⚠️ {error}</div>}

        {loading ? (
          <p>กำลังโหลด...</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card label="รายการทั้งหมด" value={summary.total} sub={`รวม ${summary.units.toLocaleString()} ชิ้น`} active={!level} onClick={() => setFilter(setLevel)("")} />
              <Card label="หมดสต๊อก" value={summary.out} tone="text-red-600" active={level === "out"} onClick={() => setFilter(setLevel)(level === "out" ? "" : "out")} />
              <Card label="ใกล้หมด (ต่ำกว่าเกณฑ์)" value={summary.low} tone="text-amber-600" active={level === "low"} onClick={() => setFilter(setLevel)(level === "low" ? "" : "low")} />
              <Card label="ปกติ" value={summary.ok} tone="text-green-600" active={level === "ok"} onClick={() => setFilter(setLevel)(level === "ok" ? "" : "ok")} />
            </div>

            <div className="bg-white rounded-lg shadow">
              <div className="flex flex-wrap gap-3 p-4 border-b">
                <input
                  type="text" value={query} onChange={(e) => setFilter(setQuery)(e.target.value)}
                  placeholder="ค้นหาชื่อสินค้า / SKU / หมวด" className="flex-1 min-w-56 border rounded px-3 py-2 text-sm"
                />
                {branches.length > 1 && (
                  <select value={branch} onChange={(e) => setFilter(setBranch)(e.target.value)} className="border rounded px-3 py-2 text-sm">
                    <option value="">ทุกสาขา</option>
                    {branches.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                  </select>
                )}
                <select value={level} onChange={(e) => setFilter(setLevel)(e.target.value)} className="border rounded px-3 py-2 text-sm">
                  <option value="">ทุกสถานะ</option>
                  <option value="out">หมด</option>
                  <option value="low">ใกล้หมด</option>
                  <option value="ok">ปกติ</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs">
                    <tr>
                      <th className="p-3 text-left">สินค้า</th>
                      <th className="p-3 text-left">หมวด</th>
                      <th className="p-3 text-left">สาขา</th>
                      <th className="p-3 text-right">คงเหลือ</th>
                      <th className="p-3 text-right">เกณฑ์ขั้นต่ำ</th>
                      <th className="p-3 text-left">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr><td colSpan={6} className="p-6 text-center text-gray-400">ไม่พบรายการ</td></tr>
                    ) : rows.map((r) => {
                      const lv = LEVEL[levelOf(r)];
                      return (
                        <tr key={`${r.product_id}-${r.branch_id}`} className="border-t hover:bg-gray-50">
                          <td className="p-3">{r.product_name} <span className="text-gray-400">({r.sku})</span></td>
                          <td className="p-3 text-gray-500">{r.category}</td>
                          <td className="p-3">{r.branch_name}</td>
                          <td className={`p-3 text-right font-bold ${lv.num}`}>{Number(r.stock).toLocaleString()} {r.unit}</td>
                          <td className="p-3 text-right text-gray-500">{r.low_stock_threshold}</td>
                          <td className="p-3"><span className={`px-2 py-0.5 rounded text-xs ${lv.cls}`}>{lv.text}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <Pager page={current} pages={pages} total={filtered.length} onPage={setPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, sub, active, onClick, tone }) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white p-4 rounded-lg shadow hover:shadow-md transition border-2 ${active ? "border-blue-500" : "border-transparent"}`}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${tone || "text-gray-800"}`}>{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </button>
  );
}
