import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  // สเต็ปทดสอบตามโจทย์อาจารย์: ค่อยๆ เพิ่ม VUs เพื่อดูจุดที่ระบบเริ่มอืด
  stages: [
    { duration: '10s', target: 5 },   // 10 วินาทีแรก: ไต่ระดับไปที่ 5 VUs
    { duration: '20s', target: 20 },  // 20 วินาทีถัดมา: อัดเพิ่มเป็น 20 VUs
    { duration: '10s', target: 0 },   // 10 วินาทีสุดท้าย: คลาย VUs ลง
  ],
};

export default function () {
  // ใช้ BASE_URL จาก -e ถ้าไม่ได้ตั้งค่า ให้ทำ fallback อัตโนมัติ
  // (Vite dev server มักเปิดฟังที่ ::1 (IPv6) ไม่ใช่ 127.0.0.1 ดังนั้น localhost อาจ fail)
  // รัน: k6 run -e BASE_URL="http://[::1]:5173" loadtest.js
  const baseUrl = __ENV.BASE_URL || 'http://[::1]:5173';
  const res = http.get(baseUrl + '/');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}