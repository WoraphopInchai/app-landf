# TODO — งานค้างและขั้นตอนการ Deploy

อ่านไฟล์นี้ก่อนเริ่มงาน เพื่อรู้ว่าอะไรยังไม่เสร็จและต้องทำอะไรต่อ

## สถานะปัจจุบัน

```
branch:              fix/claims-index
commit ล่าสุด:        b88cc0d
งานที่แก้ล่าสุด:      ยังไม่ commit / push / deploy
production:          ยังรันโค้ดเก่าอยู่ (up-lost-and-found-54e23)
ไฟล์ใหม่ที่ยังไม่ git add: 6 ไฟล์ (ดูข้อ 1.1)
```

---

## 1. ⚠️ งานค้าง — ต้องทำก่อน deploy

### 1.1 `git add` ไฟล์ใหม่ 6 ไฟล์ (บังคับ)

ถ้าไม่ add build บน Vercel จะพังด้วย `module not found` เพราะไฟล์เหล่านี้ถูก import จริงทั้งหมด

```
src/AdminDashboard/ReviewSheet.tsx     <- Admin.tsx
src/components/Dialog.tsx              <- ConfirmModal, LogoutConfirmModal, RevokedModal, Home, ItemDetail, Profile, ReportItem, App
src/components/ImageCountBadge.tsx     <- Home.tsx, MyItems.tsx
src/lib/claimRole.ts                   <- ItemDetail.tsx
src/lib/loginChannel.ts                <- Login.tsx
src/lib/postImages.ts                  <- Admin, ImageCountBadge, Home, ItemDetail, MyItems, ReportItem
```

### 1.2 แก้เทสต์ให้ตรงกับกฎ 3 วัน

`firestore.rules` เปลี่ยนจากนัดได้ 7 วัน → 3 วัน แต่เทสต์ยังเขียนตามกฎเก่า

| บรรทัด | ปัจจุบัน | ต้องแก้ |
|---|---|---|
| 140 | คอมเมนต์ `ในช่วง [now-5min, now+7วัน]` | เปลี่ยนเป็น `now+3วัน` |
| 211 | `it("expiresAtMs เกิน 7 วัน (ล็อกโพสต์ถาวร) → denied")` ใช้ `NOW_MS + 8 * DAY` | เปลี่ยนชื่อเป็น "เกิน 3 วัน" และใช้ `NOW_MS + 4 * DAY` |

**เพิ่มเทสต์ขอบเขตใหม่ 2 ตัว** (ตอนนี้ไม่มี ทำให้ถ้าเผลอแก้กฎกลับเป็น 7 วัน เทสต์ยังผ่านหมด ไม่มีอะไรจับได้)

```ts
it("expiresAtMs = now+3วัน (ขอบเขตสูงสุด) ผ่านได้", ...)   // NOW_MS + 3 * DAY
it("expiresAtMs เกิน 3 วัน (นัดล่าสุดวันที่ 4) → denied", ...)  // NOW_MS + 4 * DAY
```

### 1.3 รันเทสต์

```bash
npm run test:rules
```

ใช้ Firebase Emulator — ครั้งแรกดาวน์โหลด ~300MB ใช้เวลา 5-10 นาที

### 1.4 ตรวจว่าไฟล์ลับไม่ติดไปด้วย

```
.env                    ← ห้าม stage
firebase-admin-key.json ← ห้าม stage
vercel-env-template.txt ← ห้าม stage
```

ตรวจด้วย `git status` ก่อน commit ทุกครั้ง

### 1.5 commit + push

---

## 2. บั๊กที่เจอแต่ยังไม่ได้แก้

| บั๊ก | ที่ไหน | ผลกระทบ |
|---|---|---|
| `accountType` เก็บแค่ localStorage | — | เปลี่ยนเครื่องแล้ว role ขอรับของผิด |
| session email ว่างแล้วส่ง claim ไม่ได้ | `ItemDetail.tsx:708` | ผู้ใช้ติดขัด ต้องออกจากระบบแล้วล็อกอินใหม่ |
| `studentId: isStudentRole ? "" : ""` | `ItemDetail.tsx:749` | dead ternary ไม่ได้ทำอะไร |
| นิสิตไม่ถูกบังคับให้ใช้ `@up.ac.th` | `Login.tsx` | ล็อกอินด้วยอีเมลอื่นได้ |
| admin listener กลืน error ไปที่ console | `Admin.tsx` หลายจุด | ขึ้น "ไม่มีข้อมูล" ทั้งที่โหลดไม่ได้ |
| rules ไม่ตรวจ ownership/type ของ `matchedPostId` | `firestore.rules` | ชี้จับคู่ของหายของคนอื่นได้ |
| claim/notification ไม่ carry รูป + จุดฝาก | `ItemDetail.tsx` | แอดมินต้องเปิดโพสต์เพื่อดูรูป |

