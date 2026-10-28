// ============================================================
// main.jsx — จุดเริ่มต้นของแอปพลิเคชัน React ทั้งหมด
// ไฟล์นี้เป็น "ประตูทางเข้า" ที่ React ใช้เพื่อเริ่มแสดงผล
// โดยนำ component App มาแปะลงใน <div id="root"> ของ index.html
// ============================================================

// StrictMode คือโหมดพิเศษของ React ที่ช่วยตรวจจับข้อผิดพลาดในโค้ด
// มันจะแสดง warning เพิ่มเติมในหน้าต่าง console ระหว่าง development
// (ใน production จริง StrictMode จะไม่ทำงาน ไม่มีผลต่อ user)
import { StrictMode } from 'react'

// createRoot คือฟังก์ชันที่ React ใช้เพื่อ "ควบคุม" DOM element ที่ระบุ
// แทนที่ ReactDOM.render() แบบเก่า (React 18 ขึ้นไปใช้ createRoot)
import { createRoot } from 'react-dom/client'

// นำ CSS หลักของโปรเจกต์มาใช้ (Tailwind CSS ถูก import ที่นี่)
import './index.css'

// App คือ component หลักที่ครอบทุกหน้าและ routing (การจัดการเส้นทาง URL) ทั้งหมด
import App from './App.jsx'

// หา element ที่มี id="root" ใน index.html แล้วบอกให้ React ควบคุม element นั้น
// จากนั้นแสดงผล App ภายใน StrictMode เพื่อให้ตรวจจับข้อผิดพลาดได้ง่ายขึ้น
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
