import { useState, useEffect } from "react";
import {
  ArrowLeft,
  ShieldCheck,
  User,
  Phone,
  LogOut,
  Edit2,
  MessageSquareWarning,
  Check,
  X,
  Send,
  ChevronRight,
  Reply,
} from "lucide-react";
import { doc, getDoc, updateDoc, collection, addDoc, serverTimestamp, query, where, getDocs, orderBy, limit, onSnapshot, writeBatch } from "firebase/firestore";
import { auth, db } from "../firebase";
import type { AppUser } from "../types";
import ToastContainer from "../components/Toast";
import { showToast } from "../lib/toast";
import { isCurrentUserBanned } from "../lib/userGuard";

interface AdminReply {
  id: string;
  text?: string;
  postId?: string;
  postTitle?: string;
  category?: string;
  createdAt?: { toMillis?: () => number } | string | number;
  read?: boolean;
}

interface ProfileProps {
  user?: AppUser;
  onBack: () => void;
  onLogout: () => void;
  onNameUpdated?: (name: string) => void;
}

// อัปเดตชื่อที่ snapshot ไว้ตอนสร้าง (posts.reporterName, claims.claimantName, reports.reporterName)
// ให้ตามชื่อปัจจุบันของโปรไฟล์ — ใช้ writeBatch กลุ่มละ ≤500
const renameHistoricalDocs = async (uid: string, newName: string) => {
  const colNames = [
    { col: "posts", infoField: "userId", nameField: "reporterName" },
    { col: "claims", infoField: "claimantId", nameField: "claimantName" },
    { col: "reports", infoField: "reporterId", nameField: "reporterName" },
  ] as const;

  let batch = writeBatch(db);
  let ops = 0;
  const flush = async () => {
    if (ops > 0) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (const cfg of colNames) {
    const snap = await getDocs(query(collection(db, cfg.col), where(cfg.infoField, "==", uid)));
    for (const d of snap.docs) {
      if ((d.data()?.[cfg.nameField] || "") === newName) continue;
      batch.update(doc(db, cfg.col, d.id), { [cfg.nameField]: newName });
      ops++;
      if (ops >= 500) await flush();
    }
  }
  await flush();
};

export default function Profile({ user, onBack, onLogout, onNameUpdated }: ProfileProps) {
  const [displayName, setDisplayName] = useState(user?.name || user?.displayName || "ผู้ใช้งาน");
  const [isEditingName, setIsEditingName] = useState(false);
  const [phone, setPhone] = useState(user?.phoneNumber || "");
  const [isEditingPhone, setIsEditingPhone] = useState(false);

  // โหลดข้อมูลโปรไฟล์ล่าสุดจาก Firestore (ชื่อ, เบอร์โทร)
  // พร้อม sync ชื่อย้อนหลังในโพสต์/คำขอ/รายงานให้ตรงชื่อปัจจุบันอัตโนมัติ
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    getDoc(doc(db, "users", uid))
      .then((d) => {
        if (d.exists()) {
          const data = d.data();
          if (data.name) {
            setDisplayName(data.name);
            renameHistoricalDocs(uid, data.name).catch((error) =>
              console.error("sync ชื่อย้อนหลังไม่สำเร็จ:", error)
            );
          }
          if (data.phoneNumber) setPhone(data.phoneNumber);
        }
      })
      .catch(() => {});
  }, []);

  // ฟังก์ชันบันทึกชื่อที่แสดง (เซฟลง Firestore + อัปเดตชื่อให้หน้า ReportItem ใช้ต่อ)
  const handleSaveName = async () => {
    const uid = auth.currentUser?.uid;
    const newName = displayName.trim() || "ผู้ใช้งาน";
    setIsEditingName(false);
    try {
      if (uid) {
        await updateDoc(doc(db, "users", uid), { name: newName });
        // อัปเดตชื่อย้อนหลังใน documents ที่แอดมินมองเห็น (โพสต์ / คำขอรับของ / รายงาน)
        try {
          await renameHistoricalDocs(uid, newName);
        } catch (error) {
          console.error("อัปเดตชื่อย้อนหลังไม่สำเร็จ:", error);
          showToast("เปลี่ยนชื่อแล้ว แต่บางรายการอาจยังแสดงชื่อเดิม", "info");
        }
      }
      onNameUpdated?.(newName);
      showToast("บันทึกชื่อเรียบร้อยแล้ว");
    } catch (error) {
      console.error("บันทึกชื่อไม่สำเร็จ:", error);
      showToast("เกิดข้อผิดพลาดในการบันทึกชื่อ กรุณาลองใหม่", "error");
    }
  };

  // ฟังก์ชันบันทึกเบอร์โทรศัพท์ติดต่อ (เซฟลง Firestore ที่ users/{uid})
  const handleSavePhone = async () => {
    const newPhone = phone.trim();
    setIsEditingPhone(false);
    try {
      if (auth.currentUser) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          phoneNumber: newPhone,
        });
      }
      showToast(newPhone ? "บันทึกเบอร์โทรศัพท์เรียบร้อยแล้ว" : "ลบเบอร์โทรศัพท์แล้ว");
    } catch (error) {
      console.error("บันทึกเบอร์ไม่สำเร็จ:", error);
      showToast("เกิดข้อผิดพลาดในการบันทึกเบอร์ กรุณาลองใหม่", "error");
    }
  };

  // States สำหรับระบบรายงานปัญหา
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("ของหาย/ประกาศไม่แสดง");
  const [reportDetail, setReportDetail] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  // คำตอบจากแอดมิน (admin_reply) — โชว์เฉพาะให้เจ้าของบัญชีที่ถูกตอบ
  const [adminReplies, setAdminReplies] = useState<AdminReply[]>([]);
  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = query(
      collection(db, "notifications"),
      where("type", "==", "admin_reply"),
      where("recipientUid", "==", uid),
      orderBy("createdAt", "desc"),
      limit(20)
    );
    const un = onSnapshot(
      q,
      (snap) => {
        setAdminReplies(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AdminReply)
        );
        // mark read ที่ยังไม่ได้อ่านของผู้ใช้เอง
        const unread = snap.docs.filter((d) => d.data().read !== true);
        if (!unread.length) return;
        const batch = writeBatch(db);
        unread.forEach((d) => batch.update(d.ref, { read: true }));
        batch.commit().catch(() => {});
      },
      (error) => {
        console.error("Error fetching admin replies:", error);
        setAdminReplies([]);
      }
    );
    return () => un();
  }, []);

  // รายการหัวข้อรายงานปัญหา
  const reportCategories = [
    "ของหาย / ประกาศไม่แสดง",
    "พบของแต่ติดต่อเจ้าของไม่ได้",
    "ปัญหาการเข้าสู่ระบบ / บัญชีผู้ใช้",
    "พบเนื้อหาไม่เหมาะสม / สแปม",
    "อื่นๆ (แจ้งแอดมิน)",
  ];

  // ฟังก์ชันส่งรายงานปัญหา
  const handleSubmitReport = async () => {
    if (await isCurrentUserBanned()) {
      showToast("บัญชีของคุณถูกระงับการใช้งาน ไม่สามารถส่งเรื่องแจ้งแอดมินได้", "error");
      return;
    }
    if (!reportDetail.trim()) {
      showToast("กรุณากรอกรายละเอียดเพิ่มเติมก่อนส่งรายงานครับ", "info");
      return;
    }

    setIsSubmittingReport(true);
    try {
      const reporterId = auth.currentUser?.uid || "";
      await addDoc(collection(db, "reports"), {
        type: "support_message",
        userId: reporterId,
        reporterId,
        reporterName: auth.currentUser?.displayName || "ผู้ใช้ทั่วไป",
        category: selectedCategory,
        detail: reportDetail.trim(),
        status: "open",
        createdAt: serverTimestamp(),
      });
      addDoc(collection(db, "notifications"), {
        type: "support_message",
        recipientRole: "admin",
        reporterId,
        reporterName: auth.currentUser?.displayName || "ผู้ใช้ทั่วไป",
        category: selectedCategory,
        detail: reportDetail.trim(),
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});

      showToast("ส่งเรื่องรายงานปัญหาให้แอดมินเรียบร้อยแล้ว ขอบคุณครับ!");
      setReportDetail("");
      setIsReportModalOpen(false);
    } catch (error) {
      console.error(error);
      showToast("เกิดข้อผิดพลาดในการส่งรายงาน กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  return (
    <div
      className="laf-page-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        backgroundColor: "var(--bg)",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "var(--fg)",
        paddingBottom: "40px",
        position: "relative",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      <style>{`
        div::-webkit-scrollbar { display: none; }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Header */}
      <div
        className="laf-page-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          position: "relative",
          zIndex: 10,
        }}
      >
        <button onClick={onBack} style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "10px", cursor: "pointer", padding: "8px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <ArrowLeft size={20} color="var(--fg-strong)" />
        </button>
        <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)", letterSpacing: "-0.01em" }}>
          UP Lost & Found <span style={{ color: "var(--fg-muted)" }}>• โปรไฟล์</span>
        </div>
        <div style={{ width: "36px" }} />
      </div>

      {/* Profile Info Header */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "28px 20px 24px",
          backgroundColor: "var(--bg-card)",
          borderRadius: "20px",
          border: "1px solid var(--border)",
          boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
          margin: "16px 16px 0",
          position: "relative",
        }}
      >
        <div style={{ marginBottom: "14px" }}>
          <div
            style={{
              width: "96px",
              height: "96px",
              borderRadius: "50%",
              border: "4px solid var(--border-strong)",
              background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 8px 24px -4px rgba(124, 92, 252, 0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-fg)",
                fontSize: "28px",
                fontWeight: "bold",
              }}
            >
              {displayName.charAt(0)}
            </div>
          </div>
        </div>
        
        <div style={{ fontSize: "17px", fontWeight: 800, color: "var(--fg)" }}>{displayName}</div>
        <div style={{ fontSize: "13px", color: "var(--fg-muted)", marginTop: "2px" }}>{user?.email}</div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: "rgba(124, 92, 252, 0.14)",
            border: "1px solid rgba(124, 92, 252, 0.35)",
            color: "var(--fg-accent)",
            padding: "4px 12px",
            borderRadius: "20px",
            fontSize: "11px",
            fontWeight: 700,
            marginTop: "10px",
          }}
        >
          <ShieldCheck size={13} /> <span>ยืนยันตัวตนด้วยอีเมลมหาวิทยาลัย</span>
        </div>
      </div>

      {/* Settings / Form List */}
      <div
        style={{
          padding: "20px 16px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          margin: "4px auto 0",
          width: "100%",
          maxWidth: 720,
        }}
      >
        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.05em", paddingLeft: "4px" }}>
          ข้อมูลส่วนตัว
        </div>

        {/* ชื่อที่แสดง */}
        <div style={{ backgroundColor: "var(--bg-card)", borderRadius: "16px", padding: "16px", border: "1px solid var(--border)", boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>
              <User size={15} color="var(--fg-accent)" /> <span>ชื่อที่แสดง</span>
            </div>
            <button
              onClick={() => (isEditingName ? handleSaveName() : setIsEditingName(true))}
              style={{
                background: "none",
                border: "none",
                color: "var(--fg-accent)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              {isEditingName ? <><Check size={12} /> บันทึก</> : <><Edit2 size={12} /> แก้ไข</>}
            </button>
          </div>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={!isEditingName}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: "8px",
              border: isEditingName ? "1px solid #7c5cfc" : "1px solid var(--border)",
              fontSize: "13px",
              color: "var(--fg)",
              backgroundColor: "var(--bg-subtle)",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* เบอร์โทรศัพท์ */}
        <div style={{ backgroundColor: "var(--bg-card)", borderRadius: "16px", padding: "16px", border: "1px solid var(--border)", boxShadow: "0 2px 6px rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 700, color: "var(--fg)" }}>
              <Phone size={15} color="var(--fg-accent)" /> <span>เบอร์โทรศัพท์ติดต่อ</span>
            </div>
            <button
              onClick={() => (isEditingPhone ? handleSavePhone() : setIsEditingPhone(true))}
              style={{
                background: "none",
                border: "none",
                color: "var(--fg-accent)",
                fontSize: "12px",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              {isEditingPhone ? <><Check size={12} /> บันทึก</> : <><Edit2 size={12} /> แก้ไข</>}
            </button>
          </div>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={!isEditingPhone}
            placeholder="ยังไม่ได้ระบุเบอร์โทรศัพท์"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "8px",
              border: isEditingPhone ? "1px solid #7c5cfc" : "1px solid var(--border)",
              fontSize: "13px",
              color: "var(--fg)",
              outline: "none",
              backgroundColor: "var(--bg-subtle)",
              boxSizing: "border-box",
            }}
          />
        </div>

        <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.05em", paddingLeft: "4px", marginTop: "8px" }}>
          ช่วยเหลือและความปลอดภัย
        </div>

        {/* คำตอบจากแอดมิน (อ่านได้จากหน้านี้เมื่อกดแจ้งเตือนตอบกลับ) */}
        {adminReplies.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-muted)", textTransform: "uppercase", letterSpacing: "0.05em", paddingLeft: "4px" }}>
              คำตอบจากแอดมิน
            </div>
            {adminReplies.map((r) => (
              <div
                key={r.id}
                style={{
                  backgroundColor: "var(--bg-card)",
                  borderRadius: "16px",
                  padding: "14px 16px",
                  border: "1px solid rgba(124,92,252,0.35)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 700, color: "var(--fg-accent)" }}>
                  <Reply size={14} />
                  <span>{r.category || "เรื่องที่แจ้งไว้"}</span>
                </div>
                <div style={{ fontSize: "13px", color: "var(--fg)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {r.text || ""}
                </div>
                {r.postTitle && (
                  <div style={{ fontSize: "12px", color: "var(--fg-muted)" }}>
                    เกี่ยวกับโพสต์: {r.postTitle}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ปุ่มรายงานปัญหา (เปิด Modal) */}
        <button
          onClick={() => setIsReportModalOpen(true)}
          style={{
            width: "100%",
            backgroundColor: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "16px",
            padding: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            color: "var(--fg)",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "12px", backgroundColor: "var(--bg-hover)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <MessageSquareWarning size={18} color="var(--fg-accent)" />
            </div>
            <span>รายงานปัญหา / ติดต่อแอดมิน</span>
          </div>
          <ChevronRight size={18} color="var(--fg-muted)" />
        </button>

        {/* ปุ่มออกจากระบบ */}
        <button
          onClick={onLogout}
          style={{
            width: "100%",
            backgroundColor: "#2a1418",
            border: "1px solid #4a1f28",
            borderRadius: "16px",
            padding: "16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
            color: "#f87171",
            fontSize: "14px",
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div style={{ width: "38px", height: "38px", borderRadius: "12px", backgroundColor: "#4a1f28", border: "1px solid #5c2534", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <LogOut size={18} color="#f87171" />
            </div>
            <span>ออกจากระบบ</span>
          </div>
          <ChevronRight size={18} color="#f87171" />
        </button>

      </div>

      {/* Modal รายงานปัญหา */}
      {isReportModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(5, 4, 10, 0.72)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: "20px",
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-card)",
              borderRadius: "20px",
              width: "100%",
              maxWidth: "400px",
              padding: "24px",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              border: "1px solid var(--border)",
              position: "relative",
            }}
          >
            {/* ปุ่มปิด Modal */}
            <button
              onClick={() => setIsReportModalOpen(false)}
              style={{
                position: "absolute",
                top: "16px",
                right: "16px",
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--fg-muted)",
              }}
            >
              <X size={20} />
            </button>

            <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--fg)", marginBottom: "4px" }}>
              รายงานปัญหา / แจ้งแอดมิน
            </div>
            <div style={{ fontSize: "12px", color: "var(--fg-muted)", marginBottom: "16px" }}>
              เลือกหัวข้อและระบุรายละเอียดเพื่อให้แอดมินช่วยเหลือได้รวดเร็วขึ้นครับ
            </div>

            {/* เลือกหัวข้อ */}
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)", marginBottom: "8px" }}>
              หัวข้อปัญหา
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
              {reportCategories.map((cat) => (
                <label
                  key={cat}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: "13px",
                    cursor: "pointer",
                    padding: "8px 12px",
                    borderRadius: "8px",
                    backgroundColor: selectedCategory === cat ? "var(--bg-hover)" : "var(--bg-subtle)",
                    border: selectedCategory === cat ? "1px solid #7c5cfc" : "1px solid var(--border)",
                  }}
                >
                  <input
                    type="radio"
                    name="reportCategory"
                    checked={selectedCategory === cat}
                    onChange={() => setSelectedCategory(cat)}
                    style={{ accentColor: "#7c5cfc" }}
                  />
                  <span style={{ color: selectedCategory === cat ? "var(--fg-accent)" : "var(--fg-secondary)", fontWeight: selectedCategory === cat ? 700 : 400 }}>
                    {cat}
                  </span>
                </label>
              ))}
            </div>

            {/* รายละเอียดเพิ่มเติม */}
            <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--fg)", marginBottom: "8px" }}>
              รายละเอียดเพิ่มเติม
            </div>
            <textarea
              rows={3}
              value={reportDetail}
              onChange={(e) => setReportDetail(e.target.value)}
              placeholder="พิมพ์อธิบายปัญหาหรือแนบลิงก์ที่เกี่ยวข้อง..."
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid var(--border)",
                fontSize: "13px",
                color: "var(--fg)",
                backgroundColor: "var(--bg-subtle)",
                outline: "none",
                resize: "none",
                marginBottom: "20px",
                fontFamily: 'inherit',
                boxSizing: "border-box",
              }}
            />

            {/* ปุ่มส่งรายงาน */}
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setIsReportModalOpen(false)}
                style={{
                  flex: 1,
                  backgroundColor: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--fg-secondary)",
                  cursor: "pointer",
                }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleSubmitReport}
                disabled={isSubmittingReport}
                style={{
                  flex: 1,
                  backgroundColor: "#7c5cfc",
                  border: "none",
                  borderRadius: "10px",
                  padding: "12px",
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--fg)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  boxShadow: "0 6px 18px rgba(124,92,252,0.4)",
                }}
              >
                <Send size={14} /> {isSubmittingReport ? "กำลังส่ง..." : "ส่งเรื่อง"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}