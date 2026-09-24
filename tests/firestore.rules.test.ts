import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

// ---- ค่าคงที่จำลอง (ตรงกับ payload จริงของ app) ----
const LIB_POINT = "อาคารเรียนรวม 1 (ภ.ป.ร.)";
const SCI_POINT = "คณะวิทยาศาสตร์";

const SUPER_UID = "superUid";
const STAFF_LIB_UID = "staffLibUid";
const STAFF_LIB_EMAIL = "stafflib@up.ac.th";
const STAFF_SCI_UID = "staffSciUid";
const STAFF_SCI_EMAIL = "staffsci@up.ac.th";
const OWNER_UID = "ownerUid";
const USER_B_UID = "userB";
const USER_C_UID = "userC";

const NOW_MS = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let env: RulesTestEnvironment;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const seedUser = (db: any, uid: string, overrides: Record<string, unknown> = {}) =>
  db.collection("users").doc(uid).set({
    role: "user",
    banned: false,
    email: `${uid}@example.com`,
    name: uid,
    ...overrides,
  });

const seedAdminAccount = (db: any, email: string, pointName: string, uid: string) =>
  db.collection("adminAccounts").doc(email).set({
    pointId: email,
    pointName,
    uid,
    active: true,
  });

const seedFoundPost = (db: any, id: string, depositLocation: string, extra: Record<string, unknown> = {}) =>
  db.collection("posts").doc(id).set({
    title: "กระติกน้ำสีฟ้า",
    itemType: "found",
    status: "active",
    userId: OWNER_UID,
    depositLocation,
    ...extra,
  });

const seedClaim = (
  db: any,
  id: string,
  claimantId: string,
  postId: string,
  depositLocation: string,
  extra: Record<string, unknown> = {}
) =>
  db.collection("claims").doc(id).set({
    claimantId,
    postId,
    depositLocation,
    status: "pending",
    expiresAtMs: NOW_MS + 24 * HOUR,
    ...extra,
  });

const seedReport = (db: any, id: string, reporterId: string, postId: string) =>
  db.collection("reports").doc(id).set({
    type: "post_report",
    reporterId,
    postId,
    status: "open",
    detail: "รายงานเริ่มต้น",
  });

const seedNotification = (db: any, id: string, data: Record<string, unknown>) =>
  db.collection("notifications").doc(id).set({ read: false, ...data });

beforeAll(async () => {
  const rules = fs.readFileSync(
    path.resolve(process.cwd(), "firestore.rules"),
    "utf8"
  );
  env = await initializeTestEnvironment({
    projectId: "demo-up-lost-and-found",
    firestore: { host: "127.0.0.1", port: 8080, rules },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await seedUser(db, SUPER_UID, { role: "super_admin" });
    await seedUser(db, STAFF_LIB_UID, { role: "admin", email: STAFF_LIB_EMAIL });
    await seedUser(db, STAFF_SCI_UID, { role: "admin", email: STAFF_SCI_EMAIL });
    await seedUser(db, OWNER_UID);
    await seedUser(db, USER_B_UID);
    await seedUser(db, USER_C_UID);
    await seedAdminAccount(db, STAFF_LIB_EMAIL, LIB_POINT, STAFF_LIB_UID);
    await seedAdminAccount(db, STAFF_SCI_EMAIL, SCI_POINT, STAFF_SCI_UID);
    await seedFoundPost(db, "postA", LIB_POINT);
    await seedFoundPost(db, "postResolved", LIB_POINT, { status: "resolved" });
    await seedFoundPost(db, "postPendingFound", LIB_POINT, { status: "pending" });
    await db.collection("posts").doc("postLost").set({
      title: "กุญแจหาย",
      itemType: "lost",
      status: "active",
      userId: OWNER_UID,
      depositLocation: "",
    });
    await seedClaim(db, "claimA", USER_B_UID, "postA", LIB_POINT);
    await seedClaim(db, "claimResolved", USER_C_UID, "postResolved", LIB_POINT);
    await seedReport(db, "report1", USER_B_UID, "postA");
    await seedNotification(db, "notifSelf", { recipientUid: USER_B_UID, type: "x" });
    await seedNotification(db, "notifAdminLib", { recipientRole: "admin", pointName: LIB_POINT, type: "claim" });
    await seedNotification(db, "notifAdminSci", { recipientRole: "admin", pointName: SCI_POINT, type: "claim" });
  });
  await sleep(50);
});

