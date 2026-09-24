# ขั้นตอนการ Deploy

> โฟลว์ทั้งหมดที่แก้ไขไป:
> 1. จองโพสต์ทันทีเมื่อกด "ขอรับของ" (24 ชม. / นัดวัน)
> 2. admin ยืนยันส่งมอบ → "คืนแล้ว" + 7 วัน
> 3. admin ปฏิเสธ → ปล่อยโพสต์กลับ active
> 4. ท้วงไม่บล็อกโพสต์ / กันท้วงซ้ำ / กันคนแบน
> 5. สถิติคืนแล้วถูกต้อง + แก้บั๊กล็อกอิน admin
> 6. ระบบแอดมินแบบ 2 ระดับ: หัวหน้าแอดมิน (super_admin) จัดการจุดคืน/เจ้าหน้าที่/โพสต์/รายงาน/ผู้ใช้
>    และเจ้าหน้าที่ประจำจุด (admin + adminAccounts/{email}) อนุมัติของพบ/คำขอรับของเฉพาะจุดตัวเอง

## ลำดับการ Deploy (ทำจากโฟลเดอร์โปรเจกต์หลัก D:\App-LandF-main)

1. **Build หน้าเว็บ (ฝั่งผู้ใช้/admin)** — สร้างโฟลเดอร์ `dist/`
   ```
   npm run build
   ```

2. **Deploy Security Rules (Firestore)** — สำคัญ! ถ้าไม่ deploy rules หน้า admin/จุดคืนจะถูกบล็อก
   ```
   firebase deploy --only firestore:rules
   ```

3. **Deploy หน้าเว็บขึ้น Firebase Hosting**
   ```
   firebase deploy --only hosting
   ```

4. **Deploy Cloud Function** (ตัวปิดคำขอที่หมดอายุทุก 10 นาที + AI จับคู่ของหาย)
   — ระบบจะ build functions ให้อัตโนมัติ (มี predeploy ตั้งไว้)
   ```
   firebase deploy --only functions
   ```
   > ⚠️ **ข้อจำกัด:** โปรเจกต์ `up-lost-and-found-54e23` อยู่บนแผน **Spark (ฟรี)** → deploy functions ไม่ได้
   > ต้อง **อัปเกรดเป็น Blaze (pay-as-you-go)** ก่อน (ไม่มีค่าใช้จ่ายถ้าไม่เกิน quota ฟรีของ Cloud Functions/Firestore)
   > Upgrade ได้ที่: https://console.firebase.google.com/project/up-lost-and-found-54e23/usage/details
   > สถานะล่าสุด (22 ก.ย. 69): rules + hosting deploy แล้ว — functions ยังรออัปเกรด

หรือรันทั้งหมดในคำสั่งเดียว:
```
npm run build
firebase deploy
```

## ตรวจสอบหลัง Deploy

- ล็อกอินด้วยอีเมลหัวหน้าแอดมิน (whitelist) → หน้า Admin ต้องขึ้นแท็บ "จัดการแอดมิน" / "จัดการโพสต์" / "รายงาน" / "จัดการผู้ใช้"
- ไปที่ "จัดการแอดมิน" → เพิ่มจุดคืนเริ่มต้น 6 จุด (หรือรันสคริปต์ seed ด้านล่าง) แล้วมอบสิทธิ์อีเมลเจ้าหน้าที่ประจำแต่ละจุด
- ล็อกอินแบบ Admin ด้วยอีเมลเจ้าหน้าที่ → ต้องเห็นเฉพาะแท็บ "ภาพรวม / รับโพสต์ของพบ / คำขอรับของ / ประวัติ" และกริ่งแจ้งเตือนเฉพาะจุดตัวเอง

### Seed จุดคืนเริ่มต้น (รองรับ 6 จุดตามแบบฟอร์มแจ้งของพบ)
รันจากโฟลเดอร์ `functions` (ต้องมี Service Account key ของโปรเจกต์):
```
GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\serviceAccountKey.json" node seed-return-points.js
```

## หมายเหตุ
- ถ้ายังไม่ติดตั้ง dependencies ของ functions:
  - cd functions
  - npm install
- Cloud Function จะเริ่มทำงานจริงหลัง deploy แล้วเท่านั้น
- ถ้า deploy ERROR เรื่องฟังก์ชัน "expireStaleClaims" ให้ดู Log:
  ```
  firebase functions:log
  ```
- เปลี่ยนชื่อจุดคืนในหน้า "จัดการแอดมิน" จะอัปเดตชื่อใน `posts` + `adminAccounts` ให้ด้วย (rules เปรียบเทียบ `depositLocation` กับ `pointName` ของเจ้าหน้าที่)
- ถอดสิทธิ์เจ้าหน้าที่ (แทนที่อีเมล / ลบ) จะรีเซ็ต role เป็น `user` และแจ้งเตือนไปที่เจ้าหน้าที่คนนั้นทันที