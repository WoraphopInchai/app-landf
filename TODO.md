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
- `tests/firestore.rules.test.ts` — 114 เทสต์สำหรับกฎ

---

## 7. รอบล่าสุด: ทางลัดดู/จัดการผู้ใช้ในแท็บแอดมิน

### 7.1 สิ่งที่เพิ่ม

- `src/AdminDashboard/Admin.tsx`
  - `UserLink` — ข้อความกดได้ (ชื่อ/อีเมล) ใช้ร่วมกันทุกแท็บ
  - `useUserInfo()` + `userInfoCache` — ดึงชื่อ/อีเมล/สถานะแบนจาก `users/{uid}` แล้วแคชใน memory
  - `UserIdentity` — การ์ดชื่อ + อีเมลที่กดได้ทั้งสองช่อง
  - `AdminUserSheet` — การ์ดผู้ใช้แบบทางลัด: ชื่อ, อีเมล, เบอร์, สิทธิ์, จุดประจำ, สถานะแบน,
    โพสต์ล่าสุด 20 รายการ, คำขอล่าสุด 20 รายการ
    (หัวหน้าแอดมินเท่านั้นที่ได้ปุ่มแบน/ปลดแบน และปุ่ม "จัดการผู้ใช้" ที่กระโดดไปแท็บ users)
  - `PostFactsGrid` — ชุดข้อมูลโพสต์ฉบับครบ (สถานะ, จุดฝาก, สถานที่, ประเภท/คณะ, รหัสอ้างอิง,
    พื้นที่ความปลอดภัย, วันที่พบ, เวลาส่ง, เริ่มดำเนินการ, ปิดเคส, คำขอที่กำลังจอง, Post ID, ผู้แจ้ง)
  - เสียบเข้า `AdminFoundApprovals`, `AdminClaims`, `AdminHistory`, `AdminPosts`
  - `AdminUsers` รับ `focusUser` เพื่อเปิดการ์ดของคนที่กดมาจากทางลัด

### 7.2 กฎ Firestore ที่เปลี่ยน (ต้อง deploy)

`match /users/{uid}` → เพิ่ม `isStaffAdmin(request.auth.uid)` ใน `allow read`
เพื่อให้เจ้าหน้าที่ประจำจุดเห็นชื่อ/อีเมลของผู้ขอรับของ

- เขียนยังเหมือนเดิม: ผู้ใช้แก้ของตัวเองได้, หัวหน้าแอดมินแก้ได้ทุกอย่าง, เจ้าหน้าที่แก้ของคนอื่นไม่ได้
- ข้อควรระวัง: Firestore rules คุมระดับ document — เจ้าหน้าที่จึงอ่านข้อมูลผู้ใช้ได้ทั้ง document
  (รวมฟิลด์ที่มีอยู่ใน schema ปัจจุบัน) หากไม่ต้องการ ให้ถอกลับบรรทัดนี้แล้วให้ staff เป็น read-only ที่ไม่มีข้อมูลติดต่อ

### 7.3 สถานะ

```
tsc / lint / build        : ผ่าน
npm run test:rules         : ผ่าน 95 เทสต์ (เพิ่มเคส staff อ่าน users 7 เคส + แก้เคสอนุมัติที่ต้องมีหลักฐาน)
firestore.rules (deploy)   : ยังไม่ได้ deploy
commit / push              : ยังไม่
```

### 7.4 ยังค้างจากรอบก่อน

- `confirmHandover` → `deleteDoc(evidenceRef)` ยังไม่ถูก await (ตอน retry อาจเจอหลักฐานเดิมแล้ว `setDoc` กลายเป็น update ที่กฎไม่อนุญาต)
- error `"เกิดข้อผิดพลาดในการยืนยัน"` ยังไม่ทราบสาเหตุจริงจาก browser (มี logging `[code] message` แล้ว)
- ยังไม่ได้ deploy frontend (Login/Profile/นัดรับของ/แชทเต็มจอ) และยังไม่ชัดว่า host ที่ production คือ Firebase Hosting หรือ Vercel
- `firestore.indexes.json` ยังไม่ได้ deploy แยก
- รูปหลักฐาน Cloudinary เป็น unsigned public URL → ยังไม่รับประกัน privacy

