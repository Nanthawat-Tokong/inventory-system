// ============================================================
// ReportPage.jsx — รายงานสินค้าคงคลัง
// เลือกช่วงวันที่ + สาขา (เฉพาะฝั่งคลังหลัก) แล้วดู 5 รายงาน:
//   ภาพรวม           ตัวเลขสำคัญ + กราฟรับเข้า/ออกรายวัน + สถานะสต๊อก + ใบขอเบิก
//   ความเคลื่อนไหว    ยกมา → รับเข้า → ออก → คงเหลือ ต่อสินค้า (stock card แบบสรุป)
//   ออกมาก/ค้างสต๊อก  สินค้าที่ออกมากที่สุด และสินค้าที่มีของแต่ไม่เคลื่อนไหวเลย
//   ควรสั่งเพิ่ม      ต่ำกว่าเกณฑ์ / ใกล้หมด พร้อมจำนวนวันที่พอใช้และจำนวนที่แนะนำ
//   ใบขอเบิก          ได้ของครบกี่ %, ชำรุด, ใช้เวลาอนุมัติ/ปิดงานเฉลี่ย, สินค้าที่คลังไม่มีให้
// ทุกตารางส่งออกเป็น CSV (เปิดด้วย Excel ได้ ภาษาไทยไม่เพี้ยน)
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Navbar from "../components/Navbar";
import Pager from "../components/Pager";
import api from "../services/api";

// สีชุดข้อมูล (categorical slot 1–2 จาก palette ที่ผ่านการตรวจตาบอดสีแล้ว) — รับเข้า = น้ำเงิน, ออก = ส้ม
const C_IN = "#2a78d6";
const C_OUT = "#eb6834";

const TABS = [
  ["summary", "ภาพรวม"],
  ["movement", "ความเคลื่อนไหวสต๊อก"],
  ["top", "ออกมาก / ค้างสต๊อก"],
  ["reorder", "ควรสั่งเพิ่ม"],
  ["requisitions", "ใบขอเบิก"],
  ["by-user", "การเบิกรายคน"],
];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const PRESETS = [
  ["7 วัน", () => [addDays(new Date(), -6), new Date()]],
  ["30 วัน", () => [addDays(new Date(), -29), new Date()]],
  ["90 วัน", () => [addDays(new Date(), -89), new Date()]],
  ["เดือนนี้", () => { const t = new Date(); return [new Date(t.getFullYear(), t.getMonth(), 1), t]; }],
  ["เดือนก่อน", () => { const t = new Date(); return [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)]; }],
];
const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString("th-TH"));
const thDate = (s) => new Date(s).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });

