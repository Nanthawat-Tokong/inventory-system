// Pager.jsx — แถบแบ่งหน้าใช้ร่วมกัน (Dashboard, สินค้า, สินค้าประจำสาขา)

export default function Pager({ page, pages, total, onPage, pageSize = 50 }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex items-center justify-between p-3 border-t text-sm text-gray-600">
      <span>แสดง {from.toLocaleString()}–{to.toLocaleString()} จาก {total.toLocaleString()} รายการ</span>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-3 py-1 border rounded disabled:opacity-40">‹ ก่อนหน้า</button>
        <span>หน้า {page} / {pages}</span>
        <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="px-3 py-1 border rounded disabled:opacity-40">ถัดไป ›</button>
      </div>
    </div>
  );
}