---

## 8. รอบล่าสุด: ประวัติลบได้ + ดูโพสต์คู่ + คืนของแล้วโพสต์หายไม่ขึ้นซ้ำ

### 8.1 หน้าประวัติ (`AdminHistory` ใน `src/AdminDashboard/Admin.tsx`)

- **ลบรายการประวัติ** — ปุ่ม "ลบ" ทั้งในการ์ดรายการและใน sheet รายละเอียด → `ConfirmModal` → `deleteDoc(claims/{claimId})`
  - ลบเฉพาะรายการที่ปิดเคสแล้ว (approved/rejected/expired/post_deleted) — คำขอที่ยัง `pending` ลบไม่ได้ (กฎบังคับ)
  - การลบไม่ย้อนสถานะโพสต์ (เจ้าของยังเห็นโพสต์ของตัวเองใน MyItems)
  - หมายเหตุ: ลบ claim แล้วเอกสารหลักฐานใน `claims/{id}/handover/evidence` จะยังค้างอยู่
    (Firestore ไม่ลบ subcollection อัตโนมัติ และกฎห้ามลบหลักฐานหลังอนุมัติ) → ข้อมูลค้างเล็กน้อย ไม่กระทบการแสดงผล
- **ดูรายละเอียดโพสต์** — ปุ่ม "โพสต์" ในการ์ดรายการ + ปุ่ม "ดูโพสต์ของพบ/ของหาย" ใน sheet
  → เปิด `ReviewSheet` ซ้อน (zIndex 340) พร้อม `ReviewImage` หลายรูป, คำอธิบาย, `UserIdentity` เจ้าของ, `PostFactsGrid`, lightbox
- **คืนของแล้ว → โพสต์คู่** — เฉพาะ `status === "approved"`:
  - ดึง `claim.postId` (โพสต์ของพบ) เสมอ
  - ดึง `claim.matchedPostId` (โพสต์ของหายที่ผู้ขอเลือก) **เฉพาะเมื่อมีค่านี้** — ไม่มีก็ไม่ query
  - แสดงเป็นกริดสองคอลัมน์ (`PairedPostCard`) พร้อมปุ่ม "ดูรายละเอียดโพสต์" ของแต่ละฝั่ง
  - อยู่ถัดจากรูปหลักฐานส่งมอบ → เห็นทั้งหลักฐานและโพสต์ทั้งสองฝั่งในที่เดียว
  - **ปฏิเสธ → แสดงตามปกติ ไม่ดึงโพสต์มาแสดงคู่**
  - โหลดผ่าน `loadPostDoc()` ซึ่งคืน `null` เมื่ออ่านไม่ได้ (เช่น staff ต่างจุด) → ไม่ทำหน้าจอพัง

### 8.2 คืนของแล้ว → โพสต์ของหายไม่ขึ้นซ้ำใน Home

- `confirmHandover()` เพิ่ม **จังหวะที่ 4**: หลัง transaction อนุมัติสำเร็จ
  `updateDoc(posts/{matchedPostId}, { status: "resolved", resolvedAt, matchedClaimId: claim.id })`
  - ทำ **แยกจาก transaction** เพราะกฎต้องเห็น `claim.status == 'approved'` (ใน transaction กฎยังเห็นเป็น `pending`
    ตารางคือเรื่องเดียวกับ `hasHandoverEvidence()`)
  - ไม่มี `matchedPostId` → ไม่แตะโพสต์ใด
  - ปิดไม่สำเร็จ → ไม่ย้อนการอนุมัติ แต่ขึ้น toast เตือนให้ตรวจสอบ (`matchedPostWarning`)
- `src/types.ts` → `PostItem.matchedClaimId?: string`
- `src/Pages/Home.tsx` → map `matchedClaimId` และกรอง `if (post.matchedClaimId) return false;` ใน `validPosts`
  - ตัวกรองทำก่อนจำนวนบนแท็บ (`countStatus` อ่านจาก `posts` ที่กรองแล้ว) → โพสต์หายไม่ขึ้นทุกแท็บ
    และจำนวน "คืนแล้ว" ไม่เพิ่ม (เหลือเฉพาะโพสต์พบฝั่งที่คืน)
  - เจ้าของยังเห็นสถานะ "พบเจ้าของแล้ว" ใน MyItems ตามปกติ