---

## 3. ลำดับการ deploy

```bash
npm run build
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only hosting
```

| คำสั่ง | ถ้าไม่ทำ |
|---|---|
| `firestore:rules` | นัด 7 วันยังผ่านได้ — กฎใหม่ไม่มีผล |
| `firestore:indexes` | point staff โหลดคำขอรับของไม่ได้ (รอสัก 1-2 นาทีหลัง deploy) |
| `hosting` | เว็บยังรันโค้ดเก่าอยู่ |

รวมคำสั่งเดียวได้:

```bash
npm run build && firebase deploy --only firestore:rules,firestore:indexes,hosting
```

### ❌ ห้าม deploy Cloud Function

```bash
# firebase deploy --only functions   ← ห้ามรัน
```

`functions/` เป็นเวอร์ชันเก่าที่ไม่ได้ deploy (endpoint ตอบ 404) และขาด logic เก็บแมทเดิมตอน re-scan
ถ้า deploy จะเขียนทับผลแมทของฝั่งอื่นจน **คู่ที่ผู้ใช้ยืนยันแล้วหายไปทั้งระบบ**
นอกจากนี้โปรเจกต์อยู่บนแผน Spark (ฟรี) ซึ่ง deploy functions ไม่ได้อยู่แล้ว

เส้นทางที่ใช้งานจริงคือ `POST /api/reconcile` บน Vercel (`api/` ที่ repo root)
เรียกตอนเปิดแอป (`src/Pages/Home.tsx` → `triggerBackgroundSweep()`) + GitHub Actions `.github/workflows/reconcile.yml`

---

## 4. ตรวจสอบหลัง deploy

### ฝั่งผู้ใช้
- เปิดฟอร์ม "ส่งคำขอรับของ" → กดนัดวัน-เวลา
- ช่องวันที่ต้องไม่เกิน 3 วันนับจากวันนี้
- พิมพ์เวลา `20:00` แล้วต้องเด้งเป็น `16:00`
- ตัวเลือกลัดทุกตัวต้องอยู่ในช่วง 07:00-16:00

### ฝั่งแอดมิน
- แท็บ **รายงาน** → กดรายงานที่มีโพสต์ → ต้องเห็นรูปเล็ก 72×72 ซ้าย
- กด "ตรวจสอบรายละเอียดโพสต์ฉบับเต็ม" → ต้องเห็น badge สถานะบนหัวกรอบ
- แท็บ **จัดการโพสต์** → กล่องรายละเอียดต้องมีหัวข้อ `รายละเอียด`

### เจ้าหน้าที่ประจำจุด (point staff)
- โหลดคำขอรับของได้ไหม — ถ้า error `FAILED_PRECONDITION` = index ยังไม่เสร็จ รอ 1-2 นาทีแล้วลองใหม่
- ตรวจสอบคำขอได้ไหม (ใช้ query `postId + status + depositLocation`)

### บัญชีทดสอบ
- นิสิต 2 บัญชี
- เจ้าหน้าที่ 1 บัญชี
- super admin (whitelist)

---

## 5. ข้อควรระวัง

```
.env ชี้ไปที่ Firebase production (up-lost-and-found-54e23)
   → ทดสอบบน localhost แล้วข้อมูลจริงถูกเขียนลงฐานข้อมูลจริง
   → ใช้บัญชีทดสอบ และลบข้อมูลทดสอบทิ้งหลังเสร็จ
```

### ถ้าพังหลัง deploy

```bash
git revert <commit>
firebase deploy --only firestore:rules
```

### คำสั่งตรวจสอบก่อน commit ทุกครั้ง

```bash
npx tsc -b
npm run lint
npm run build
npm run test:rules
git status --short
```

---

## 6. อ้างอิง

- `DEPLOY_CHECKLIST.md` — ขั้นตอน deploy เดิม + วิธี seed จุดคืนเริ่มต้น 6 จุด
- `firestore.rules` — กฎความปลอดภัย (กฎนัดรับของอยู่ที่ `canCreateValidClaim()`)
- `firestore.indexes.json` — 17 index (สำคัญที่สุด: `claims[postId + status + depositLocation]`)
- `tests/firestore.rules.test.ts` — 79 เทสต์สำหรับกฎ
