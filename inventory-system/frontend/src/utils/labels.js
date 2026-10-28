// ชื่อเรียกที่แสดงให้ผู้ใช้เห็น (ภาษาไทย) — ใช้ร่วมกันทุกหน้า
export const ROLE_LABEL = {
  admin: "ผู้ดูแลระบบ",
  main_manager: "ผู้จัดการ",
  staff: "พนักงานสาขา",
  shipper: "พนักงานจัดส่ง",
};

// บทบาทของผู้ใช้ในขั้นตอนใบขอเบิก
export const roleOf = (user) => {
  if (user.role === "admin") return "approver";
  if (user.role === "main_manager" && Number(user.is_warehouse) === 1) return "approver";
  if (user.role === "shipper") return "shipper";
  return "branch";
};