const authAs = (uid: string, tokenOptions?: Record<string, unknown>) =>
  env.authenticatedContext(uid, tokenOptions);

// =====================================================================
// A2 - claims create: ต้องอ้างอิงโพสต์ของพบจริง จุดตรงกัน และ expiresAtMs
// ในช่วง [now-5min, now+7วัน]
// =====================================================================
describe("A2 claims create — validation", () => {
  const baseClaim = {
    itemId: "postA",
    postTitle: "กระติกน้ำสีฟ้า",
    itemType: "found",
    postImageUrl: "",
    claimantName: "นิสิตใจดี",
    claimType: "student",
    studentId: "6409999",
    phone: "0812345678",
    contact: "0812345678",
    note: "",
    status: "pending",
  };

  it("สร้างคำขอที่ถูกต้อง (โพสต์ของพบ, จุดตรง, expiresAtMs = now+24h) ผ่านได้", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertSucceeds(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postA",
        claimantId: USER_C_UID,
        depositLocation: LIB_POINT,
        expiresAtMs: NOW_MS + 24 * HOUR,
        createdAt: new Date(),
      })
    );
  });

  it("postId ไม่มีอยู่จริง → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postNonexistent",
        claimantId: USER_C_UID,
        depositLocation: LIB_POINT,
        expiresAtMs: NOW_MS + 24 * HOUR,
      })
    );
  });

  it("postId เป็นโพสต์ของหาย (lost) → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postLost",
        itemType: "lost",
        claimantId: USER_C_UID,
        depositLocation: "",
        expiresAtMs: NOW_MS + 24 * HOUR,
      })
    );
  });

  it("depositLocation ไม่ตรงกับโพสต์ → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postA",
        claimantId: USER_C_UID,
        depositLocation: SCI_POINT,
        expiresAtMs: NOW_MS + 24 * HOUR,
      })
    );
  });

  it("expiresAtMs เกิน 7 วัน (ล็อกโพสต์ถาวร) → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postA",
        claimantId: USER_C_UID,
        depositLocation: LIB_POINT,
        expiresAtMs: NOW_MS + 8 * DAY,
      })
    );
  });

  it("expiresAtMs ในอดีต → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postA",
        claimantId: USER_C_UID,
        depositLocation: LIB_POINT,
        expiresAtMs: NOW_MS - HOUR,
      })
    );
  });

  it("claimantId != auth.uid → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postA",
        claimantId: USER_B_UID,
        depositLocation: LIB_POINT,
        expiresAtMs: NOW_MS + 24 * HOUR,
      })
    );
  });

  it("ผู้ใช้ถูกแบน → denied", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("users").doc(USER_C_UID).update({ banned: true });
    });
    await sleep(50);
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("claims").doc("newClaim").set({
        ...baseClaim,
        postId: "postA",
        claimantId: USER_C_UID,
        depositLocation: LIB_POINT,
        expiresAtMs: NOW_MS + 24 * HOUR,
      })
    );
  });
});

// =====================================================================
// A1 - reports update: จำกัด field เป็น status เท่านั้น
// =====================================================================
describe("A1 reports update — เจ้าของโพสต์/ผู้ใช้ทั่วไปแก้รายงานไม่ได้", () => {
  it("เจ้าของรายงานเปลี่ยน status → closed (แก้เอง) denied", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(db.collection("reports").doc("report1").update({ status: "closed" }));
  });

  it("เจ้าของโพสต์เปลี่ยน status → closed (ปิดปากผู้แจ้ง) denied", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(db.collection("reports").doc("report1").update({ status: "closed" }));
  });

  it("เจ้าของโพสต์แก้ detail (ลบหลักฐาน) denied", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(db.collection("reports").doc("report1").update({ detail: "" }));
  });

  it("เจ้าของโพสต์ลบโพสต์ → ตั้ง status=post_deleted ได้", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertSucceeds(db.collection("reports").doc("report1").update({ status: "post_deleted" }));
  });

  it("แอดมินเปลี่ยน status → closed ได้", async () => {
    const db = authAs(SUPER_UID).firestore();
    await assertSucceeds(db.collection("reports").doc("report1").update({ status: "closed" }));
  });

  it("แอดมินแก้ field อื่น (detail) → denied", async () => {
    const db = authAs(SUPER_UID).firestore();
    await assertFails(db.collection("reports").doc("report1").update({ detail: "แก้เอง" }));
  });

  it("ผู้ใช้ไม่เกี่ยวข้อง → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(db.collection("reports").doc("report1").update({ status: "closed" }));
  });
});

