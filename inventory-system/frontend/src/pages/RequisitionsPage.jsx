// ============================================================
// RequisitionsPage.jsx — หน้าใบขอเบิกสินค้า (สาขา → คลังหลัก)
//
// ขั้นตอน:
//   สาขา      : สร้างใบขอเบิก (เห็นสต๊อกคลังหลักของแต่ละสินค้าก่อนขอ)
//   คลังหลัก  : อนุมัติ (เห็นว่ารายการไหนมีของพอ/ไม่พอ) → จัดส่ง
//   สาขา      : ตรวจรับ แยก "สภาพดี" กับ "ชำรุด/บกพร่อง" → ถ้ามีปัญหา แจ้งคลังหลักอัตโนมัติ
//   เคสมีปัญหา: คลังหลักต้องตอบกลับ (กำลังจัดส่งใหม่ / สต๊อกยังไม่พอ) ก่อน
//               ปิดเคสได้ 2 ทาง: รับของชดเชยครบ (ปิดอัตโนมัติ) หรือ คลังหลักขอปิด + สาขายืนยัน
//               ไม่มีฝ่ายไหนปิดเคสเองได้ฝ่ายเดียว
// ทุกใบมีไทม์ไลน์ + ช่องส่งข้อความระหว่าง 2 ฝ่าย
// ปุ่มทุกปุ่มถูกล็อกระหว่างรอผล (busy) กันกดซ้ำ — backend ก็ล็อกซ้ำอีกชั้น
// ============================================================

import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import ProductSearchSelect from "../components/ProductSearchSelect";
import api from "../services/api";

const STATUS = {
  pending:   { text: "รออนุมัติ",              cls: "bg-yellow-100 text-yellow-700" },
  rejected:  { text: "ถูกปฏิเสธ",               cls: "bg-red-100 text-red-700" },
  approved:  { text: "อนุมัติแล้ว รอจัดส่ง",     cls: "bg-blue-100 text-blue-700" },
  shipped:   { text: "จัดส่งแล้ว รอตรวจรับ",    cls: "bg-indigo-100 text-indigo-700" },
  disputed:  { text: "มีปัญหา",                 cls: "bg-orange-100 text-orange-700" },
  completed: { text: "เสร็จสิ้น",                cls: "bg-green-100 text-green-700" },
};
const DISPUTE = {
  awaiting_response: { text: "รอคลังหลักตอบกลับ",      cls: "bg-red-100 text-red-700" },
  reshipping:        { text: "กำลังจัดส่งใหม่",        cls: "bg-blue-100 text-blue-700" },
  awaiting_stock:    { text: "สต๊อกยังไม่พอ รอของเข้า", cls: "bg-amber-100 text-amber-800" },
  close_proposed:    { text: "คลังหลักขอปิดเคส รอสาขายืนยัน", cls: "bg-purple-100 text-purple-700" },
};
const EVENT = {
  created: "สร้างใบขอเบิก", resubmitted: "แก้ไขและส่งใหม่", approved: "อนุมัติ", rejected: "ปฏิเสธ",
  shipped: "จัดส่งสินค้า", received_ok: "ตรวจรับครบถ้วน", issue_reported: "แจ้งปัญหาสินค้า",
  received_partial: "ตรวจรับ — ยังได้ไม่ครบ", response_reshipping: "แจ้ง: กำลังจัดส่งใหม่",
  response_awaiting_stock: "แจ้ง: สต๊อกยังไม่พอ", message: "ข้อความ", close_proposed: "ขอปิดเคส",
  close_accepted: "ยืนยันปิดเคส", close_declined: "ไม่ยอมรับการปิดเคส", replacement_created: "เตรียมของชดเชย",
  replacement_shipped: "ส่งของชดเชย", replacement_received: "ตรวจรับของชดเชย",
  approval_cancelled: "ยกเลิกการอนุมัติ", defects_decided: "ตัดสินใจเรื่องของชำรุด", defect_returned: "ได้รับของชำรุดคืนแล้ว",
};
const EVENT_TONE = {
  issue_reported: "border-orange-400", received_partial: "border-amber-400", rejected: "border-red-400",
  close_declined: "border-red-400", response_awaiting_stock: "border-amber-400", close_proposed: "border-purple-400",
  close_accepted: "border-green-500", received_ok: "border-green-500", approval_cancelled: "border-red-400",
};