### 8.3 กฎ Firestore ที่เพิ่ม (ต้อง deploy)

- `claims` → `allow delete`: เพิ่มสิทธิ์แอดมินลบรายการประวัติ
  - หัวหน้าแอดมิน: ทุกเคส / เจ้าหน้าที่: เฉพาะ `depositLocation == staffPointName()`
  - จำกัด `status != 'pending'` (ผู้ขอลบ pending ของตัวเองได้เหมือนเดิม)
- `posts` → ฟังก์ชันใหม่ `canCloseMatchedLostPost(matchedLostPostId)` (เรียกจาก `allow update`)
  - ต้องมี `matchedClaimId` ที่ชี้คำขอจริง + คำขอ `approved` + `matchedPostId` ตรงกับโพสต์ที่แก้
    + ผู้ขอต้องเป็นเจ้าของโพสต์หาย + เป็น `itemType: lost` + ยังไม่ `resolved`
  - แก้ได้เฉพาะ `status`, `resolvedAt`, `matchedClaimId`
  - สิทธิ์: หัวหน้าแอดมิน หรือเจ้าหน้าที่ของจุดของ **โพสต์ของพบ** ในคำขอนั้น
  - ข้อควรระวัง: path wildcard (`postId`) ใช้ในฟังก์ชันระดับบนไม่ได้ ต้องส่งเป็น parameter
    (ไม่งั้นได้ "Null value error" แล้ว `allow update` พังทั้งบล็อก)

### 8.4 สาเหตุที่ของหายยังขึ้นใน Home ตอนอนุมัติ (เช็กจาก ruleset ที่ deploy จริง)

ตรวจ `releases/cloud.firestore` ของ `up-lost-and-found-54e23` (ruleset `0d4fc3e2…`, updateTime 2026-10-01 20:36)
→ **กฎบน production เป็นเวอร์ชัน commit `12cb639`** ยังไม่มี `canCloseMatchedLostPost`
และไม่มี `isStaffAdmin` ใน `match /users/{uid} allow read`

ผลคือ `updateDoc(posts/{matchedPostId})` ตอนอนุมัติโดน `PERMISSION_DENIED`
→ โพสต์ของหายยัง `active` → ยังขึ้นในหน้า Home (และ `Home.tsx` ที่กรอง `matchedClaimId` ก็ยังไม่ได้ deploy)

### 8.4b สาเหตุที่แก้จริง: `resolved` ยังอยู่ใน query ของฟีด (แก้แล้ว)

Home ดึง `where("status","in",["active","in_progress","resolved","under_investigation"])`
→ ถึงแม้โพสต์หายจะถูกปิดเป็น `resolved` แล้ว **มันก็ยังโผล่ในฟีด** (แท็บ "คืนแล้ว")
การกรองด้วย `matchedClaimId` จึงพึ่งการ deploy หน้าเว็บ ซึ่งยังไม่ได้ทำ

**วิธีแก้ที่ไม่ต้องรอ deploy หน้าเว็บ:** ใช้สถานะใหม่ `returned_matched`
(ตั้งใจให้ต่างจาก `resolved` เพราะ Home ไม่ได้ดึงสถานะนี้ → โพสต์หายที่คืนแล้วหายจากฟีดทันที
ไม่ขึ้นแท็บ "ของหาย" และไม่ไปรวมในจำนวน "คืนแล้ว")

จุดที่ต้องแก้ให้รองรับ `returned_matched`:
- `firestore.rules` `canCloseMatchedLostPost` — บังคับสถานะเป็น `returned_matched`
- `Admin.tsx` `closeMatchedLostPostDoc()` — เขียน `status: "returned_matched"`
- `POST_STATUS_META` — ป้าย "คืนแล้ว (จับคู่กับโพสต์ของพบ)"
- `MyItems.tsx` `getStatusInfo()` — เจ้าของเห็นเป็น "พบเจ้าของแล้ว"
- `ItemDetail.tsx` `isResolved` — รวม `returned_matched` (เจ้าของเห็นว่าจบแล้ว/กดขอรับซ้ำไม่ได้)
- ปุ่มซ่อมในหน้าประวัติเช็ค `!== "returned_matched"` (เดิมเช็ค `resolved`)

