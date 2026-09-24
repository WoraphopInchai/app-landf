// ตรวจ (seed) จุดคืน (returnPoints) เริ่มต้น 6 จุด ให้ตรงกับตัวเลือกในแบบฟอร์มแจ้งของพบ
// รันจากโฟลเดอร์ functions:
//   GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\serviceAccountKey.json" node seed-return-points.js
// หรือตั้งค่า firebase login แล้วรัน:
//   firebase login
//   GOOGLE_APPLICATION_CREDENTIALS="..." node seed-return-points.js
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}
const db = getFirestore();

// ต้องตรงกับตัวเลือกใน src/Pages/ReportItem.tsx (จุดฝากของที่นำส่ง)
const POINT_NAMES = [
  "ป้อมยามประตู 1 (หน้ามหาวิทยาลัย)",
  "ป้อมยามประตู 2",
  "ป้อมยามประตู 3",
  "ป้อมยามประตู 4 (โซนหอพัก)",
  "กองกิจการนิสิต",
  "ฝากไว้กับเจ้าหน้าที่ประจำตึก",
];

async function main() {
  const col = db.collection("returnPoints");
  const existing = await col.get();

  let created = 0;
  let skipped = 0;

  for (const name of POINT_NAMES) {
    const q = await col.where("name", "==", name).limit(1).get();
    if (!q.empty) {
      console.log(`มีอยู่แล้ว: ${name}`);
      skipped++;
      continue;
    }
    await col.add({
      name,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`สร้าง: ${name}`);
    created++;
  }

  console.log(`\nเสร็จสิ้น: สร้าง ${created} จุด, ข้าม ${skipped} จุด (มีอยู่แล้ว)`);
  if (existing.size > 0) {
    console.log(`หมายเหตุ: ตอนนี้ในคอลเลกชันมีทั้งหมด ${existing.size} จุด`);
  }
}

main().catch((err) => {
  console.error("Error seeding return points:", err);
  process.exit(1);
});