const Badge = ({ map, value }) => {
  const s = map[value] || { text: value, cls: "bg-gray-100 text-gray-700" };
  return <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${s.cls}`}>{s.text}</span>;
};

const emptyItemRow = () => ({ product_id: "", requested_qty: "" });
// ของที่คลังหลัก "มีให้เบิก" สำหรับรายการนี้ = คงเหลือ − ที่อนุมัติให้ใบอื่นแล้วแต่ยังไม่ส่ง
const avail = (it) => Math.max(0, it.warehouse_available ?? it.warehouse_stock ?? 0);
const fmtDate = (d) => new Date(d).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });

// ป้ายบอกสต๊อกคลังหลักเทียบกับจำนวนที่ต้องการ
const StockChip = ({ need, have }) => {
  if (have <= 0) return <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-700">ไม่มีของ</span>;
  if (have < need) return <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">ไม่พอ (มี {have})</span>;
  return <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700">พอ</span>;
};

export default function RequisitionsPage() {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const isAdmin = user.role === "admin";
  // ฝั่งคลังหลัก = admin หรือ main_manager ของสาขาที่เป็นคลังหลัก (ตรงกับ backend isWarehouseAuthority)
  const isWarehouseSide = isAdmin || (user.role === "main_manager" && Number(user.is_warehouse) === 1); // ผู้อนุมัติ
  const isShipper = user.role === "shipper" && Number(user.is_warehouse) === 1;                           // พนักงานจัดส่ง
  const canCreate = (user.role === "staff" || user.role === "main_manager") && !Number(user.is_warehouse) && user.branch_id;

  const [requisitions, setRequisitions] = useState([]);
  const [products, setProducts] = useState([]);
  const [wh, setWh] = useState({ warehouse: null, stock: {} });
  const urlParams = new URLSearchParams(window.location.search);
  const [filter, setFilter] = useState(urlParams.get("filter") || "all");
  const [msg, setMsg] = useState({ text: "", error: false });
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(urlParams.get("new") === "1");
  const [createForm, setCreateForm] = useState({ note: "", items: [emptyItemRow()] });

  const [selected, setSelected] = useState(null);
  const [f, setF] = useState({}); // ค่าฟอร์มทั้งหมดในหน้าต่างรายละเอียด
  const setField = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const setMapField = (k, id, v) => setF((s) => ({ ...s, [k]: { ...(s[k] || {}), [id]: v } }));

  const flash = (text, error = false) => {
    setMsg({ text, error });
    setTimeout(() => setMsg({ text: "", error: false }), 5000);
  };

  const fetchList = async () => {
    const res = await api.get("/requisitions");
    setRequisitions(res.data);
  };
  const fetchWarehouseStock = () =>
    api.get("/requisitions/meta/warehouse-stock").then((res) => setWh(res.data)).catch(() => {});

  useEffect(() => {
    Promise.all([api.get("/requisitions"), api.get("/products")])
      .then(([r, p]) => { setRequisitions(r.data); setProducts(p.data); })
      .catch((err) => console.error("Failed to load requisitions data:", err));
    fetchWarehouseStock();
  }, []);

  // ─── เปิดรายละเอียด + ตั้งค่าเริ่มต้นของทุกฟอร์ม ─────────────────
  const openDetail = async (id) => {
    try {
      const res = await api.get(`/requisitions/${id}`);
      const d = { ...res.data, events: res.data.events || [], replacements: res.data.replacements || [] };
      const approveQty = {}, good = {}, bad = {}, replQty = {}, replGood = {}, replBad = {};
      d.items.forEach((it) => {
        approveQty[it.id] = it.approved_qty ?? Math.min(it.requested_qty, avail(it));
        good[it.id] = it.shipped_qty ?? 0;
        bad[it.id] = 0;
        if (it.shortage > 0) replQty[it.id] = Math.min(it.shortage, avail(it));
      });
      (d.replacements || []).forEach((rs) => rs.items.forEach((it) => { replGood[it.id] = it.replacement_qty; replBad[it.id] = 0; }));
      setF({ approveQty, good, bad, replQty, replGood, replBad, editForm: null, showReject: false });
      setSelected(d);
    } catch (err) {
      flash(err.response?.data?.message || "โหลดรายละเอียดไม่สำเร็จ", true);
    }
  };
  const closeDetail = () => setSelected(null);

  // ป๊อปอัปเปิดอยู่: Esc ปิด + ล็อกหน้าด้านหลังไม่ให้เลื่อน
  useEffect(() => {
    if (!selected) return;
    const onKey = (e) => { if (e.key === "Escape") closeDetail(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [selected]);

  // ทำรายการ: ล็อกปุ่มระหว่างรอ → แจ้งผล → โหลดข้อมูลใหม่ → อัปเดต badge บนเมนู
  const run = async (fn, { close = false } = {}) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      flash(res?.data?.message || "บันทึกแล้ว");
      if (close) closeDetail();
      else if (selected) await openDetail(selected.id);
      await fetchList();
      fetchWarehouseStock();
      window.dispatchEvent(new Event("requisitions-changed"));
    } catch (err) {
      flash(err.response?.data?.message || "เกิดข้อผิดพลาด", true);
      // อีกฝ่ายเปลี่ยนสถานะไปก่อนแล้ว → โหลดข้อมูลใหม่ (ไม่โหลดกรณีกรอกผิด จะได้ไม่ล้างค่าที่พิมพ์ไว้)
      if (selected && /สถานะปัจจุบันเปลี่ยนไปแล้ว/.test(err.response?.data?.message || "")) await openDetail(selected.id);
    } finally {
      setBusy(false);
    }
  };

  // ─── สร้าง / แก้ไข ───────────────────────────────────────────
  // กฎ: ขอได้เฉพาะสินค้าที่คลังหลักมีให้เบิก และไม่เกินจำนวนที่มี (backend ตรวจซ้ำอีกชั้น)
  const stockProblems = (items) => items
    .filter((it) => it.product_id)
    .map((it) => {
      const have = wh.stock[it.product_id] || 0;
      const name = products.find((p) => String(p.id) === String(it.product_id))?.name || "สินค้า";
      if (have <= 0) return `${name}: คลังหลักไม่มีของ — ลบรายการนี้ออก`;
      if (Number(it.requested_qty) > have) return `${name}: ขอได้ไม่เกิน ${have}`;
      return null;
    })
    .filter(Boolean);

  const cleanItems = (items) => items
    .filter((it) => it.product_id && Number(it.requested_qty) > 0)
    .map((it) => ({ product_id: Number(it.product_id), requested_qty: Number(it.requested_qty) }));

  const handleCreate = async (e) => {
    e.preventDefault();
    const items = cleanItems(createForm.items);
    if (items.length === 0) return flash("กรุณาเลือกสินค้าและระบุจำนวนอย่างน้อย 1 รายการ", true);
    const problems = stockProblems(createForm.items);
    if (problems.length) return flash(["ส่งใบขอเบิกไม่ได้", ...problems].join("\n"), true);
    await run(async () => {
      const res = await api.post("/requisitions", { note: createForm.note, items });
      setCreateForm({ note: "", items: [emptyItemRow()] });
      setShowCreate(false);
      return { data: { message: `ส่งใบขอเบิก #${res.data.id} ไปที่คลังหลักแล้ว` } };
    });
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    const items = cleanItems(f.editForm.items);
    if (items.length === 0) return flash("กรุณาเลือกสินค้าและระบุจำนวนอย่างน้อย 1 รายการ", true);
    const problems = stockProblems(f.editForm.items);
    if (problems.length) return flash(["ส่งใบขอเบิกไม่ได้", ...problems].join("\n"), true);
    await run(() => api.put(`/requisitions/${selected.id}`, { note: f.editForm.note, items }));
  };

  const updateRows = (key) => ({
    onChange: (idx, field, value) => setF((s) => {
      const items = [...s[key].items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...s, [key]: { ...s[key], items } };
    }),
    onAdd: () => setF((s) => ({ ...s, [key]: { ...s[key], items: [...s[key].items, emptyItemRow()] } })),
    onRemove: (idx) => setF((s) => ({ ...s, [key]: { ...s[key], items: s[key].items.filter((_, i) => i !== idx) } })),
  });

  const createRows = {
    onChange: (idx, field, value) => setCreateForm((s) => {
      const items = [...s.items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...s, items };
    }),
    onAdd: () => setCreateForm((s) => ({ ...s, items: [...s.items, emptyItemRow()] })),
    onRemove: (idx) => setCreateForm((s) => ({ ...s, items: s.items.filter((_, i) => i !== idx) })),
  };

  // ─── รายการ (ตาราง) ──────────────────────────────────────────
  const counts = {
    action: requisitions.filter((r) => r.needs_action).length,
    disputed: requisitions.filter((r) => r.status === "disputed").length,
  };
  const shown = requisitions.filter((r) => {
    if (filter === "action") return r.needs_action;
    if (filter === "open") return !["completed", "rejected"].includes(r.status);
    if (filter === "disputed") return r.status === "disputed";
    if (filter === "completed") return r.status === "completed";
    return true;
  });

  const isOwner = selected && selected.branch_id === user.branch_id;
  const s = selected;

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="p-6 max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold">ใบขอเบิกสินค้า</h1>
          {canCreate && (
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
            >
              {showCreate ? "ปิดฟอร์ม" : "+ สร้างใบขอเบิกใหม่"}
            </button>
          )}
        </div>

        {msg.text && !selected && (
          <div className={`mb-4 p-3 rounded text-sm whitespace-pre-line ${msg.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
            {msg.text}
          </div>
        )}

        {/* ─── ฟอร์มสร้างใบขอเบิก — แสดงสต๊อกคลังหลักทุกรายการ ─── */}
        {canCreate && showCreate && (
          <div className="bg-white p-6 rounded-lg shadow mb-6">
            <h2 className="font-bold mb-1">สร้างใบขอเบิกใหม่</h2>
            <p className="text-sm text-gray-500 mb-4">
              ขอจาก <b>{wh.warehouse?.name || "คลังหลัก"}</b> — เลือกได้เฉพาะสินค้าที่คลังหลักมีให้เบิก และขอได้ไม่เกินจำนวน "เบิกได้" (หักยอดที่อนุมัติให้สาขาอื่นแล้วแต่ยังไม่ส่ง)
            </p>
            <form onSubmit={handleCreate}>
              <ItemRowsEditor items={createForm.items} products={products} whStock={wh.stock} {...createRows} />
              <div className="mt-4">
                <label className="block text-sm text-gray-700 mb-1">หมายเหตุ</label>
                <input
                  type="text"
                  value={createForm.note}
                  onChange={(e) => setCreateForm({ ...createForm, note: e.target.value })}
                  className="w-full border rounded px-3 py-2 text-sm"
                  placeholder="เช่น สต๊อกใกล้หมดเนื่องจากยอดขายเพิ่มขึ้น"
                />
              </div>
              <button type="submit" disabled={busy || stockProblems(createForm.items).length > 0} className="mt-4 bg-blue-600 text-white px-5 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
                {busy ? "กำลังส่ง..." : "ส่งใบขอเบิก"}
              </button>
              {stockProblems(createForm.items).length > 0 && (
                <span className="ml-3 text-sm text-red-600">แก้รายการที่เป็นสีแดงก่อน ถึงจะส่งได้</span>
              )}
            </form>
          </div>
        )}

        {/* ─── ตัวกรอง ─── */}
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          {[
            ["all", `ทั้งหมด (${requisitions.length})`],
            ["action", `รอฉันดำเนินการ (${counts.action})`],
            ["open", "ยังไม่จบ"],
            ["disputed", `มีปัญหา (${counts.disputed})`],
            ["completed", "เสร็จสิ้น"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1 rounded-full border ${filter === key ? "bg-blue-600 text-white border-blue-600" : "bg-white hover:bg-gray-50"} ${key === "action" && counts.action > 0 && filter !== key ? "border-red-400 text-red-600" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ─── ตารางใบขอเบิก ─── */}
        <div className="bg-white rounded-lg shadow overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs">
              <tr>
                <th className="p-3 text-left">เลขที่</th>
                <th className="p-3 text-left">สาขา</th>
                <th className="p-3 text-left">สถานะ</th>
                <th className="p-3 text-left">รายการ</th>
                <th className="p-3 text-left">สร้างโดย</th>
                <th className="p-3 text-left">วันที่</th>
                <th className="p-3 text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-gray-400">ไม่มีใบขอเบิกในหมวดนี้</td></tr>
              ) : shown.map((r) => (
                <tr key={r.id} className={`border-t hover:bg-gray-50 ${r.needs_action ? "bg-red-50/50" : ""}`}>
                  <td className="p-3 font-medium">
                    #{r.id}
                    {r.needs_action && <span className="ml-2 text-xs bg-red-500 text-white px-1.5 py-0.5 rounded">รอคุณ</span>}
                  </td>
                  <td className="p-3">{r.branch_name}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      <Badge map={STATUS} value={r.status} />
                      {r.status === "disputed" && r.dispute_state && <Badge map={DISPUTE} value={r.dispute_state} />}
                    </div>
                  </td>
                  <td className="p-3">{r.item_count} รายการ</td>
                  <td className="p-3">{r.created_by_name}</td>
                  <td className="p-3">{new Date(r.created_at).toLocaleDateString("th-TH")}</td>
                  <td className="p-3 text-center">
                    <button onClick={() => openDetail(r.id)} className="bg-gray-600 text-white px-3 py-1 rounded text-xs hover:bg-gray-700">
                      ดูรายละเอียด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ─── ป๊อปอัปรายละเอียด ─── */}
        {s && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={closeDetail}>
            <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-5xl my-8" onClick={(e) => e.stopPropagation()}>
              {msg.text && (
                <div className={`mb-4 p-3 rounded text-sm whitespace-pre-line ${msg.error ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                  {msg.text}
                </div>
              )}

              <div className="flex justify-between items-start mb-4 gap-4">
                <div>
                  <h2 className="font-bold text-lg">ใบขอเบิก #{s.id} — {s.branch_name}</h2>
                  <p className="text-sm text-gray-500">
                    สร้างโดย {s.created_by_name} เมื่อ {fmtDate(s.created_at)}
                    {s.approved_by_name && <> · อนุมัติโดย {s.approved_by_name}</>}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Badge map={STATUS} value={s.status} />
                  {s.status === "disputed" && s.dispute_state && <Badge map={DISPUTE} value={s.dispute_state} />}
                  <button onClick={closeDetail} className="text-gray-400 hover:text-gray-600 text-sm ml-2">ปิด ✕</button>
                </div>
              </div>

              {s.note && <p className="text-sm text-gray-600 mb-2">หมายเหตุจากสาขา: {s.note}</p>}
              {s.status === "rejected" && s.reject_reason && (
                <p className="text-sm text-red-600 mb-2">เหตุผลที่ปฏิเสธ: {s.reject_reason}</p>
              )}

              <StepProgress status={s.status} />
              <NextStepBanner s={s} isWarehouseSide={isWarehouseSide} isShipper={isShipper} isOwner={isOwner} />

              {/* ─── ตารางสินค้า (ภาพรวม) ─── */}
              {!(s.status === "pending" && isWarehouseSide) && !(s.status === "shipped" && isOwner) && (
                <ItemsSummary s={s} />
              )}

              {/* ─── คลังหลัก: อนุมัติ (เห็นสต๊อกทุกรายการก่อนกด) ─── */}
              {s.status === "pending" && isWarehouseSide && (
                <Section title={`พิจารณาอนุมัติ — เทียบกับสต๊อก ${s.warehouse?.name || "คลังหลัก"}`}>
                  <ApproveSummary items={s.items} approveQty={f.approveQty} />
                  <table className="w-full text-sm mb-3">
                    <thead className="bg-gray-50 text-gray-600 text-xs">
                      <tr>
                        <th className="p-2 text-left">สินค้า</th>
                        <th className="p-2 text-right">ขอ</th>
                        <th className="p-2 text-right">เบิกได้</th>
                        <th className="p-2 text-left">สต๊อก</th>
                        <th className="p-2 text-left w-36">อนุมัติ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.items.map((it) => (
                        <tr key={it.id} className="border-t">
                          <td className="p-2">{it.product_name} <span className="text-gray-400">({it.sku})</span></td>
                          <td className="p-2 text-right">{it.requested_qty} {it.unit}</td>
                          <td className={`p-2 text-right font-medium ${avail(it) < it.requested_qty ? "text-red-600" : ""}`}>{avail(it)}</td>
                          <td className="p-2"><StockChip need={it.requested_qty} have={avail(it)} /></td>
                          <td className="p-2">
                            <input
                              type="number" min="0" max={Math.min(it.requested_qty, avail(it))}
                              value={f.approveQty?.[it.id] ?? 0}
                              disabled={avail(it) <= 0}
                              onChange={(e) => setMapField("approveQty", it.id, e.target.value)}
                              className={`w-24 border rounded px-2 py-1 disabled:bg-gray-100 ${Number(f.approveQty?.[it.id] ?? 0) > avail(it) ? "border-red-500 bg-red-50" : ""}`}
                            />
                            {Number(f.approveQty?.[it.id] ?? 0) > avail(it) && <div className="text-xs text-red-600">ไม่เกิน {avail(it)}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-xs text-gray-500 mb-3">
                    อนุมัติได้ไม่เกินจำนวน "เบิกได้" (คงเหลือ − ที่อนุมัติให้สาขาอื่นแล้วแต่ยังไม่ส่ง) — รายการที่ไม่มีของ อนุมัติไม่ได้
                    · อนุมัติแล้วงานจะไปที่ <b>พนักงานจัดส่ง</b> ของคลังหลักต่อ
                  </p>
                  {s.items.every((it) => avail(it) <= 0) && (
                    <p className="text-sm text-red-700 bg-red-50 rounded px-3 py-2 mb-3">คลังหลักไม่มีของให้เบิกเลยสักรายการ — อนุมัติไม่ได้ ให้กด "ปฏิเสธ" พร้อมเหตุผล</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy || s.items.some((it) => Number(f.approveQty?.[it.id] ?? 0) > avail(it)) || s.items.every((it) => Number(f.approveQty?.[it.id] ?? 0) === 0)}
                      onClick={() => confirm(
                        `ยืนยันอนุมัติใบขอเบิก #${s.id} ของ ${s.branch_name}?\n\n` +
                        s.items.map((it) => `• ${it.product_name}: ${Number(f.approveQty?.[it.id] ?? 0)} ${it.unit}`).join("\n") +
                        "\n\nอนุมัติแล้วงานจะไปที่พนักงานจัดส่ง"
                      ) && run(() => api.put(`/requisitions/${s.id}/approve`, {
                        items: s.items.map((it) => ({ item_id: it.id, approved_qty: Number(f.approveQty?.[it.id] ?? 0) })),
                      }))}
                      className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      อนุมัติ
                    </button>
                    <button disabled={busy} onClick={() => setField("showReject", !f.showReject)} className="bg-red-500 text-white px-4 py-2 rounded text-sm hover:bg-red-600 disabled:opacity-50">
                      ปฏิเสธ
                    </button>
                  </div>
                  {f.showReject && (
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text" value={f.rejectReason || ""} onChange={(e) => setField("rejectReason", e.target.value)}
                        placeholder="เหตุผลที่ปฏิเสธ (บังคับ)" className="flex-1 border rounded px-3 py-2 text-sm"
                      />
                      <button
                        disabled={busy || !(f.rejectReason || "").trim()}
                        onClick={() => run(() => api.put(`/requisitions/${s.id}/reject`, { reason: f.rejectReason }))}
                        className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700 disabled:opacity-50"
                      >
                        ยืนยันปฏิเสธ
                      </button>
                    </div>
                  )}
                </Section>
              )}

              {/* ─── ผู้อนุมัติ: ยกเลิกการอนุมัติ (ยังไม่ส่ง) ─── */}
              {s.status === "approved" && isWarehouseSide && (
                <Section title="">
                  <p className="text-sm text-gray-600 mb-2">
                    อนุมัติผิด หรือสาขาไม่ต้องการแล้ว? ยกเลิกได้ก่อนพนักงานจัดส่งกดส่ง — ของที่จองไว้จะถูกปล่อยคืน และใบจะกลับไปให้สาขาแก้ไขหรือยกเลิก
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text" value={f.cancelReason || ""} onChange={(e) => setField("cancelReason", e.target.value)}
                      placeholder="เหตุผลที่ยกเลิก (สาขาจะเห็น)" className="flex-1 border rounded px-3 py-2 text-sm"
                    />
                    <button
                      disabled={busy || !(f.cancelReason || "").trim()}
                      onClick={() => confirm(`ยืนยันยกเลิกการอนุมัติใบ #${s.id}?\nพนักงานจัดส่งจะส่งใบนี้ไม่ได้ และของที่จองไว้จะถูกปล่อยคืน`)
                        && run(() => api.put(`/requisitions/${s.id}/cancel-approval`, { reason: f.cancelReason }))}
                      className="bg-red-500 text-white px-4 py-2 rounded text-sm hover:bg-red-600 disabled:opacity-50 whitespace-nowrap"
                    >
                      ยกเลิกการอนุมัติ
                    </button>
                  </div>
                </Section>
              )}

              {/* ─── พนักงานจัดส่ง: จัดส่ง (ผู้อนุมัติกดเองไม่ได้ — แยกหน้าที่) ─── */}
              {s.status === "approved" && isShipper && (
                <Section title="จัดส่งสินค้า (พนักงานจัดส่ง)">
                  <table className="w-full text-sm mb-3">
                    <thead className="bg-gray-50 text-gray-600 text-xs">
                      <tr>
                        <th className="p-2 text-left">สินค้า</th>
                        <th className="p-2 text-right">อนุมัติ</th>
                        <th className="p-2 text-right">คลังหลักมี</th>
                        <th className="p-2 text-right">จะส่งได้</th>
                        <th className="p-2 text-left">สต๊อก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.items.filter((it) => it.approved_qty > 0).map((it) => (
                        <tr key={it.id} className="border-t">
                          <td className="p-2">{it.product_name}</td>
                          <td className="p-2 text-right">{it.approved_qty} {it.unit}</td>
                          <td className="p-2 text-right">{it.warehouse_stock}</td>
                          <td className="p-2 text-right font-bold">{Math.max(0, Math.min(it.approved_qty, it.warehouse_stock))}</td>
                          <td className="p-2"><StockChip need={it.approved_qty} have={it.warehouse_stock} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {s.items.some((it) => it.approved_qty > it.warehouse_stock) && (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
                      ⚠ บางรายการสต๊อกไม่พอ — ระบบจะส่งเท่าที่มี ส่วนที่ขาดจะเปิดเป็นเคส "สต๊อกยังไม่พอ" ให้ติดตามหลังสาขาตรวจรับ
                    </p>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="text" value={f.shipNote || ""} onChange={(e) => setField("shipNote", e.target.value)}
                      placeholder="หมายเหตุการจัดส่ง เช่น เลขพัสดุ / ชื่อคนขับ" className="flex-1 border rounded px-3 py-2 text-sm"
                    />
                    <button
                      disabled={busy}
                      onClick={() => confirm(`ยืนยันว่าจัดของใส่รถ/ส่งออกไปแล้ว?\nระบบจะตัดสต๊อกคลังหลักทันที และแจ้ง ${s.branch_name} ให้ตรวจรับ`)
                        && run(() => api.put(`/requisitions/${s.id}/ship`, { note: f.shipNote }))}
                      className="bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {busy ? "กำลังจัดส่ง..." : "ยืนยันจัดส่ง"}
                    </button>
                  </div>
                </Section>
              )}

              {/* ─── สาขา: ตรวจรับ แยกสภาพดี / ชำรุด ─── */}
              {s.status === "shipped" && isOwner && (
                <Section title="ตรวจรับสินค้า">
                  <p className="text-sm text-gray-500 mb-2">
                    ตรวจของทีละรายการ — <b>สภาพดี</b> จะเข้าสต๊อกสาขา, <b>ชำรุด/บกพร่อง</b> จะไม่เข้าสต๊อกและแจ้งคลังหลักอัตโนมัติ
                  </p>
                  <ReceiveTable
                    rows={s.items.filter((it) => it.approved_qty > 0).map((it) => ({ id: it.id, name: it.product_name, unit: it.unit, sent: it.shipped_qty || 0, approved: it.approved_qty }))}
                    good={f.good} bad={f.bad}
                    onGood={(id, v) => setMapField("good", id, v)} onBad={(id, v) => setMapField("bad", id, v)}
                  />
                  <ReceiveSubmit
                    busy={busy}
                    rows={s.items.filter((it) => it.approved_qty > 0).map((it) => ({ id: it.id, sent: it.shipped_qty || 0 }))}
                    good={f.good} bad={f.bad} note={f.receiveNote || ""} onNote={(v) => setField("receiveNote", v)}
                    onSubmit={(hasProblem) => confirm(hasProblem
                      ? "ยืนยันผลตรวจรับ และแจ้งปัญหาไปที่คลังหลัก?\nของสภาพดีจะเข้าสต๊อกสาขาทันที ส่วนที่ชำรุด/ขาดจะรอคลังหลักจัดการ"
                      : "ยืนยันว่าได้รับของครบและสภาพดีทุกชิ้น?\nของจะเข้าสต๊อกสาขาทันที และใบนี้จะเสร็จสิ้น") && run(() => api.put(`/requisitions/${s.id}/receive`, {
                      items: s.items.map((it) => ({ item_id: it.id, received_qty: Number(f.good?.[it.id] ?? 0), defective_qty: Number(f.bad?.[it.id] ?? 0) })),
                      issue: hasProblem, issue_note: f.receiveNote,
                    }))}
                  />
                </Section>
              )}

              {/* ─── เคสมีปัญหา: ฝั่งคลังหลัก ─── */}
              {s.status === "disputed" && isWarehouseSide && (
                <Section title="จัดการเคสที่มีปัญหา (คลังหลัก)">
                  {s.dispute_state === "close_proposed" ? (
                    <p className="text-sm text-purple-700">ส่งคำขอปิดเคสแล้ว — รอสาขายืนยัน</p>
                  ) : (
                    <>
                      {s.items.some((it) => it.shortage > 0) && (
                        <div className="mb-4">
                          <h4 className="font-medium text-sm mb-2">① ส่งของใหม่ (ชดเชยส่วนที่ขาด/ชำรุด) — สร้างแล้วพนักงานจัดส่งจะเป็นคนส่ง</h4>
                          <table className="w-full text-sm mb-2">
                            <thead className="bg-gray-50 text-gray-600 text-xs">
                              <tr>
                                <th className="p-2 text-left">สินค้า</th>
                                <th className="p-2 text-right">ยังขาด</th>
                                <th className="p-2 text-right">เบิกได้</th>
                                <th className="p-2 text-left w-36">ส่งชดเชย</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.items.filter((it) => it.shortage > 0).map((it) => (
                                <tr key={it.id} className="border-t">
                                  <td className="p-2">{it.product_name}</td>
                                  <td className="p-2 text-right text-red-600 font-medium">{it.shortage} {it.unit}</td>
                                  <td className="p-2 text-right">{avail(it)} <StockChip need={it.shortage} have={avail(it)} /></td>
                                  <td className="p-2">
                                    <input
                                      type="number" min="0" max={Math.min(it.shortage, avail(it))}
                                      value={f.replQty?.[it.id] ?? 0}
                                      onChange={(e) => setMapField("replQty", it.id, e.target.value)}
                                      className="w-24 border rounded px-2 py-1"
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="flex gap-2">
                            <input
                              type="text" value={f.replNote || ""} onChange={(e) => setField("replNote", e.target.value)}
                              placeholder="หมายเหตุถึงสาขา" className="flex-1 border rounded px-3 py-2 text-sm"
                            />
                            <button
                              disabled={busy}
                              onClick={() => {
                                const items = s.items.filter((it) => Number(f.replQty?.[it.id]) > 0)
                                  .map((it) => ({ requisition_item_id: it.id, replacement_qty: Number(f.replQty[it.id]) }));
                                if (items.length === 0) return flash("ระบุจำนวนที่จะส่งชดเชยอย่างน้อย 1 รายการ (ถ้าไม่มีของ ให้ใช้ ② แจ้งสต๊อกยังไม่พอ)", true);
                                run(() => api.post(`/requisitions/${s.id}/replacements`, { items, note: f.replNote }));
                              }}
                              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                            >
                              เตรียมส่งใหม่
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="mb-4">
                        <h4 className="font-medium text-sm mb-2">② แจ้งสาขาว่าสต๊อกยังไม่พอ / รอสินค้าเข้า</h4>
                        <div className="flex gap-2">
                          <input
                            type="text" value={f.stockMsg || ""} onChange={(e) => setField("stockMsg", e.target.value)}
                            placeholder="เช่น รอของเข้าจากซัพพลายเออร์ประมาณ 3 วัน" className="flex-1 border rounded px-3 py-2 text-sm"
                          />
                          <button
                            disabled={busy}
                            onClick={() => run(() => api.put(`/requisitions/${s.id}/respond`, { state: "awaiting_stock", message: f.stockMsg }))}
                            className="bg-amber-500 text-white px-4 py-2 rounded text-sm hover:bg-amber-600 disabled:opacity-50"
                          >
                            แจ้งสต๊อกยังไม่พอ
                          </button>
                        </div>
                      </div>

                      <div>
                        <h4 className="font-medium text-sm mb-1">③ ขอปิดเคส (สาขาต้องกดยืนยันก่อนเคสจะปิด)</h4>
                        {s.dispute_state === "awaiting_response" ? (
                          <p className="text-xs text-gray-500">ต้องตอบกลับสาขาด้วย ① หรือ ② ก่อน ถึงจะขอปิดเคสได้</p>
                        ) : s.items.some((it) => it.defect_undecided > 0) ? (
                          <p className="text-xs text-gray-500">ต้องเลือกก่อนว่าของชำรุดจะตัดทิ้งหรือส่งคืน (ส่วน “ของชำรุด” ด้านล่าง)</p>
                        ) : s.replacements.some((r) => r.status !== "received") ? (
                          <p className="text-xs text-gray-500">ยังมีของชดเชยที่ยังไม่ถึงสาขา — รอสาขาตรวจรับก่อน</p>
                        ) : (
                          <div className="flex gap-2">
                            <input
                              type="text" value={f.closeMsg || ""} onChange={(e) => setField("closeMsg", e.target.value)}
                              placeholder="ข้อสรุป เช่น ตกลงไม่ส่ง B แล้ว ให้เปิดใบใหม่" className="flex-1 border rounded px-3 py-2 text-sm"
                            />
                            <button
                              disabled={busy || !(f.closeMsg || "").trim()}
                              onClick={() => run(() => api.put(`/requisitions/${s.id}/propose-close`, { message: f.closeMsg }))}
                              className="bg-purple-600 text-white px-4 py-2 rounded text-sm hover:bg-purple-700 disabled:opacity-50"
                            >
                              ขอปิดเคส
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </Section>
              )}

              {/* ─── เคสมีปัญหา: สาขายืนยัน/ปฏิเสธการปิดเคส ─── */}
              {s.status === "disputed" && isOwner && s.dispute_state === "close_proposed" && (
                <Section title="คลังหลักขอปิดเคส">
                  <p className="text-sm bg-purple-50 text-purple-800 rounded px-3 py-2 mb-3 whitespace-pre-line">
                    {[...s.events].reverse().find((e) => e.type === "close_proposed")?.message}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy}
                      onClick={() => confirm("ยืนยันปิดเคสนี้? ปิดแล้วจะเปิดใหม่ไม่ได้") && run(() => api.put(`/requisitions/${s.id}/accept-close`, {}))}
                      className="bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                    >
                      ยอมรับ ปิดเคส
                    </button>
                    <input
                      type="text" value={f.declineMsg || ""} onChange={(e) => setField("declineMsg", e.target.value)}
                      placeholder="ถ้ายังไม่ยอมรับ ระบุเหตุผล" className="flex-1 min-w-48 border rounded px-3 py-2 text-sm"
                    />
                    <button
                      disabled={busy || !(f.declineMsg || "").trim()}
                      onClick={() => run(() => api.put(`/requisitions/${s.id}/decline-close`, { message: f.declineMsg }))}
                      className="bg-red-500 text-white px-4 py-2 rounded text-sm hover:bg-red-600 disabled:opacity-50"
                    >
                      ยังไม่ยอมรับ
                    </button>
                  </div>
                </Section>
              )}

              {/* ─── ของชำรุด: ไปไหนต่อ ─── */}
              {(s.items.some((it) => it.defect_undecided > 0) || s.defects?.length > 0) && (
                <Section title="ของชำรุด — จัดการอย่างไร">
                  {isWarehouseSide && s.items.some((it) => it.defect_undecided > 0) && (
                    <div className="mb-4">
                      <p className="text-sm text-gray-600 mb-2">
                        ของชำรุดไม่ได้เข้าสต๊อกใคร — เลือกว่าจะ <b>ตัดทิ้งที่สาขา</b> หรือ <b>ให้สาขาส่งคืนคลังหลัก</b> (เช่น เพื่อเคลมผู้ขาย) ต้องเลือกให้ครบก่อนขอปิดเคส
                      </p>
                      <table className="w-full text-sm mb-2">
                        <thead className="bg-gray-50 text-gray-600 text-xs">
                          <tr>
                            <th className="p-2 text-left">สินค้า</th>
                            <th className="p-2 text-right">ชำรุด (ยังไม่จัดการ)</th>
                            <th className="p-2 text-left w-32">ตัดทิ้ง</th>
                            <th className="p-2 text-left w-32">ส่งคืนคลัง</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.items.filter((it) => it.defect_undecided > 0).map((it) => {
                            const w = Number(f.dWrite?.[it.id] ?? 0), r = Number(f.dReturn?.[it.id] ?? 0);
                            return (
                              <tr key={it.id} className="border-t">
                                <td className="p-2">{it.product_name}</td>
                                <td className="p-2 text-right text-red-600 font-medium">{it.defect_undecided} {it.unit}</td>
                                <td className="p-2"><input type="number" min="0" max={it.defect_undecided} value={f.dWrite?.[it.id] ?? 0} onChange={(e) => setMapField("dWrite", it.id, e.target.value)} className="w-20 border rounded px-2 py-1" /></td>
                                <td className="p-2">
                                  <input type="number" min="0" max={it.defect_undecided} value={f.dReturn?.[it.id] ?? 0} onChange={(e) => setMapField("dReturn", it.id, e.target.value)} className="w-20 border rounded px-2 py-1" />
                                  {w + r > it.defect_undecided && <div className="text-xs text-red-600">รวมเกิน {it.defect_undecided}</div>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <div className="flex gap-2">
                        <input type="text" value={f.dNote || ""} onChange={(e) => setField("dNote", e.target.value)} placeholder="หมายเหตุ เช่น เคลมกับผู้ขาย" className="flex-1 border rounded px-3 py-2 text-sm" />
                        <button
                          disabled={busy}
                          onClick={() => {
                            const items = [];
                            s.items.forEach((it) => {
                              const w = Number(f.dWrite?.[it.id] || 0), r = Number(f.dReturn?.[it.id] || 0);
                              if (w > 0) items.push({ requisition_item_id: it.id, qty: w, action: "write_off" });
                              if (r > 0) items.push({ requisition_item_id: it.id, qty: r, action: "return" });
                            });
                            if (!items.length) return flash("ใส่จำนวนที่จะตัดทิ้งหรือส่งคืนอย่างน้อย 1 รายการ", true);
                            run(async () => { const res = await api.post(`/requisitions/${s.id}/defects`, { items, note: f.dNote }); return res; });
                          }}
                          className="bg-gray-700 text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
                        >
                          บันทึก
                        </button>
                      </div>
                    </div>
                  )}
                  {!isWarehouseSide && s.items.some((it) => it.defect_undecided > 0) && (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded px-3 py-2 mb-3">
                      รอคลังหลักแจ้งว่าจะให้ตัดทิ้งหรือส่งของชำรุดคืน — เก็บของชำรุดไว้ก่อน อย่าเพิ่งทิ้ง
                    </p>
                  )}
                  {s.defects?.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {s.defects.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <span>{d.action === "write_off" ? "🗑 ตัดทิ้งที่สาขา" : "↩️ ส่งคืนคลังหลัก"}</span>
                          <b>{d.product_name} {d.qty} {d.unit}</b>
                          <span className={`text-xs px-2 py-0.5 rounded ${d.status === "done" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
                            {d.status === "done" ? (d.action === "return" ? "ได้รับคืนแล้ว" : "เรียบร้อย") : "รอสาขาส่งคืน"}
                          </span>
                          {d.note && <span className="text-gray-500">— {d.note}</span>}
                          {d.action === "return" && d.status === "pending" && (isWarehouseSide || isShipper) && (
                            <button
                              disabled={busy}
                              onClick={() => confirm("ยืนยันว่าได้รับของชำรุดคืนที่คลังหลักแล้ว?") && run(() => api.put(`/requisitions/${s.id}/defects/${d.id}/received`, {}))}
                              className="text-xs bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700 disabled:opacity-50"
                            >
                              ได้รับคืนแล้ว
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {/* ─── ของชดเชยแต่ละรอบ ─── */}
              {s.replacements?.length > 0 && (
                <Section title="การจัดส่งชดเชย">
                  {s.replacements.map((rs) => (
                    <div key={rs.id} className="border rounded p-3 mb-3 text-sm">
                      <div className="flex justify-between mb-2">
                        <span className="font-medium">รอบ #{rs.id} — {{ preparing: "กำลังเตรียม", shipped: "ส่งแล้ว รอตรวจรับ", received: "รับแล้ว" }[rs.status]}</span>
                        <span className="text-gray-500 text-xs">{rs.created_by_name} · {fmtDate(rs.created_at)}</span>
                      </div>
                      {rs.note && <p className="text-gray-600 mb-2">หมายเหตุ: {rs.note}</p>}
                      {rs.status === "shipped" && isOwner ? (
                        <>
                          <ReceiveTable
                            rows={rs.items.map((it) => ({ id: it.id, name: it.product_name, unit: it.unit, sent: it.replacement_qty }))}
                            good={f.replGood} bad={f.replBad}
                            onGood={(id, v) => setMapField("replGood", id, v)} onBad={(id, v) => setMapField("replBad", id, v)}
                          />
                          <button
                            disabled={busy}
                            onClick={() => run(() => api.put(`/requisitions/${s.id}/replacements/${rs.id}/receive`, {
                              items: rs.items.map((it) => ({ replacement_item_id: it.id, received_qty: Number(f.replGood?.[it.id] ?? 0), defective_qty: Number(f.replBad?.[it.id] ?? 0) })),
                            }))}
                            className="mt-2 bg-green-600 text-white px-4 py-2 rounded text-sm hover:bg-green-700 disabled:opacity-50"
                          >
                            ยืนยันตรวจรับของชดเชย
                          </button>
                        </>
                      ) : (
                        <ul className="list-disc pl-5">
                          {rs.items.map((it) => (
                            <li key={it.id}>
                              {it.product_name}: ส่ง {it.replacement_qty} {it.unit}
                              {it.received_qty != null && ` · ได้รับสภาพดี ${it.received_qty}`}
                            </li>
                          ))}
                        </ul>
                      )}
                      {rs.status === "preparing" && isShipper && (
                        <button
                          disabled={busy}
                          onClick={() => run(() => api.put(`/requisitions/${s.id}/replacements/${rs.id}/ship`, {}))}
                          className="mt-2 bg-indigo-600 text-white px-4 py-2 rounded text-sm hover:bg-indigo-700 disabled:opacity-50"
                        >
                          ยืนยันจัดส่งของชดเชย (ตัดสต๊อก)
                        </button>
                      )}
                    </div>
                  ))}
                </Section>
              )}

              {/* ─── สาขา: แก้ไข/ยกเลิก ─── */}
              {(s.status === "rejected" || s.status === "pending") && (isAdmin || isOwner) && (
                <Section title="">
                  {f.editForm ? (
                    <form onSubmit={submitEdit}>
                      <ItemRowsEditor items={f.editForm.items} products={products} whStock={wh.stock} {...updateRows("editForm")} />
                      <input
                        type="text" value={f.editForm.note}
                        onChange={(e) => setField("editForm", { ...f.editForm, note: e.target.value })}
                        className="w-full border rounded px-3 py-2 text-sm mt-3" placeholder="หมายเหตุ"
                      />
                      <div className="flex gap-2 mt-3">
                        <button type="submit" disabled={busy} className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700 disabled:opacity-50">ส่งใหม่</button>
                        <button type="button" onClick={() => setField("editForm", null)} className="bg-gray-300 px-4 py-2 rounded text-sm">ยกเลิกการแก้ไข</button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex gap-2">
                      {s.status === "rejected" && (
                        <button
                          onClick={() => setField("editForm", { note: s.note || "", items: s.items.map((it) => ({ product_id: it.product_id, requested_qty: it.requested_qty })) })}
                          className="bg-yellow-500 text-white px-4 py-2 rounded text-sm hover:bg-yellow-600"
                        >
                          แก้ไขแล้วส่งใหม่
                        </button>
                      )}
                      <button
                        disabled={busy}
                        onClick={() => confirm("ยืนยันยกเลิกใบขอเบิกนี้?") && run(() => api.delete(`/requisitions/${s.id}`), { close: true })}
                        className="bg-gray-500 text-white px-4 py-2 rounded text-sm hover:bg-gray-600 disabled:opacity-50"
                      >
                        ยกเลิกใบขอเบิก
                      </button>
                    </div>
                  )}
                </Section>
              )}

              {/* ─── ไทม์ไลน์ + ส่งข้อความ ─── */}
              <Section title="ไทม์ไลน์ & ข้อความ">
                <ol className="space-y-2 mb-3 max-h-72 overflow-y-auto pr-1">
                  {s.events.length === 0 && <li className="text-sm text-gray-400">ยังไม่มีประวัติ</li>}
                  {s.events.map((e) => (
                    <li key={e.id} className={`border-l-4 pl-3 py-1 text-sm ${EVENT_TONE[e.type] || "border-gray-300"} ${e.type === "message" ? "bg-gray-50 rounded-r" : ""}`}>
                      <div className="flex justify-between gap-2">
                        <span className="font-medium">{EVENT[e.type] || e.type}</span>
                        <span className="text-xs text-gray-400 whitespace-nowrap">{fmtDate(e.created_at)}</span>
                      </div>
                      <div className="text-xs text-gray-500">{e.user_name || "-"}{e.user_branch_name ? ` · ${e.user_branch_name}` : ""}</div>
                      {e.message && <p className="whitespace-pre-line text-gray-700 mt-0.5">{e.message}</p>}
                    </li>
                  ))}
                </ol>
                <div className="flex gap-2">
                  <input
                    type="text" value={f.chat || ""} onChange={(e) => setField("chat", e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && (f.chat || "").trim()) { e.preventDefault(); run(async () => { const r = await api.post(`/requisitions/${s.id}/messages`, { message: f.chat }); setField("chat", ""); return r; }); } }}
                    placeholder={isWarehouseSide || isShipper ? "ส่งข้อความถึงสาขา..." : "ส่งข้อความถึงคลังหลัก..."}
                    className="flex-1 border rounded px-3 py-2 text-sm"
                  />
                  <button
                    disabled={busy || !(f.chat || "").trim()}
                    onClick={() => run(async () => { const r = await api.post(`/requisitions/${s.id}/messages`, { message: f.chat }); setField("chat", ""); return r; })}
                    className="bg-gray-700 text-white px-4 py-2 rounded text-sm hover:bg-gray-800 disabled:opacity-50"
                  >
                    ส่ง
                  </button>
                </div>
              </Section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ส่วนย่อย ────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="border-t pt-4 mt-4">
      {title && <h3 className="font-bold mb-3">{title}</h3>}
      {children}
    </div>
  );
}

// แถบขั้นตอน: ขอเบิก → อนุมัติ → จัดส่ง → ตรวจรับ → เสร็จ (ให้เห็นว่าใบอยู่ตรงไหนของกระบวนการ)
const STEPS = ["สาขาขอเบิก", "คลังหลักอนุมัติ", "พนักงานจัดส่ง", "สาขาตรวจรับ", "เสร็จสิ้น"];
const STEP_AT = { pending: 1, rejected: 1, approved: 2, shipped: 3, disputed: 3, completed: 5 };
function StepProgress({ status }) {
  const at = STEP_AT[status] ?? 0;
  const bad = status === "rejected" || status === "disputed";
  return (
    <ol className="flex items-center gap-1 mb-3 text-xs overflow-x-auto">
      {STEPS.map((label, i) => {
        const done = i < at, current = i === at && status !== "completed";
        const tone = current && bad ? "bg-orange-500 text-white" : done ? "bg-green-600 text-white" : current ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500";
        return (
          <li key={label} className="flex items-center gap-1 whitespace-nowrap">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold ${tone}`}>{done ? "✓" : i + 1}</span>
            <span className={current ? "font-semibold" : "text-gray-500"}>
              {current && status === "rejected" ? "ถูกปฏิเสธ" : current && status === "disputed" ? "มีปัญหา" : label}
            </span>
            {i < STEPS.length - 1 && <span className="w-6 h-px bg-gray-300 mx-1" />}
          </li>
        );
      })}
    </ol>
  );
}

// แถบบอก "ขั้นต่อไปคืออะไร ใครต้องทำ" ให้ทั้ง 2 ฝ่ายเห็นตรงกัน
function NextStepBanner({ s, isWarehouseSide, isShipper, isOwner }) {
  const you = (cond) => (cond ? " (คุณ)" : "");
  const map = {
    pending: `รอคลังหลักพิจารณาอนุมัติ${you(isWarehouseSide)}`,
    approved: `อนุมัติแล้ว — รอพนักงานจัดส่งของคลังหลักจัดส่ง${you(isShipper)}`,
    shipped: `รอสาขาตรวจรับสินค้า${you(isOwner)}`,
    rejected: `ถูกปฏิเสธ — สาขาแก้ไขแล้วส่งใหม่ หรือยกเลิกได้${you(isOwner)}`,
    completed: "เสร็จสิ้นแล้ว",
  };
  let text = map[s.status];
  if (s.status === "disputed") {
    const shipped = s.replacements.some((r) => r.status === "shipped");
    text = {
      awaiting_response: `สาขาแจ้งปัญหาแล้ว — รอคลังหลักตอบกลับ${you(isWarehouseSide)}`,
      reshipping: shipped ? `คลังหลักส่งของชดเชยแล้ว — รอสาขาตรวจรับ${you(isOwner)}`
        : s.replacements.some((r) => r.status === "preparing") ? `เตรียมของชดเชยแล้ว — รอพนักงานจัดส่งส่งของ${you(isShipper)}`
        : `คลังหลักกำลังเตรียมส่งของใหม่${you(isWarehouseSide)}`,
      awaiting_stock: "คลังหลักแจ้งว่าสต๊อกยังไม่พอ — รอสินค้าเข้าแล้วจะส่งตาม",
      close_proposed: `คลังหลักขอปิดเคส — รอสาขายืนยัน${you(isOwner)}`,
    }[s.dispute_state] || "มีปัญหา";
    text += " · เคสนี้ปิดได้เมื่อรับของครบ หรือทั้ง 2 ฝ่ายตกลงปิดร่วมกันเท่านั้น";
  }
  const tone = s.status === "disputed" ? "bg-orange-50 text-orange-800" : s.status === "completed" ? "bg-green-50 text-green-800" : "bg-blue-50 text-blue-800";
  return <div className={`text-sm rounded px-3 py-2 mb-3 ${tone}`}>ขั้นต่อไป: {text}</div>;
}

function ItemsSummary({ s }) {
  const showStock = ["pending", "approved", "disputed"].includes(s.status);
  const shippedYet = s.items.some((it) => it.shipped_qty != null);
  const receivedYet = s.items.some((it) => it.received_qty != null);
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-gray-600 text-xs">
        <tr>
          <th className="p-2 text-left">สินค้า</th>
          <th className="p-2 text-right">ขอ</th>
          {showStock && <th className="p-2 text-right">คลังหลักมี</th>}
          <th className="p-2 text-right">อนุมัติ</th>
          {shippedYet && <th className="p-2 text-right">ส่ง</th>}
          {receivedYet && <th className="p-2 text-right">ได้รับ (ดี)</th>}
          {receivedYet && <th className="p-2 text-right">ชำรุด</th>}
          {s.status === "disputed" && <th className="p-2 text-right">ยังขาด</th>}
        </tr>
      </thead>
      <tbody>
        {s.items.map((it) => (
          <tr key={it.id} className="border-t">
            <td className="p-2">{it.product_name} <span className="text-gray-400">({it.sku})</span></td>
            <td className="p-2 text-right">{it.requested_qty} {it.unit}</td>
            {showStock && <td className={`p-2 text-right ${it.warehouse_stock < (it.approved_qty ?? it.requested_qty) ? "text-red-600" : ""}`}>{it.warehouse_stock}</td>}
            <td className="p-2 text-right">{it.approved_qty ?? "-"}</td>
            {shippedYet && <td className={`p-2 text-right ${(it.shipped_qty ?? 0) < (it.approved_qty ?? 0) ? "text-amber-700" : ""}`}>{it.shipped_qty ?? "-"}</td>}
            {receivedYet && <td className="p-2 text-right">{it.received_qty ?? "-"}</td>}
            {receivedYet && <td className={`p-2 text-right ${it.defective_qty > 0 ? "text-red-600 font-medium" : ""}`}>{it.defective_qty ?? 0}</td>}
            {s.status === "disputed" && <td className={`p-2 text-right font-medium ${it.shortage > 0 ? "text-red-600" : "text-green-600"}`}>{it.shortage > 0 ? it.shortage : "ครบ"}{it.in_flight_replacement_qty > 0 && <span className="text-xs text-blue-600"> (+{it.in_flight_replacement_qty} กำลังส่ง)</span>}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// สรุปก่อนอนุมัติ: พร้อมส่งกี่รายการ / ส่งได้บางส่วน / ไม่มีของ
function ApproveSummary({ items, approveQty }) {
  let full = 0, partial = 0, none = 0;
  items.forEach((it) => {
    const want = Number(approveQty?.[it.id] ?? 0);
    if (want === 0) return;
    if (avail(it) <= 0) none++;
    else if (avail(it) < want) partial++;
    else full++;
  });
  return (
    <div className="flex flex-wrap gap-2 mb-3 text-sm">
      <span className="px-2 py-1 rounded bg-green-100 text-green-700">มีของพร้อมส่ง {full} รายการ</span>
      {partial > 0 && <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">ของไม่พอ {partial} รายการ</span>}
      {none > 0 && <span className="px-2 py-1 rounded bg-red-100 text-red-700">ไม่มีของเลย {none} รายการ</span>}
    </div>
  );
}

// ตารางตรวจรับ: แต่ละรายการกรอก สภาพดี / ชำรุด — ที่เหลือคำนวณเป็น "ขาด" ให้อัตโนมัติ
function ReceiveTable({ rows, good, bad, onGood, onBad }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 text-gray-600 text-xs">
        <tr>
          <th className="p-2 text-left">สินค้า</th>
          <th className="p-2 text-right">ส่งมา</th>
          <th className="p-2 text-left w-28">สภาพดี</th>
          <th className="p-2 text-left w-28">ชำรุด/บกพร่อง</th>
          <th className="p-2 text-right">ขาด</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const g = Number(good?.[r.id] ?? 0), b = Number(bad?.[r.id] ?? 0);
          const missing = r.sent - g - b;
          return (
            <tr key={r.id} className="border-t">
              <td className="p-2">
                {r.name}
                {r.approved != null && r.sent < r.approved && <div className="text-xs text-amber-700">อนุมัติ {r.approved} แต่คลังส่งได้ {r.sent}</div>}
              </td>
              <td className="p-2 text-right">{r.sent} {r.unit}</td>
              <td className="p-2"><input type="number" min="0" max={r.sent} value={good?.[r.id] ?? 0} onChange={(e) => onGood(r.id, e.target.value)} className="w-20 border rounded px-2 py-1" /></td>
              <td className="p-2"><input type="number" min="0" max={r.sent} value={bad?.[r.id] ?? 0} onChange={(e) => onBad(r.id, e.target.value)} className={`w-20 border rounded px-2 py-1 ${b > 0 ? "border-red-400 bg-red-50" : ""}`} /></td>
              <td className={`p-2 text-right font-medium ${missing < 0 ? "text-red-600" : missing > 0 ? "text-orange-600" : "text-gray-400"}`}>
                {missing < 0 ? "เกิน!" : missing}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ReceiveSubmit({ busy, rows, good, bad, note, onNote, onSubmit }) {
  const hasDefect = rows.some((r) => Number(bad?.[r.id] ?? 0) > 0);
  const hasMissing = rows.some((r) => r.sent - Number(good?.[r.id] ?? 0) - Number(bad?.[r.id] ?? 0) > 0);
  const over = rows.some((r) => r.sent - Number(good?.[r.id] ?? 0) - Number(bad?.[r.id] ?? 0) < 0);
  const hasProblem = hasDefect || hasMissing;
  return (
    <div className="mt-3">
      {hasProblem && (
        <p className="text-sm text-orange-700 bg-orange-50 rounded px-3 py-2 mb-2">
          พบ{hasDefect ? "สินค้าชำรุด" : ""}{hasDefect && hasMissing ? " และ" : ""}{hasMissing ? "สินค้าขาด" : ""} — ระบบจะแจ้งคลังหลักทันที และเคสจะเปิดค้างไว้จนกว่าคลังหลักจะตอบกลับ
        </p>
      )}
      <textarea
        value={note} onChange={(e) => onNote(e.target.value)} rows={2}
        placeholder={hasProblem ? "อธิบายปัญหา เช่น กล่องบุบ ขวดแตก 2 ขวด (แนะนำให้กรอก)" : "หมายเหตุ (ไม่บังคับ)"}
        className="w-full border rounded px-3 py-2 text-sm mb-2"
      />
      <button
        disabled={busy || over}
        onClick={() => onSubmit(hasProblem)}
        className={`text-white px-4 py-2 rounded text-sm disabled:opacity-50 ${hasProblem ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}`}
      >
        {hasProblem ? "ยืนยันรับ + แจ้งปัญหาไปคลังหลัก" : "ยืนยันรับครบถ้วน"}
      </button>
      {over && <span className="text-sm text-red-600 ml-2">สภาพดี + ชำรุด เกินจำนวนที่ส่งมา</span>}
    </div>
  );
}

// ─── ItemRowsEditor ─────────────────────────────────────────────
// กรอกรายการสินค้า (สร้างใหม่/แก้ไข) — แสดงสต๊อกคลังหลักทุกแถว เตือนถ้าขอเกินที่มี
function ItemRowsEditor({ items, products, whStock = {}, onChange, onAdd, onRemove }) {
  // ให้เลือกได้เฉพาะสินค้าที่คลังหลักมีของ (+ สินค้าที่เลือกไว้แล้ว เผื่อเป็นใบเก่าที่ตอนนี้ของหมด จะได้เห็นและลบออก)
  const chosen = new Set(items.map((it) => String(it.product_id)));
  const options = products.filter((p) => (whStock[p.id] || 0) > 0 || chosen.has(String(p.id)));
  return (
    <div>
      {items.map((it, idx) => {
        const have = whStock[it.product_id] || 0;
        const want = Number(it.requested_qty) || 0;
        return (
          <div key={idx} className="flex gap-2 items-start mb-2">
            <div className="flex-1">
              {idx === 0 && <label className="block text-xs text-gray-500 mb-1">สินค้า</label>}
              <ProductSearchSelect
                products={options}
                value={it.product_id}
                onChange={(id) => onChange(idx, "product_id", id)}
                getExtra={(p) => `เบิกได้ ${whStock[p.id] || 0}`}
                placeholder={`ค้นหาสินค้าที่คลังหลักมี (${options.length} รายการ)`}
                required
              />
            </div>
            <div className="w-28">
              {idx === 0 && <label className="block text-xs text-gray-500 mb-1">เบิกได้</label>}
              <div className={`px-3 py-2 text-sm rounded border bg-gray-50 ${it.product_id && (have <= 0 || want > have) ? "text-red-600 border-red-300" : "text-gray-700"}`}>
                {it.product_id ? have : "-"}
              </div>
            </div>
            <div className="w-32">
              {idx === 0 && <label className="block text-xs text-gray-500 mb-1">จำนวนที่ขอ</label>}
              <input
                type="number" min="1" step="1" max={have || undefined} value={it.requested_qty}
                onChange={(e) => onChange(idx, "requested_qty", e.target.value)}
                className="w-full border rounded px-3 py-2 text-sm"
                required
              />
              {it.product_id && want > have && (
                <p className="text-xs text-red-600 mt-0.5">{have <= 0 ? "คลังหลักไม่มีของ — ลบรายการนี้" : `ขอได้ไม่เกิน ${have}`}</p>
              )}
            </div>
            {items.length > 1 && (
              <button type="button" onClick={() => onRemove(idx)} className={`text-red-500 hover:text-red-700 px-2 py-2 text-sm ${idx === 0 ? "mt-5" : ""}`}>
                ลบ
              </button>
            )}
          </div>
        );
      })}
      <button type="button" onClick={onAdd} className="text-blue-600 hover:underline text-sm">
        + เพิ่มรายการสินค้า
      </button>
    </div>
  );
}