`Home.tsx` ยังกรอง `matchedClaimId` ไว้เป็นชั้นกันพลาด (โพสต์ `resolved` รุ่นเก่าที่ deploy ค้างไว้)

**หลักฐานจากข้อมูล production:**
- claim ที่อนุมัติ 2026-10-01 20:41 และ 20:55 UTC เกิด**ก่อน** deploy กฎ → ปิดโพสต์หายไม่สำเร็จ
- โพสต์หาย `nTlSMPaisXbyQdJGdCwQ` ค้าง `active` ไม่มี `matchedClaimId` → ยังอยู่ในฟีด
- backfill แล้ว: `status = returned_matched`, `matchedClaimId = 5nhuwfUG7KER87UD8iHH`
- ยืนยันหลัง backfill: ไม่อยู่ในฟีด `active` แล้ว

```bash
npx firebase deploy --only firestore:rules      # ✅ deploy แล้ว (ครั้งที่ 2)
```

**เหลือ: deploy frontend** — ยังไม่ชัดว่า production โฮสต์ที่ Firebase Hosting หรือ Vercel (รอผู้ใช้ยืนยัน)
แต่ **ไม่กระทบการหายจากฟีดแล้ว** เพราะใช้สถานะ `returned_matched` ที่ถูกตัดออกตั้งแต่ query ฝั่ง server
สิ่งที่ยังรอ deploy หน้าเว็บ: ป้ายสถานะ/ไอคอนใหม่ใน `Home.tsx`, ปุ่มซ่อม "ปิดโพสต์ของหาย" ในหน้าประวัติ,
`MyItems.tsx` กับ `ItemDetail.tsx` ที่แก้รองรับสถานะใหม่ — ค่านี้ไม่กระทบว่าโพสต์หายโผล่ในฟีดหรือไม่

**ทางแก้เคสที่อนุมัติไปแล้ว (ต้อง deploy หน้าเว็บถึงจะกดได้):**
หน้าประวัติแสดงการ์ดคู่ → ถ้าโพสต์หายที่ผู้ขอเลือกยังไม่ `returned_matched`
จะขึ้นกล่องเตือน + ปุ่ม **"ปิดโพสต์ของหาย"** (`handleCloseMatchedPost`) → กดแล้วหายจาก Home ทันที
(รอบนี้ backfill เคสที่ค้างบน production ให้แล้วโดยตรง ดูหลักฐานข้างบน)

### 8.5 สถานะ

```
tsc / lint / build        : ผ่าน
npm run test:rules         : ผ่าน 114 เทสต์ (เพิ่มประวัติลบ 8 เคส + ปิดโพสต์หายที่จับคู่ 9 เคส)
firestore.rules (deploy)   : ✅ deploy แล้ว 2 รอบ — รวมกฎรอบที่ 7 และรอบที่ 8 (สถานะ returned_matched)
backfill production        : ✅ ปิดโพสต์หาย nTlSMPaisXbyQdJGdCwQ ที่ค้างจากการอนุมัติก่อน deploy กฎ
commit / push              : ยังไม่
```

### 8.6 ยังต้องทดสอบใน browser

- อนุมัติคำขอที่มี `matchedPostId` → ตรวจว่าโพสต์หายหายจาก Home ทันที และจำนวน "คืนแล้ว" เพิ่มขึ้น 1
- หน้าประวัติ: เปิดรายการที่คืนของแล้ว → ต้องเห็น 2 การ์ด + หลักฐานส่งมอบ; รายการที่ปฏิเสธต้องไม่มีส่วนคู่
- ลบรายการประวัติทั้งในการ์ดและใน sheet + ทดสอบ staff ต่างจุด (ต้องขึ้น "ลบไม่สำเร็จ")