// =====================================================================
// A3 - notifications create: ต้องอ้างอิงข้อมูลจริง ห้ามชี้จุด/สวมชื่อปลอม
// =====================================================================
describe("A3 notifications create — กันปลอมแปลง", () => {
  it("type=claim ที่ถูกต้อง (claim จริงของผู้ใช้เอง + pointName ตรงโพสต์) ผ่าน", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertSucceeds(
      db.collection("notifications").add({
        type: "claim",
        recipientRole: "admin",
        pointName: LIB_POINT,
        claimId: "claimA",
        postId: "postA",
        postTitle: "กระติกน้ำสีฟ้า",
        itemType: "found",
        claimantName: "นิสิตใจดี",
        read: false,
      })
    );
  });

  it("type=claim pointName ชี้จุดอื่น → denied", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "claim",
        recipientRole: "admin",
        pointName: SCI_POINT,
        claimId: "claimA",
        postId: "postA",
        read: false,
      })
    );
  });

  it("type=claim อ้าง claim ของคนอื่น → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "claim",
        recipientRole: "admin",
        pointName: LIB_POINT,
        claimId: "claimA",
        postId: "postA",
        read: false,
      })
    );
  });

  it("type=found_pending ถูกต้อง + reporterId==uid ผ่าน", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertSucceeds(
      db.collection("notifications").add({
        type: "found_pending",
        recipientRole: "admin",
        pointName: LIB_POINT,
        postId: "postPendingFound",
        postTitle: "กระติกน้ำสีฟ้า",
        itemType: "found",
        reporterId: OWNER_UID,
        reporterName: "ผู้พบ",
        read: false,
      })
    );
  });

  it("type=found_pending reporterId != uid → denied", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "found_pending",
        recipientRole: "admin",
        pointName: LIB_POINT,
        postId: "postPendingFound",
        reporterId: USER_B_UID,
        read: false,
      })
    );
  });

  it("type=post_report ถูกต้อง (pointName ตรง + reporterId==uid) ผ่าน", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertSucceeds(
      db.collection("notifications").add({
        type: "post_report",
        recipientRole: "admin",
        pointName: LIB_POINT,
        postId: "postA",
        reporterId: USER_B_UID,
        read: false,
      })
    );
  });

  it("type=post_report pointName ไม่ตรงโพสต์ → denied", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "post_report",
        recipientRole: "admin",
        pointName: SCI_POINT,
        postId: "postA",
        reporterId: USER_B_UID,
        read: false,
      })
    );
  });

  it("type=post_report postId ไม่มีอยู่จริง → denied", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "post_report",
        recipientRole: "admin",
        postId: "postNonexistent",
        reporterId: USER_B_UID,
        read: false,
      })
    );
  });

  it("type=support_message ถูกต้อง (มี reporterId, ไม่มี pointName/postId) ผ่าน", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertSucceeds(
      db.collection("notifications").add({
        type: "support_message",
        recipientRole: "admin",
        reporterId: USER_B_UID,
        reporterName: "ผู้ใช้",
        category: "ปัญหา",
        detail: "ช่วยหน่อย",
        read: false,
      })
    );
  });

  it("type=support_message ใส่ pointName → denied", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "support_message",
        recipientRole: "admin",
        pointName: LIB_POINT,
        reporterId: USER_B_UID,
        read: false,
      })
    );
  });

  it("type=support_message reporterId != uid → denied", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "support_message",
        recipientRole: "admin",
        reporterId: OWNER_UID,
        read: false,
      })
    );
  });

  it("self-notify + recipientRole=admin (ปลอมเป็นแอดมิน) → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "claim",
        recipientRole: "admin",
        recipientUid: USER_C_UID,
        pointName: LIB_POINT,
        read: false,
      })
    );
  });

  it("self-notify ธรรมดา (recipientUid==uid, ไม่มี recipientRole) ผ่าน", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertSucceeds(
      db.collection("notifications").add({
        type: "x",
        recipientUid: USER_C_UID,
        read: false,
      })
    );
  });

  it("admin สร้าง notification ปลายทางใครก็ได้ (recipientUid by admin) ผ่าน", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertSucceeds(
      db.collection("notifications").add({
        type: "claim_result",
        recipientUid: USER_B_UID,
        claimId: "claimA",
        postId: "postA",
        read: false,
      })
    );
  });

  it("type=claim_result by เจ้าของโพสต์ (claim จริงผูกโพสต์) ผ่าน", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertSucceeds(
      db.collection("notifications").add({
        type: "claim_result",
        recipientUid: USER_B_UID,
        claimId: "claimA",
        postId: "postA",
        read: false,
      })
    );
  });

  it("type=claim_result โดยผู้ไม่ใช่เจ้าของโพสต์ → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "claim_result",
        recipientUid: USER_B_UID,
        claimId: "claimA",
        postId: "postA",
        read: false,
      })
    );
  });

  it("type=claim_result อ้าง claimId ที่ไม่มีจริง → denied", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "claim_result",
        recipientUid: USER_B_UID,
        claimId: "claimNonexistent",
        postId: "postA",
        read: false,
      })
    );
  });

  it("type=claim_result + recipientRole=admin (ปลอมกริ่ง) → denied", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(
      db.collection("notifications").add({
        type: "claim_result",
        recipientRole: "admin",
        recipientUid: USER_B_UID,
        pointName: SCI_POINT,
        claimId: "claimA",
        postId: "postA",
        read: false,
      })
    );
  });
});