// ส่งออก CSV — ใส่ BOM ให้ Excel อ่านภาษาไทยถูก
const downloadCsv = (filename, headers, rows) => {
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [headers.map((h) => esc(h[0])).join(","), ...rows.map((r) => headers.map((h) => esc(h[1](r))).join(","))].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

export default function ReportPage() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const isWarehouseSide = user.role === "admin" || (user.role === "main_manager" && Number(user.is_warehouse) === 1);

  // เปิดแท็บตรงได้ด้วย /reports?tab=reorder (เช่น ทำ bookmark ไว้)
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return TABS.some(([k]) => k === t) ? t : "summary";
  });
  const [from, setFrom] = useState(ymd(addDays(new Date(), -29)));
  const [to, setTo] = useState(ymd(new Date()));
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isWarehouseSide) return;
    api.get("/branch-products/meta/branches").then((res) => setBranches(res.data)).catch(() => {});
  }, [isWarehouseSide]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from, to });
    if (branchId) params.set("branch_id", branchId);
    api.get(`/reports/${tab}?${params}`)
      .then((res) => { if (!cancelled) { setData(res.data); setError(""); } })
      .catch((err) => { if (!cancelled) { setData(null); setError(err.response?.data?.message || "โหลดรายงานไม่สำเร็จ"); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [tab, from, to, branchId]);

  // ทุกครั้งที่เปลี่ยนตัวกรอง แสดง "กำลังโหลด" ก่อน effect ด้านบนดึงข้อมูลใหม่
  const change = (fn) => (v) => { setLoading(true); fn(v); };
  const applyPreset = (get) => { const [a, b] = get(); setLoading(true); setFrom(ymd(a)); setTo(ymd(b)); };

  const branchName = branchId ? branches.find((b) => String(b.id) === branchId)?.name : (isWarehouseSide ? "ทุกสาขา" : user.branch_name);
  const fileTag = `${from}_${to}${branchId ? `_${branchName}` : ""}`;

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="print:hidden"><Navbar /></div>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex flex-wrap justify-between items-end gap-2 mb-4">
          <div>
            <h1 className="text-2xl font-bold">รายงานสินค้าคงคลัง</h1>
            <p className="text-sm text-gray-500">{branchName} · {thDate(from)} – {thDate(to)}</p>
          </div>
          <button onClick={() => window.print()} className="print:hidden text-sm border bg-white px-3 py-1.5 rounded hover:bg-gray-50">🖨 พิมพ์</button>
        </div>

        {/* ตัวกรอง — แถวเดียวเหนือรายงาน */}
        <div className="bg-white p-4 rounded-lg shadow mb-4 flex flex-wrap items-end gap-3 print:hidden">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(([label, get]) => (
              <button key={label} onClick={() => applyPreset(get)} className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50">{label}</button>
            ))}
          </div>
          <label className="text-sm">ตั้งแต่<input type="date" value={from} max={to} onChange={(e) => change(setFrom)(e.target.value)} className="block border rounded px-2 py-1" /></label>
          <label className="text-sm">ถึง<input type="date" value={to} min={from} onChange={(e) => change(setTo)(e.target.value)} className="block border rounded px-2 py-1" /></label>
          {isWarehouseSide && (
            <label className="text-sm">สาขา
              <select value={branchId} onChange={(e) => change(setBranchId)(e.target.value)} className="block border rounded px-2 py-1">
                <option value="">ทุกสาขา</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}{b.is_warehouse ? " (คลังหลัก)" : ""}</option>)}
              </select>
            </label>
          )}
        </div>

        <div className="flex flex-wrap gap-1 mb-4 border-b print:hidden">
          {TABS.map(([key, label]) => [key, key === "by-user" && user.role === "staff" ? "การเบิกของฉัน" : label]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { if (key !== tab) { setLoading(true); setTab(key); } }}
              className={`px-4 py-2 text-sm -mb-px border-b-2 ${tab === key ? "border-blue-600 text-blue-700 font-medium" : "border-transparent text-gray-600 hover:text-gray-900"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && <div className="bg-red-100 text-red-700 p-3 rounded mb-4">{error}</div>}
        {loading || !data ? (
          !error && <p className="text-gray-500">กำลังโหลด...</p>
        ) : (
          <>
            {tab === "summary" && <SummaryReport d={data} />}
            {tab === "movement" && <MovementReport d={data} fileTag={fileTag} showBranch={isWarehouseSide && !branchId} />}
            {tab === "top" && <TopReport d={data} fileTag={fileTag} showBranch={isWarehouseSide && !branchId} />}
            {tab === "reorder" && <ReorderReport d={data} fileTag={fileTag} showBranch={isWarehouseSide && !branchId} />}
            {tab === "requisitions" && <RequisitionReport d={data} fileTag={fileTag} />}
            {tab === "by-user" && <ByUserReport d={data} fileTag={fileTag} mine={user.role === "staff"} />}
          </>
        )}
      </div>
    </div>
  );
}

// ─── ส่วนประกอบใช้ร่วม ────────────────────────────────────────

function Card({ title, actions, children, note }) {
  return (
    <div className="bg-white rounded-lg shadow mb-4 break-inside-avoid">
      <div className="flex flex-wrap justify-between items-center gap-2 px-4 pt-4">
        <h2 className="font-bold">{title}</h2>
        <div className="flex gap-2 print:hidden">{actions}</div>
      </div>
      {note && <p className="px-4 text-xs text-gray-500 mt-1">{note}</p>}
      <div className="p-4">{children}</div>
    </div>
  );
}

function Stat({ label, value, sub, tone = "text-gray-900" }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
    </div>
  );
}

const CsvButton = ({ onClick }) => (
  <button onClick={onClick} className="text-sm border px-3 py-1 rounded hover:bg-gray-50" title="ดาวน์โหลดไฟล์ไปเปิดด้วย Excel">⬇ ดาวน์โหลด (Excel)</button>
);

// ตารางทั่วไป: ค้นหา + แบ่งหน้า (columns: [หัว, (row)=>ค่า, align?, className?])
function DataTable({ rows, columns, searchKeys, pageSize = 25, empty = "ไม่มีข้อมูลในช่วงนี้" }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length || !searchKeys) return rows;
    return rows.filter((r) => { const hay = searchKeys.map((k) => r[k] ?? "").join(" ").toLowerCase(); return words.every((w) => hay.includes(w)); });
  }, [rows, q, searchKeys]);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages);
  const shown = filtered.slice((cur - 1) * pageSize, cur * pageSize);
  return (
    <div>
      {searchKeys && rows.length > pageSize && (
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="ค้นหาสินค้า / SKU" className="w-full md:w-80 border rounded px-3 py-1.5 text-sm mb-3 print:hidden" />
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 text-xs">
            <tr>{columns.map(([h, , align]) => <th key={h} className={`p-2 ${align === "r" ? "text-right" : "text-left"} whitespace-nowrap`}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={columns.length} className="p-6 text-center text-gray-400">{empty}</td></tr>
            ) : shown.map((r, i) => (
              <tr key={i} className="border-t hover:bg-gray-50">
                {columns.map(([h, get, align, cls]) => (
                  <td key={h} className={`p-2 ${align === "r" ? "text-right tabular-nums" : ""} ${typeof cls === "function" ? cls(r) : cls || ""}`}>{get(r)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > pageSize && <Pager page={cur} pages={pages} total={filtered.length} onPage={setPage} pageSize={pageSize} />}
    </div>
  );
}

// ─── ภาพรวม ───────────────────────────────────────────────────

function SummaryReport({ d }) {
  const t = d.totals, st = d.stock_status, rq = d.requisitions;
  const reqTotal = Object.values(rq).reduce((a, b) => a + b, 0);
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label="รับเข้า (ช่วงนี้)" value={fmt(t.received)} sub={`${fmt(t.tx_count)} รายการเคลื่อนไหว`} />
        <Stat label="ออก (ช่วงนี้)" value={fmt(t.issued)} sub={`สินค้าที่เคลื่อนไหว ${fmt(t.products_moved)} ชนิด`} />
        <Stat label="สต๊อกคงเหลือรวม" value={fmt(st.units)} sub={`จาก ${fmt(st.total)} รายการ (สินค้า × สาขา)`} />
        <Stat label="ใบขอเบิก (ช่วงนี้)" value={fmt(reqTotal)} sub={`เสร็จ ${fmt(rq.completed || 0)} · มีปัญหา ${fmt(rq.disputed || 0)}`} />
      </div>

      <Card title="รับเข้า / ออก รายวัน" note="ชี้ที่กราฟเพื่อดูตัวเลขของแต่ละวัน — ดูรายละเอียดต่อสินค้าที่แท็บ “ความเคลื่อนไหวสต๊อก”">
        <DailyChart daily={d.daily} from={d.range.from} to={d.range.to} />
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="สถานะสต๊อกตอนนี้">
          <StatusBar parts={[
            ["หมดสต๊อก", st.out, "bg-red-500", "⛔"],
            ["ต่ำกว่าเกณฑ์", st.low, "bg-amber-400", "⚠"],
            ["ปกติ", st.ok, "bg-green-600", "✓"],
          ]} total={st.total} />
          <p className="text-xs text-gray-500 mt-3">นับเป็นรายการ “สินค้า × สาขา” เทียบกับเกณฑ์ขั้นต่ำของสินค้าแต่ละตัว — ดูรายการที่ต้องเติมได้ที่แท็บ “ควรสั่งเพิ่ม”</p>
        </Card>
        <Card title="ใบขอเบิกที่สร้างในช่วงนี้">
          {reqTotal === 0 ? <p className="text-sm text-gray-400">ไม่มีใบขอเบิก</p> : (
            <table className="w-full text-sm">
              <tbody>
                {[["pending", "รออนุมัติ"], ["approved", "รอจัดส่ง"], ["shipped", "รอตรวจรับ"], ["disputed", "มีปัญหา"], ["completed", "เสร็จสิ้น"], ["rejected", "ถูกปฏิเสธ"]].map(([k, label]) => (
                  <tr key={k} className="border-t first:border-t-0">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{fmt(rq[k] || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

// แท่งสัดส่วนแนวนอน (ใช้สีสถานะ + ไอคอน + ข้อความเสมอ ไม่ใช้สีอย่างเดียว)
function StatusBar({ parts, total }) {
  return (
    <div>
      <div className="flex h-3 rounded overflow-hidden gap-0.5 bg-gray-100">
        {parts.map(([label, n, cls]) => n > 0 && <div key={label} className={cls} style={{ width: `${(n / Math.max(1, total)) * 100}%` }} title={`${label} ${fmt(n)}`} />)}
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {parts.map(([label, n, cls, icon]) => (
          <li key={label} className="flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-sm ${cls}`} />
            <span className="w-4 text-center">{icon}</span>
            <span className="flex-1">{label}</span>
            <span className="font-medium tabular-nums">{fmt(n)}</span>
            <span className="text-gray-500 w-14 text-right tabular-nums">{total ? ((n / total) * 100).toFixed(1) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// กราฟแท่งคู่รายวัน (รับเข้า/ออก) — SVG เขียนเอง, แกนเดียว, ชี้เพื่อดูค่า
function DailyChart({ daily, from, to }) {
  const [hover, setHover] = useState(null);
  const days = useMemo(() => {
    const map = new Map(daily.map((x) => [x.date, x]));
    const out = [];
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    for (let d = new Date(fy, fm - 1, fd); d <= new Date(ty, tm - 1, td); d = addDays(d, 1)) {
      const k = ymd(d);
      out.push({ date: k, received: map.get(k)?.received || 0, issued: map.get(k)?.issued || 0 });
    }
    return out;
  }, [daily, from, to]);

  if (daily.length === 0) return <p className="text-sm text-gray-400 py-8 text-center">ไม่มีการรับเข้า/ออกในช่วงนี้</p>;

  const W = 900, H = 260, L = 48, R = 8, T = 12, B = 28;
  const max = Math.max(1, ...days.map((x) => Math.max(x.received, x.issued)));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  const colW = (W - L - R) / days.length;
  const barW = Math.max(1, Math.min(14, (colW - 4) / 2));
  const y = (v) => T + (H - T - B) * (1 - v / niceMax);
  const bar = (x, v, color) => {
    if (v <= 0) return null;
    const top = y(v), base = H - B, r = Math.min(4, barW / 2, base - top);
    return <path d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${base} Z`} fill={color} />;
  };
  const labelEvery = Math.ceil(days.length / 10);

  return (
    <div className="relative">
      <div className="flex gap-4 text-sm mb-2">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: C_IN }} />รับเข้า</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm" style={{ background: C_OUT }} />ออก</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="กราฟรับเข้าและออกรายวัน" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e5e7eb" strokeWidth="1" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{v.toLocaleString()}</text>
          </g>
        ))}
        {days.map((x, i) => {
          const cx = L + i * colW;
          const gx = cx + (colW - (barW * 2 + 2)) / 2;
          return (
            <g key={x.date}>
              {hover === i && <rect x={cx} y={T} width={colW} height={H - T - B} fill="#f3f4f6" />}
              {bar(gx, x.received, C_IN)}
              {bar(gx + barW + 2, x.issued, C_OUT)}
              {i % labelEvery === 0 && (
                <text x={cx + colW / 2} y={H - 10} textAnchor="middle" fontSize="10" fill="#6b7280">
                  {new Date(x.date).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
                </text>
              )}
              <rect x={cx} y={T} width={colW} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#9ca3af" strokeWidth="1" />
      </svg>
      {hover != null && (
        <div
          className="absolute pointer-events-none bg-white border shadow rounded px-3 py-2 text-sm"
          style={{ left: `${Math.min(80, ((L + (hover + 0.5) * colW) / W) * 100)}%`, top: 24 }}
        >
          <div className="text-xs text-gray-500 mb-1">{thDate(days[hover].date)}</div>
          <div className="flex items-center gap-2"><span className="w-3 h-0.5" style={{ background: C_IN }} /><b className="tabular-nums">{fmt(days[hover].received)}</b><span className="text-gray-500">รับเข้า</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-0.5" style={{ background: C_OUT }} /><b className="tabular-nums">{fmt(days[hover].issued)}</b><span className="text-gray-500">ออก</span></div>
        </div>
      )}
    </div>
  );
}

// ─── ความเคลื่อนไหวสต๊อก ──────────────────────────────────────

function MovementReport({ d, fileTag, showBranch }) {
  const rows = d.rows;
  const sum = rows.reduce((a, r) => ({ opening: a.opening + r.opening, received: a.received + r.received, issued: a.issued + r.issued, closing: a.closing + r.closing }), { opening: 0, received: 0, issued: 0, closing: 0 });
  const cols = [
    ["สินค้า", (r) => <>{r.name} <span className="text-gray-400">({r.sku})</span></>],
    ...(showBranch ? [["สาขา", (r) => r.branch_name]] : []),
    ["ยกมา", (r) => fmt(r.opening), "r"],
    ["รับเข้า", (r) => (r.received ? `+${fmt(r.received)}` : "-"), "r"],
    ["ออก", (r) => (r.issued ? `−${fmt(r.issued)}` : "-"), "r"],
    ["คงเหลือ", (r) => <b>{fmt(r.closing)}</b>, "r"],
    ["หน่วย", (r) => r.unit],
    ["อัตราหมุนเวียน", (r) => (r.turnover == null ? "-" : `${r.turnover}×`), "r"],
    ["เคลื่อนไหวล่าสุด", (r) => thDate(r.last_movement)],
  ];
  return (
    <Card
      title="ความเคลื่อนไหวสต๊อกต่อสินค้า"
      note="ยกมา = สต๊อก ณ ต้นช่วง · คงเหลือ = ยกมา + รับเข้า − ออก (สต๊อก ณ สิ้นช่วง) · อัตราหมุนเวียน = ออก ÷ สต๊อกเฉลี่ย ยิ่งสูงยิ่งขายดี/ใช้เร็ว"
      actions={<CsvButton onClick={() => downloadCsv(`stock-movement_${fileTag}.csv`, [
        ["SKU", (r) => r.sku], ["สินค้า", (r) => r.name], ["หมวด", (r) => r.category], ["สาขา", (r) => r.branch_name],
        ["ยกมา", (r) => r.opening], ["รับเข้า", (r) => r.received], ["ออก", (r) => r.issued], ["คงเหลือ", (r) => r.closing],
        ["หน่วย", (r) => r.unit], ["อัตราหมุนเวียน", (r) => r.turnover ?? ""], ["เคลื่อนไหวล่าสุด", (r) => ymd(new Date(r.last_movement))],
      ], rows)} />}
    >
      <div className="flex flex-wrap gap-4 text-sm mb-3">
        <span>ยกมา <b className="tabular-nums">{fmt(sum.opening)}</b></span>
        <span style={{ color: C_IN }}>+ รับเข้า <b className="tabular-nums">{fmt(sum.received)}</b></span>
        <span style={{ color: C_OUT }}>− ออก <b className="tabular-nums">{fmt(sum.issued)}</b></span>
        <span>= คงเหลือ <b className="tabular-nums">{fmt(sum.closing)}</b></span>
      </div>
      <DataTable rows={rows} columns={cols} searchKeys={["name", "sku", "category", "branch_name"]} empty="ยังไม่มีความเคลื่อนไหวของสินค้า" />
    </Card>
  );
}

// ─── ออกมาก / ค้างสต๊อก ──────────────────────────────────────

function TopReport({ d, fileTag, showBranch }) {
  const max = Math.max(1, ...d.top_issued.map((r) => r.issued));
  return (
    <>
      <Card
        title="สินค้าที่ออกมากที่สุด (20 อันดับ)"
        note="รวมทุกการออก — ที่คลังหลักรวมการจัดส่งไปสาขาด้วย"
        actions={<CsvButton onClick={() => downloadCsv(`top-issued_${fileTag}.csv`, [["อันดับ", (r) => d.top_issued.indexOf(r) + 1], ["SKU", (r) => r.sku], ["สินค้า", (r) => r.name], ["หมวด", (r) => r.category], ["ออกรวม", (r) => r.issued], ["หน่วย", (r) => r.unit], ["จำนวนครั้ง", (r) => r.times]], d.top_issued)} />}
      >
        {d.top_issued.length === 0 ? <p className="text-sm text-gray-400">ไม่มีการออกสินค้าในช่วงนี้</p> : (
          <ol className="space-y-1.5">
            {d.top_issued.map((r, i) => (
              <li key={r.product_id} className="grid grid-cols-[2rem_minmax(8rem,16rem)_1fr_6rem] items-center gap-2 text-sm">
                <span className="text-gray-400 text-right">{i + 1}</span>
                <span className="truncate" title={r.name}>{r.name}</span>
                <span className="h-3 bg-gray-100 rounded-r"><span className="block h-3 rounded-r" style={{ width: `${(r.issued / max) * 100}%`, background: C_OUT }} /></span>
                <span className="text-right tabular-nums"><b>{fmt(r.issued)}</b> {r.unit}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
      <Card
        title={`สินค้าค้างสต๊อก (${fmt(d.dead_stock.length)} รายการ)`}
        note="มีของอยู่ แต่ไม่มีการออกเลยในช่วงที่เลือก — ควรพิจารณาโยกไปสาขาที่ใช้ หรือลดการสั่งเข้า"
        actions={<CsvButton onClick={() => downloadCsv(`dead-stock_${fileTag}.csv`, [["SKU", (r) => r.sku], ["สินค้า", (r) => r.name], ["หมวด", (r) => r.category], ["สาขา", (r) => r.branch_name], ["คงเหลือ", (r) => r.stock], ["หน่วย", (r) => r.unit], ["ออกครั้งล่าสุด", (r) => (r.last_issue ? ymd(new Date(r.last_issue)) : "ไม่เคย")], ["ไม่เคลื่อนไหว (วัน)", (r) => r.idle_days ?? ""]], d.dead_stock)} />}
      >
        <DataTable
          rows={d.dead_stock}
          searchKeys={["name", "sku", "category", "branch_name"]}
          empty="ไม่มีสินค้าค้างสต๊อก"
          columns={[
            ["สินค้า", (r) => <>{r.name} <span className="text-gray-400">({r.sku})</span></>],
            ...(showBranch ? [["สาขา", (r) => r.branch_name]] : []),
            ["คงเหลือ", (r) => `${fmt(r.stock)} ${r.unit}`, "r"],
            ["ออกครั้งล่าสุด", (r) => (r.last_issue ? thDate(r.last_issue) : "ยังไม่เคยออก")],
            ["ไม่เคลื่อนไหว", (r) => (r.idle_days == null ? "-" : `${fmt(r.idle_days)} วัน`), "r"],
          ]}
        />
      </Card>
    </>
  );
}

// ─── ควรสั่งเพิ่ม ─────────────────────────────────────────────

function ReorderReport({ d, fileTag, showBranch }) {
  const [onlyUsed, setOnlyUsed] = useState(true);
  const used = (r) => r.issued > 0 || r.stock > 0 || r.unmet > 0;
  const rows = onlyUsed ? d.rows.filter(used) : d.rows;
  const neverUsed = d.rows.length - d.rows.filter(used).length;
  return (
    <Card
      title={`สินค้าที่ควรสั่ง / เบิกเพิ่ม (${fmt(rows.length)} รายการ)`}
      note={`ใช้เฉลี่ยต่อวัน = ออกในช่วงนี้ ÷ ${d.range.days} วัน · พอใช้อีก = คงเหลือ ÷ ใช้เฉลี่ยต่อวัน · สาขารอของ = ที่สาขาขอมาแต่คลังหลักยังส่งให้ไม่ได้ · แนะนำ = เติมให้ถึง 2 เท่าของเกณฑ์ หรือพอใช้ 30 วัน หรือพอส่งให้สาขาที่รอ (ค่าที่มากที่สุด) · คลังหลักสั่งจากผู้ขาย, สาขาเปิดใบขอเบิก`}
      actions={<CsvButton onClick={() => downloadCsv(`reorder_${fileTag}.csv`, [["SKU", (r) => r.sku], ["สินค้า", (r) => r.name], ["หมวด", (r) => r.category], ["สาขา", (r) => r.branch_name], ["คงเหลือ", (r) => r.stock], ["เกณฑ์ขั้นต่ำ", (r) => r.threshold], ["สาขารอของ", (r) => r.unmet || 0], ["ใช้เฉลี่ย/วัน", (r) => r.per_day], ["พอใช้อีก (วัน)", (r) => r.days_cover ?? ""], ["แนะนำสั่ง", (r) => r.suggest], ["หน่วย", (r) => r.unit]], rows)} />}
    >
      {neverUsed > 0 && (
        <label className="flex items-center gap-2 text-sm mb-3 print:hidden">
          <input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />
          ซ่อนสินค้าที่ยังไม่เคยมีของและไม่เคยใช้ ({fmt(neverUsed)} รายการ)
        </label>
      )}
      <DataTable
        rows={rows}
        searchKeys={["name", "sku", "category", "branch_name"]}
        empty="ไม่มีสินค้าที่ต้องสั่งเพิ่ม 🎉"
        columns={[
          ["สินค้า", (r) => <>{r.name} <span className="text-gray-400">({r.sku})</span></>],
          ...(showBranch ? [["สาขา", (r) => <>{r.branch_name}{r.is_warehouse ? <span className="text-xs text-blue-600"> คลัง</span> : ""}</>]] : []),
          ["คงเหลือ", (r) => fmt(r.stock), "r", (r) => (r.stock <= 0 ? "text-red-600 font-bold" : "text-amber-700 font-medium")],
          ["เกณฑ์", (r) => fmt(r.threshold), "r", "text-gray-500"],
          ["สาขารอของ", (r) => (r.unmet ? fmt(r.unmet) : "-"), "r", (r) => (r.unmet ? "text-orange-600 font-medium" : "")],
          ["ใช้/วัน", (r) => (r.per_day ? r.per_day : "-"), "r"],
          ["พอใช้อีก", (r) => (r.days_cover == null ? "-" : `${fmt(r.days_cover)} วัน`), "r", (r) => (r.days_cover != null && r.days_cover < 7 ? "text-red-600 font-medium" : "")],
          ["แนะนำสั่ง", (r) => <b>{fmt(r.suggest)} {r.unit}</b>, "r"],
        ]}
      />
    </Card>
  );
}

// ─── ใบขอเบิก ────────────────────────────────────────────────

function RequisitionReport({ d, fileTag }) {
  const tot = d.by_branch.reduce((a, r) => {
    ["total", "completed", "disputed", "requested", "received", "defective", "shipped", "requested_done", "received_done"].forEach((k) => { a[k] = (a[k] || 0) + Number(r[k] || 0); });
    return a;
  }, {});
  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : "-");
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label="ได้ของครบตามที่ขอ" value={pct(tot.received_done, tot.requested_done)} sub={`ได้สภาพดี ${fmt(tot.received_done)} จากที่ขอ ${fmt(tot.requested_done)} (เฉพาะใบที่ของถึงสาขาแล้ว)`} />
        <Stat label="อัตราของชำรุด" value={pct(tot.defective, tot.shipped)} sub={`ชำรุด ${fmt(tot.defective)} จากที่ส่ง ${fmt(tot.shipped)}`} tone={tot.defective ? "text-red-600" : "text-gray-900"} />
        <Stat label="อนุมัติเฉลี่ย" value={d.timing.approve_hours == null ? "-" : `${d.timing.approve_hours} ชม.`} sub="นับจากสาขาส่งใบ ถึงคลังหลักอนุมัติ" />
        <Stat label="ปิดงานเฉลี่ย" value={d.timing.complete_days == null ? "-" : `${d.timing.complete_days} วัน`} sub="นับจากสาขาส่งใบ ถึงใบเสร็จสิ้น" />
      </div>

      <Card
        title="แยกตามสาขา"
        note="* ได้ครบ = ได้รับสภาพดี ÷ ที่ขอ คิดเฉพาะใบที่ของถึงสาขาแล้ว"
        actions={<CsvButton onClick={() => downloadCsv(`requisitions_${fileTag}.csv`, [["สาขา", (r) => r.branch_name], ["ใบทั้งหมด", (r) => r.total], ["เสร็จสิ้น", (r) => r.completed], ["กำลังดำเนินการ", (r) => r.in_progress], ["มีปัญหา", (r) => r.disputed], ["ถูกปฏิเสธ", (r) => r.rejected], ["ขอ", (r) => r.requested], ["อนุมัติ", (r) => r.approved], ["ส่ง", (r) => r.shipped], ["ได้รับสภาพดี", (r) => r.received], ["ชำรุด", (r) => r.defective]], d.by_branch)} />}
      >
        <DataTable
          rows={d.by_branch}
          columns={[
            ["สาขา", (r) => r.branch_name],
            ["ใบ", (r) => fmt(r.total), "r"],
            ["เสร็จ", (r) => fmt(r.completed), "r"],
            ["กำลังทำ", (r) => fmt(r.in_progress), "r"],
            ["มีปัญหา", (r) => fmt(r.disputed), "r", (r) => (r.disputed ? "text-orange-600 font-medium" : "")],
            ["ขอ", (r) => fmt(r.requested), "r"],
            ["อนุมัติ", (r) => fmt(r.approved), "r"],
            ["ส่ง", (r) => fmt(r.shipped), "r"],
            ["ได้รับ (ดี)", (r) => fmt(r.received), "r"],
            ["ชำรุด", (r) => fmt(r.defective), "r", (r) => (r.defective ? "text-red-600 font-medium" : "")],
            ["ได้ครบ*", (r) => pct(r.received_done, r.requested_done), "r"],
          ]}
        />
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="สินค้าที่ชำรุดบ่อย" note="จากการตรวจรับของสาขา">
          <DataTable
            rows={d.defects}
            empty="ไม่มีสินค้าชำรุด"
            columns={[["สินค้า", (r) => r.name], ["ชำรุด", (r) => `${fmt(r.defective)} ${r.unit}`, "r", "text-red-600"], ["จากที่ส่ง", (r) => fmt(r.shipped), "r"], ["%", (r) => pct(r.defective, r.shipped), "r"]]}
          />
        </Card>
        <Card title="สินค้าที่สาขาขอแต่คลังหลักส่งไม่ครบ" note="ควรเพิ่มสต๊อกคลังหลักสำหรับสินค้าเหล่านี้">
          <DataTable
            rows={d.shortfall}
            empty="ส่งได้ครบทุกรายการ"
            columns={[["สินค้า", (r) => r.name], ["ขอ", (r) => fmt(r.requested), "r"], ["ส่งได้", (r) => fmt(r.shipped), "r"], ["ขาด", (r) => `${fmt(r.short)} ${r.unit}`, "r", "text-red-600 font-medium"]]}
          />
        </Card>
      </div>
    </>
  );
}

// ─── การเบิกรายคน ─────────────────────────────────────────────
// ใครขออะไรไปเท่าไร และ "ยังรออยู่" เท่าไร (รออนุมัติ / รอจัดส่ง / รอตรวจรับ / มีปัญหา)
const STAGE_CLS = {
  pending: "bg-yellow-100 text-yellow-800", approved: "bg-blue-100 text-blue-700", shipped: "bg-indigo-100 text-indigo-700",
  disputed: "bg-orange-100 text-orange-700", completed: "bg-green-100 text-green-700", rejected: "bg-gray-200 text-gray-600",
};

function ByUserReport({ d, fileTag, mine }) {
  const [person, setPerson] = useState("");
  const [stage, setStage] = useState("");
  const rows = d.rows.filter((r) => (!person || String(r.user_id) === person) && (
    !stage || (stage === "waiting" ? r.waiting_qty > 0 : r.status === stage)));
  const tot = d.people.reduce((a, p) => ({ requested: a.requested + p.requested, received: a.received + p.received, waiting: a.waiting + p.waiting, req: a.req + p.requisitions }), { requested: 0, received: 0, waiting: 0, req: 0 });
  const pick = (id) => { setPerson(String(id) === person ? "" : String(id)); setStage(""); };

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <Stat label={mine ? "ใบขอเบิกของฉัน" : "ใบขอเบิกทั้งหมด"} value={fmt(tot.req)} sub={mine ? "" : `จาก ${fmt(d.people.length)} คน`} />
        <Stat label="ขอเบิกไปทั้งหมด" value={fmt(tot.requested)} sub="ชิ้น (รวมทุกสินค้า)" />
        <Stat label="ยังรออยู่" value={fmt(tot.waiting)} tone={tot.waiting ? "text-orange-600" : "text-gray-900"} sub="ชิ้น ที่ยังไม่ถึงมือสาขา" />
        <Stat label="ได้รับแล้ว (สภาพดี)" value={fmt(tot.received)} tone="text-green-700" sub="ชิ้น เข้าสต๊อกสาขาแล้ว" />
      </div>

      {!mine && (
        <Card title="สรุปรายคน" note="กดชื่อเพื่อดูรายการของคนนั้นด้านล่าง · “รออยู่” = อนุมัติแล้ว/ขอไว้ แต่ยังไม่ได้รับ">
          <DataTable
            rows={d.people}
            empty="ยังไม่มีใครขอเบิกในช่วงนี้"
            columns={[
              ["ผู้เบิก", (p) => (
                <button onClick={() => pick(p.user_id)} className={`text-left hover:underline ${String(p.user_id) === person ? "font-bold text-blue-700" : "text-blue-600"}`}>
                  {p.user_name}
                </button>
              )],
              ["สาขา", (p) => p.branch_name],
              ["ใบ", (p) => fmt(p.requisitions), "r"],
              ["ขอ", (p) => fmt(p.requested), "r"],
              ["อนุมัติ", (p) => fmt(p.approved), "r"],
              ["ได้รับ", (p) => fmt(p.received), "r", "text-green-700"],
              ["ชำรุด", (p) => fmt(p.defective), "r", (p) => (p.defective ? "text-red-600" : "")],
              ["รออยู่", (p) => (p.waiting ? <b>{fmt(p.waiting)} <span className="font-normal text-gray-500">({p.waiting_requisitions} ใบ)</span></b> : "-"), "r", (p) => (p.waiting ? "text-orange-600" : "")],
            ]}
          />
        </Card>
      )}

      <Card
        title={mine ? "รายการที่ฉันขอเบิก" : person ? `รายการที่ ${d.people.find((p) => String(p.user_id) === person)?.user_name} ขอเบิก` : "รายการขอเบิกทั้งหมด"}
        note="แต่ละแถว = สินค้า 1 รายการในใบขอเบิก · คอลัมน์ “รอ” คือจำนวนที่ยังไม่ได้รับ"
        actions={<CsvButton onClick={() => downloadCsv(`requests-by-user_${fileTag}.csv`, [
          ["วันที่", (r) => ymd(new Date(r.created_at))], ["เลขที่ใบ", (r) => r.requisition_id], ["ผู้เบิก", (r) => r.user_name], ["สาขา", (r) => r.branch_name],
          ["SKU", (r) => r.sku], ["สินค้า", (r) => r.product_name], ["ขอ", (r) => r.requested_qty], ["อนุมัติ", (r) => r.approved_qty ?? ""],
          ["ส่ง", (r) => r.shipped_qty], ["ได้รับ", (r) => r.received_qty], ["ชำรุด", (r) => r.defective_qty], ["รอ", (r) => r.waiting_qty], ["สถานะ", (r) => r.stage], ["หน่วย", (r) => r.unit],
        ], rows)} />}
      >
        <div className="flex flex-wrap gap-2 mb-3 print:hidden">
          {[["", "ทั้งหมด"], ["waiting", "ยังรออยู่"], ["pending", "รออนุมัติ"], ["approved", "รอจัดส่ง"], ["shipped", "รอตรวจรับ"], ["disputed", "มีปัญหา"], ["completed", "ได้รับแล้ว"], ["rejected", "ถูกปฏิเสธ"]].map(([k, label]) => (
            <button key={k} onClick={() => setStage(k)}
              className={`text-sm px-3 py-1 rounded-full border ${stage === k ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-gray-50"}`}>
              {label}
            </button>
          ))}
          {person && <button onClick={() => setPerson("")} className="text-sm px-3 py-1 rounded-full border border-blue-300 text-blue-700">✕ ดูทุกคน</button>}
        </div>
        <DataTable
          rows={rows}
          searchKeys={["product_name", "sku", "user_name"]}
          empty="ไม่มีรายการ"
          columns={[
            ["วันที่", (r) => thDate(r.created_at)],
            ["ใบ", (r) => `#${r.requisition_id}`],
            ...(mine ? [] : [["ผู้เบิก", (r) => <>{r.user_name} <span className="text-gray-400 text-xs">{r.branch_name}</span></>]]),
            ["สินค้า", (r) => r.product_name],
            ["ขอ", (r) => fmt(r.requested_qty), "r"],
            ["อนุมัติ", (r) => (r.approved_qty == null ? "-" : fmt(r.approved_qty)), "r"],
            ["ได้รับ", (r) => fmt(r.received_qty), "r", "text-green-700"],
            ["รอ", (r) => (r.waiting_qty ? fmt(r.waiting_qty) : "-"), "r", (r) => (r.waiting_qty ? "text-orange-600 font-bold" : "")],
            ["หน่วย", (r) => r.unit],
            ["สถานะ", (r) => <span className={`px-2 py-0.5 rounded text-xs whitespace-nowrap ${STAGE_CLS[r.status] || ""}`}>{r.stage}</span>],
          ]}
        />
      </Card>
    </>
  );
}
