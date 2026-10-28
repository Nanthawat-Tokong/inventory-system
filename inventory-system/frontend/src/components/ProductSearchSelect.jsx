// ============================================================
// ProductSearchSelect.jsx — ช่องเลือกสินค้าแบบพิมพ์ค้นหาได้
// ใช้แทน <select> ธรรมดา เพราะสินค้ามีเป็นพันรายการ เลื่อนหาไม่ไหว
// ค้นหาได้จาก ชื่อ / SKU / หมวดหมู่ (พิมพ์หลายคำคั่นด้วยเว้นวรรคได้)
// ใช้คีย์บอร์ดได้: ↑ ↓ เลือก, Enter ยืนยัน, Esc ปิด
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";

const MAX_RESULTS = 50;

export default function ProductSearchSelect({
  products,
  value,
  onChange,
  getExtra,          // (product) => ข้อความเสริมท้ายรายการ เช่น "คงเหลือ 20"
  required = false,
  placeholder = "พิมพ์ชื่อสินค้า หรือ SKU เพื่อค้นหา",
  className = "",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listRef = useRef(null);
  const validRef = useRef(null);

  // บอกฟอร์มว่ายังไม่ได้เลือกสินค้า (ใช้ customValidity เพราะค่าเปลี่ยนจากโค้ด ไม่ใช่จากการพิมพ์)
  useEffect(() => {
    validRef.current?.setCustomValidity(value ? "" : "กรุณาเลือกสินค้าจากรายการ");
  }, [value, required]);

  const selected = products.find((p) => String(p.id) === String(value));

  // ปิดรายการเมื่อคลิกนอกกล่อง
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const { results, total } = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matched = words.length === 0
      ? products
      : products.filter((p) => {
          const hay = `${p.name} ${p.sku || ""} ${p.category || ""}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        });
    return { results: matched.slice(0, MAX_RESULTS), total: matched.length };
  }, [products, query]);

  // เลื่อนรายการให้เห็นตัวที่กำลังเลือกด้วยคีย์บอร์ด
  useEffect(() => {
    const el = listRef.current?.children[active];
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (p) => {
    onChange(String(p.id));
    setQuery("");
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && results[active]) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const label = (p) => `${p.name}${p.sku ? ` (${p.sku})` : ""}`;

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <input
        type="text"
        value={open ? query : selected ? label(selected) : ""}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={() => { setQuery(""); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
        placeholder={selected && open ? label(selected) : placeholder}
        className="w-full border rounded px-3 py-2 text-sm pr-8"
        autoComplete="off"
      />
      {selected && !open && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm"
          title="ล้างค่า"
        >
          ✕
        </button>
      )}

      {/* ช่องซ่อนไว้ให้ฟอร์มตรวจ required ได้ (ฟอร์มจะไม่ยอมส่งถ้ายังไม่ได้เลือกสินค้า) */}
      {required && (
        <input
          ref={validRef}
          tabIndex={-1}
          aria-hidden="true"
          value={value || ""}
          onChange={() => {}}
          className="absolute bottom-0 left-4 w-px h-px opacity-0 pointer-events-none"
        />
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border rounded shadow-lg">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-gray-400">ไม่พบสินค้าที่ตรงกับ “{query}”</p>
          ) : (
            <ul ref={listRef} className="max-h-64 overflow-y-auto">
              {results.map((p, i) => (
                <li
                  key={p.id}
                  onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                  onMouseEnter={() => setActive(i)}
                  className={`px-3 py-2 text-sm cursor-pointer flex justify-between gap-2 ${
                    i === active ? "bg-blue-50" : ""
                  } ${String(p.id) === String(value) ? "font-semibold" : ""}`}
                >
                  <span>
                    {p.name}
                    <span className="text-gray-400"> · {p.sku}{p.category ? ` · ${p.category}` : ""}</span>
                  </span>
                  {getExtra && <span className="text-gray-500 whitespace-nowrap">{getExtra(p)}</span>}
                </li>
              ))}
            </ul>
          )}
          {total > results.length && (
            <p className="px-3 py-1 text-xs text-gray-400 border-t">
              แสดง {results.length} จาก {total} รายการ — พิมพ์เพิ่มเพื่อค้นหาให้แคบลง
            </p>
          )}
        </div>
      )}
    </div>
  );
}