// =====================================================================
// A4 - notifications update: แก้ได้เฉพาะ read / แอดมินเพิ่ม pointName ได้
// =====================================================================
describe("A4 notifications update — จำกัด field", () => {
  it("ผู้รับ mark read ของแจ้งตัวเอง ผ่าน", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertSucceeds(db.collection("notifications").doc("notifSelf").update({ read: true }));
  });

  it("ผู้รับแก้ field อื่น (pointName) → denied", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(
      db.collection("notifications").doc("notifSelf").update({ pointName: SCI_POINT })
    );
  });

  it("ผู้รับแก้ recipientRole → denied (กันปลอมเป็นแอดมิน)", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertFails(
      db.collection("notifications").doc("notifSelf").update({ recipientRole: "admin" })
    );
  });

  it("ผู้ใช้ทั่วไป update notification ฝั่ง admin → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("notifications").doc("notifAdminLib").update({ read: true })
    );
  });

  it("staff จุดตรงกัน mark read notification จุดตัวเอง ผ่าน", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertSucceeds(db.collection("notifications").doc("notifAdminLib").update({ read: true }));
  });

  it("staff จุดตรงกันแก้ pointName notification จุดตัวเอง → denied", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertFails(
      db.collection("notifications").doc("notifAdminLib").update({ pointName: SCI_POINT })
    );
  });

  it("staff จุดอื่นแก้ notification จุดอื่น → denied", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertFails(
      db.collection("notifications").doc("notifAdminSci").update({ read: true })
    );
  });

  it("super admin แก้ read+pointName (เปลี่ยนชื่อจุดคืน) ผ่าน", async () => {
    const db = authAs(SUPER_UID).firestore();
    await assertSucceeds(
      db.collection("notifications").doc("notifAdminLib").update({ read: true, pointName: "จุดใหม่" })
    );
  });
});

