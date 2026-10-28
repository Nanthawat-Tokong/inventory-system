// ============================================================
// App.jsx — component หลักที่กำหนดเส้นทาง (routing) ของทั้งแอป
// ไฟล์นี้กำหนดว่า URL ไหนจะแสดงหน้าอะไร และหน้าไหนต้องการ login ก่อน
// ทุกหน้าในระบบจะถูกกำหนดที่นี่
// ============================================================

// BrowserRouter  — ครอบแอปทั้งหมดเพื่อเปิดใช้งานระบบ routing ของ React
// Routes         — กล่องที่รวบรวม Route ทั้งหมดไว้ มีแค่ Route ที่ตรงกับ URL ปัจจุบันเท่านั้นที่จะแสดง
// Route          — กำหนด URL path และ component ที่จะแสดงเมื่อเข้า URL นั้น
// Navigate       — component สำหรับ redirect ผู้ใช้ไปหน้าอื่นโดยอัตโนมัติ
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

// import ทุกหน้าที่มีในระบบ
import LoginPage    from "./pages/LoginPage";     // หน้าเข้าสู่ระบบ
import DashboardPage from "./pages/DashboardPage"; // หน้าแดชบอร์ดแสดงภาพรวมสต๊อก
import ProductsPage  from "./pages/ProductsPage";  // หน้าจัดการสินค้า (เพิ่ม/แก้ไข/ลบ)
import InventoryPage from "./pages/InventoryPage"; // หน้ารับ/ออกสินค้า
import ReportPage    from "./pages/ReportPage";    // หน้าดูรายงานสรุป
import UsersPage     from "./pages/UsersPage";     // หน้าจัดการผู้ใช้งาน (admin เท่านั้น)
import BranchesPage  from "./pages/BranchesPage";  // หน้าจัดการสาขา (admin เท่านั้น)
import AlertsPage    from "./pages/AlertsPage";    // หน้าตั้งค่าการแจ้งเตือนสต๊อกต่ำ
import RequisitionsPage from "./pages/RequisitionsPage"; // หน้าใบขอเบิกสินค้า (branch → สต๊อกใหญ่)
import BranchProductsPage from "./pages/BranchProductsPage"; // หน้ากำหนดสินค้าประจำสาขา (admin/main_manager เท่านั้น)

// ProtectedRoute คือ component ป้องกันที่ครอบหน้าต่างๆ
// ถ้ายังไม่ได้ login จะ redirect ไปหน้า login อัตโนมัติ
import HelpPage from "./pages/HelpPage"; // วิธีใช้งานสำหรับทุกบทบาท
import AccountPage from "./pages/AccountPage"; // บัญชีของฉัน / เปลี่ยนรหัสผ่าน
import ProtectedRoute from "./components/ProtectedRoute";

function App() {
  return (
    // BrowserRouter ครอบทั้งหมดเพื่อให้ React รู้จัก URL และจัดการ navigation ได้
    <BrowserRouter>
      <Routes>
        {/* หน้า login — ไม่ต้องการ token ใครก็เข้าได้ */}
        <Route path="/" element={<LoginPage />} />

        {/* หน้า Dashboard — ต้อง login ก่อน ทุก role เข้าได้ */}
        <Route path="/dashboard" element={
          <ProtectedRoute><DashboardPage /></ProtectedRoute>
        }/>

        {/* หน้าจัดการสินค้า — ต้อง login ก่อน ทุก role เข้าได้ */}
        <Route path="/products" element={
          <ProtectedRoute><ProductsPage /></ProtectedRoute>
        }/>

        {/* หน้ารับ/ออกสินค้า — ต้อง login ก่อน ทุก role เข้าได้ */}
        <Route path="/inventory" element={
          <ProtectedRoute><InventoryPage /></ProtectedRoute>
        }/>

        {/* หน้ารายงาน — ทุก role เข้าได้ (ตรงกับ backend reportRoutes.js)
            admin เห็นทุกสาขา, main_manager/staff เห็นแค่สาขาตัวเอง (กรองที่ backend) */}
        <Route path="/reports" element={
          <ProtectedRoute><ReportPage /></ProtectedRoute>
        }/>

        {/* หน้าจัดการผู้ใช้งาน — จำกัดเฉพาะ admin เท่านั้น
            ถ้า role อื่นพยายามเข้า ProtectedRoute จะ redirect ไป /dashboard แทน */}
        <Route path="/users" element={
          <ProtectedRoute roles={["admin"]}><UsersPage /></ProtectedRoute>
        }/>

        {/* หน้าจัดการสาขา — จำกัดเฉพาะ admin เท่านั้น (ตรงกับ backend branchRoutes.js) */}
        <Route path="/branches" element={
          <ProtectedRoute roles={["admin"]}><BranchesPage /></ProtectedRoute>
        }/>

        {/* หน้าแจ้งเตือน — จำกัดเฉพาะ admin และ main_manager
            staff ไม่สามารถเข้าหน้านี้ได้ */}
        <Route path="/alerts" element={
          <ProtectedRoute roles={["admin", "main_manager"]}><AlertsPage /></ProtectedRoute>
        }/>

        {/* หน้าใบขอเบิกสินค้า — ต้อง login ก่อน ทุก role เข้าได้
            (staff สร้าง/ยืนยันรับของ, admin/main_manager อนุมัติ/ปฏิเสธ/จัดส่ง/ปิดเคส) */}
        <Route path="/requisitions" element={
          <ProtectedRoute><RequisitionsPage /></ProtectedRoute>
        }/>

        {/* หน้ากำหนดสินค้าประจำสาขา — จำกัดเฉพาะ admin และ main_manager (ตรงกับ backend branchProductRoutes.js) */}
        <Route path="/branch-products" element={
          <ProtectedRoute roles={["admin", "main_manager"]}><BranchProductsPage /></ProtectedRoute>
        }/>

        {/* ถ้า URL ไม่ตรงกับ path ใดเลย ให้ redirect กลับหน้าแรก (login)
            เช่น พิมพ์ URL ผิดหรือเข้า path ที่ไม่มีอยู่ */}
        <Route path="/account" element={
          <ProtectedRoute><AccountPage /></ProtectedRoute>
        }/>

        <Route path="/help" element={
          <ProtectedRoute><HelpPage /></ProtectedRoute>
        }/>

        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
