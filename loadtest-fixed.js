import http from 'k6/http';
import { check, sleep } from 'k6';

// รันแบบคงที่: k6 run -u <VUs> -d 30s --summary-export summary_<VUs>.json loadtest-fixed.js
// ใช้หาจำนวน VUs สูงสุดที่ระบบรองรับ และจุดที่ประสิทธิภาพเริ่มลดลง
export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  // ⚠️ เปลี่ยน URL ให้ตรงกับ Server ที่รันอยู่
  const base = __ENV.BASE_URL || 'http://localhost:5173';
  const res = http.get(base);

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  sleep(1);
}