// =====================================================================
// Regression — ของเดิมที่แก้ไปแล้วยังทำงานถูกต้อง
// =====================================================================
describe("Regression — กันจองซ้อน / staff scope / double hand-out / owner", () => {
  it("canReserve: เจ้าของคำขอยังจองโพสต์ได้ (claimA pending, postId ตรง)", async () => {
    const db = authAs(USER_B_UID).firestore();
    await assertSucceeds(
      db.collection("posts").doc("postA").update({
        status: "in_progress",
        inProgressAt: new Date().toISOString(),
        reservationClaimId: "claimA",
      })
    );
  });

  it("canReserve: ผู้ใช้ใหม่จองซ้อนขณะ claim เดิมยัง pending → denied", async () => {
    const db = authAs(USER_C_UID).firestore();
    await assertFails(
      db.collection("posts").doc("postA").update({
        status: "in_progress",
        inProgressAt: new Date().toISOString(),
        reservationClaimId: "claimA", // อ้าง claim ของคนอื่น
      })
    );
  });

  it("canReserve: claim เดิมหมดอายุ (expiresAtMs ในอดีต) → จองใหม่ได้", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection("claims")
        .doc("claimA")
        .update({ expiresAtMs: NOW_MS - HOUR });
    });
    await sleep(50);
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .collection("claims")
        .doc("claimC")
        .set({
          claimantId: USER_C_UID,
          postId: "postA",
          depositLocation: LIB_POINT,
          status: "pending",
          expiresAtMs: NOW_MS + 24 * HOUR,
        });
    });
    await sleep(50);
    const db = authAs(USER_C_UID).firestore();
    await assertSucceeds(
      db.collection("posts").doc("postA").update({
        status: "in_progress",
        inProgressAt: new Date().toISOString(),
        reservationClaimId: "claimC",
      })
    );
  });

  it("staff อนุมัติ claim ของจุดตัวเองผ่านได้", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertSucceeds(
      db.collection("claims").doc("claimA").update({
        status: "approved",
        reviewedAt: new Date().toISOString(),
        reviewedByUid: STAFF_LIB_UID,
      })
    );
  });

  it("staff จุดอื่นอนุมัติ claim จุดนี้ → denied", async () => {
    const db = authAs(STAFF_SCI_UID, { email: STAFF_SCI_EMAIL }).firestore();
    await assertFails(
      db.collection("claims").doc("claimA").update({
        status: "approved",
        reviewedAt: new Date().toISOString(),
        reviewedByUid: STAFF_SCI_UID,
      })
    );
  });

  it("double hand-out: โพสต์ resolved แล้วอนุมัติ claim ต่อ → denied", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertFails(
      db.collection("claims").doc("claimResolved").update({
        status: "approved",
        reviewedAt: new Date().toISOString(),
        reviewedByUid: STAFF_LIB_UID,
      })
    );
  });

  it("owner เปลี่ยน status โพสต์ตัวเองเองไม่ได้ (ห้าม self-approve)", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(
      db.collection("posts").doc("postA").update({
        title: "เปลี่ยนชื่อ",
        status: "resolved",
      })
    );
  });

  it("owner แก้เนื้อหาโพสต์ (title/desc/location) โดยคง status/itemType → ผ่าน (edit post)", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertSucceeds(
      db.collection("posts").doc("postA").update({
        title: "กระติกน้ำสีเขียว",
        desc: "รายละเอียดใหม่",
        category: "ของใช้ส่วนตัว",
        locationName: "ชั้น 2",
        building: "ชั้น 2",
      })
    );
  });

  it("owner เปลี่ยนจุดคืน (depositLocation) โพสต์ตัวเอง → denied (แอดมินอนุมัติจุดแล้ว)", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(
      db.collection("posts").doc("postA").update({
        title: "กระติกน้ำสีเขียว",
        depositLocation: SCI_POINT,
      })
    );
  });

  it("owner เขียนผลแมท (matches/nearMatches/aiData) เองไม่ได้ — เฉพาะ server ผ่าน Cloud Functions", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(
      db.collection("posts").doc("postA").update({
        matches: [
          {
            matchedPostId: "postB",
            matchedTitle: "ของในมือผม",
            similarityScore: 90,
          },
        ],
        nearMatches: [],
      })
    );
    await assertFails(
      db.collection("posts").doc("postA").update({
        aiData: { summary: "เจ้าคุณปู่แก้ไขเอง" },
      })
    );
  });

  it("client เขียน meta/geminiBudget (โควตา AI) เองไม่ได้ — เฉพาะ server ผ่าน Cloud Functions", async () => {
    const db = authAs(OWNER_UID).firestore();
    await assertFails(db.doc("meta/geminiBudget").set({ day: "2999-01-01", used: 999 }));
    await assertFails(db.doc("meta/geminiBudget").update({ used: 999 }));
    await assertFails(db.doc("meta/geminiUsage/users/someUser").set({ day: "2999-01-01", used: 999 }));
  });

  it("staff อ่าน claim/post ของจุดอื่นไม่ได้ (กันรู้ข้อมูลข้ามจุด)", async () => {
    const db = authAs(STAFF_SCI_UID, { email: STAFF_SCI_EMAIL }).firestore();
    await assertFails(db.collection("claims").doc("claimA").get());
    // โพสต์เผยแพร่แล้วเป็นสาธารณะ → อ่านได้ทุกคน
    await assertSucceeds(db.collection("posts").doc("postA").get());
    // แต่โพสต์ pending ของจุดอื่นต้องถูกบล็อก
    await assertFails(db.collection("posts").doc("postPendingFound").get());
  });

  it("ผู้ยื่นขอลบ claim pending ของตัวเองได้, ลบของคนอื่นไม่ได้", async () => {
    const dbB = authAs(USER_B_UID).firestore();
    await assertSucceeds(dbB.collection("claims").doc("claimA").delete());
    const dbC = authAs(USER_C_UID).firestore();
    await assertFails(dbC.collection("claims").doc("claimA").delete());
  });

  it("banned user สร้าง notification/claim/report ไม่ได้", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().collection("users").doc(USER_C_UID).update({ banned: true });
    });
    await sleep(50);
    const db = authAs(USER_C_UID).firestore();
    await assertFails(db.collection("notifications").add({ type: "x", recipientUid: USER_C_UID, read: false }));
    await assertFails(db.collection("reports").add({ type: "post_report", reporterId: USER_C_UID, postId: "postA", status: "open" }));
  });

  it("owner ลบโพสต์ตัวเองได้ + แอดมินอ่านทุกอย่างได้", async () => {
    const dbOwner = authAs(OWNER_UID).firestore();
    await assertSucceeds(dbOwner.collection("posts").doc("postA").delete());
    const dbSuper = authAs(SUPER_UID).firestore();
    await assertSucceeds(dbSuper.collection("claims").doc("claimA").get());
    await assertSucceeds(dbSuper.collection("reports").doc("report1").get());
  });

  it("staff อ่าน claims ของโพสต์จุดตัวเองได้ (postId+status+depositLocation — query ครบแบบอนุมัติ)", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    const q = db
      .collection("claims")
      .where("postId", "==", "postA")
      .where("status", "==", "pending")
      .where("depositLocation", "==", LIB_POINT);
    await assertSucceeds(q.get());
  });

  it("staff อ่าน claims ของโพสต์จุดอื่นด้วย postId+status+depositLocation จุดอื่น → denied", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    const q = db
      .collection("claims")
      .where("postId", "==", "postA")
      .where("status", "==", "pending")
      .where("depositLocation", "==", SCI_POINT);
    await assertFails(q.get());
  });

  it("staff ปิดคำขออื่นของโพสต์จุดตัวเอง (อนุมัติ/ปฏิเสธ claim ที่จุดของตัวเอง) ผ่านได้", async () => {
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    // สร้างคำขอ pending ที่สองที่จุดเดียวกัน (จุดอ้างอิง postA)
    await env.withSecurityRulesDisabled(async (ctx) => {
      await seedClaim(ctx.firestore(), "claimB", USER_C_UID, "postA", LIB_POINT);
    });
    await sleep(50);
    await assertSucceeds(
      db.collection("claims").doc("claimB").update({
        status: "rejected",
        reviewedAt: new Date().toISOString(),
        reviewedByUid: STAFF_LIB_UID,
        rejectReason: "ของถูกส่งมอบให้เจ้าของแล้ว",
      })
    );
  });

  it("super ลบโพสต์ → ปิดคำขอ pending ได้ (status=post_deleted ผ่าน rules)", async () => {
    const db = authAs(SUPER_UID).firestore();
    await assertSucceeds(db.collection("posts").doc("postA").delete());
    await assertSucceeds(
      db.collection("claims").doc("claimA").update({
        status: "post_deleted",
        reviewedAt: new Date().toISOString(),
        rejectReason: "โพสต์ถูกลบ คำขอรับของจึงถูกยกเลิก",
      })
    );
  });

  it("staff ระงับ/ลบโพสต์ที่จุดตัวเองได้ (จัดการโพสต์ฝั่งตัวเอง)", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await seedFoundPost(ctx.firestore(), "postStaffManage", LIB_POINT, { status: "active" });
    });
    await sleep(50);
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertSucceeds(
      db.collection("posts").doc("postStaffManage").update({
        status: "suspended",
        suspendedAt: new Date().toISOString(),
      })
    );
    await sleep(50);
    await assertSucceeds(db.collection("posts").doc("postStaffManage").delete());
  });

  it("staff ระงับ/ลบโพสต์จุดอื่นไม่ได้ + ห้ามแตะเนื้อหาหรือเปลี่ยนจุดคืน", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await seedFoundPost(ctx.firestore(), "postSciManage", SCI_POINT, { status: "active" });
    });
    await sleep(50);
    const db = authAs(STAFF_LIB_UID, { email: STAFF_LIB_EMAIL }).firestore();
    await assertFails(
      db.collection("posts").doc("postSciManage").update({
        status: "suspended",
        suspendedAt: new Date().toISOString(),
      })
    );
    await assertFails(db.collection("posts").doc("postSciManage").delete());
  });

  it("user ทั่วไปอ่าน reports ของตัวเองกรอง reporterId+status ได้ (dedup แจ้งท้วง)", async () => {
    const dbB = authAs(USER_B_UID).firestore();
    const q = dbB
      .collection("reports")
      .where("reporterId", "==", USER_B_UID)
      .where("status", "==", "open");
    await assertSucceeds(q.get());
  });

  it("user ทั่วไปอ่าน reports ของคนอื่นกรอง postId+status ตรวจซ้ำ → denied (rules ไม่ใช่ filter)", async () => {
    const dbC = authAs(USER_C_UID).firestore();
    const q = dbC
      .collection("reports")
      .where("postId", "==", "postA")
      .where("status", "==", "open");
    await assertFails(q.get());
  });

  it("ผู้ยื่นคำขอเปลี่ยนชื่อตัวเองใน claim (claimantName field เดียว) ผ่านได้", async () => {
    const dbB = authAs(USER_B_UID).firestore();
    await assertSucceeds(
      dbB.collection("claims").doc("claimA").update({ claimantName: "ชื่อใหม่" })
    );
  });

  it("ผู้ยื่นคำขอแก้ field อื่นของ claim (status) → denied กันปลอมแปลง", async () => {
    const dbB = authAs(USER_B_UID).firestore();
    await assertFails(
      dbB.collection("claims").doc("claimA").update({
        claimantName: "ชื่อใหม่",
        status: "approved",
      })
    );
  });

  it("ผู้รายงานเปลี่ยนชื่อตัวเองใน report (reporterName field เดียว) ผ่านได้", async () => {
    const dbB = authAs(USER_B_UID).firestore();
    await assertSucceeds(
      dbB.collection("reports").doc("report1").update({ reporterName: "ชื่อใหม่" })
    );
  });

  it("ผู้รายงานแก้ field อื่นของ report (detail) → denied", async () => {
    const dbB = authAs(USER_B_UID).firestore();
    await assertFails(
      dbB.collection("reports").doc("report1").update({
        reporterName: "ชื่อใหม่",
        detail: "แก้หลักฐาน",
      })
    );
  });
});

// =====================================================================
// Guest browsing — ผู้ที่ยังไม่เข้าสู่ระบบอ่านโพสต์ที่เผยแพร่แล้วได้
// แต่ต้องถูกกันไม่ให้อ่าน pending/rejected (หน้าแรกแสดงเฉพาะที่เผยแพร่แล้ว)
// =====================================================================
describe("Guest browsing — posts read (ไม่ต้องล็อกอิน)", () => {
  it("guest อ่านโพสต์ active ได้", async () => {
    const dbGuest = env.unauthenticatedContext().firestore();
    await assertSucceeds(dbGuest.collection("posts").doc("postA").get());
  });

  it("guest อ่านโพสต์ lost active ได้", async () => {
    const dbGuest = env.unauthenticatedContext().firestore();
    await assertSucceeds(dbGuest.collection("posts").doc("postLost").get());
  });

  it("guest อ่านโพสต์ resolved ได้", async () => {
    const dbGuest = env.unauthenticatedContext().firestore();
    await assertSucceeds(dbGuest.collection("posts").doc("postResolved").get());
  });

  it("guest อ่านโพสต์ pending ไม่ได้", async () => {
    const dbGuest = env.unauthenticatedContext().firestore();
    await assertFails(dbGuest.collection("posts").doc("postPendingFound").get());
  });

  it("guest query posts เฉพาะที่เผยแพร่แล้ว (status in ...) ได้เหมือนหน้าแรก", async () => {
    const dbGuest = env.unauthenticatedContext().firestore();
    const q = dbGuest
      .collection("posts")
      .where("status", "in", ["active", "resolved", "under_investigation", "in_progress"]);
    await assertSucceeds(q.get());
  });

  it("guest query posts กรอง status=pending → denied", async () => {
    const dbGuest = env.unauthenticatedContext().firestore();
    const q = dbGuest.collection("posts").where("status", "==", "pending");
    await assertFails(q.get());
  });
});