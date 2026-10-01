import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ImagePlus, PackageSearch, RotateCcw, ShieldCheck, User, X } from "lucide-react";
import { validateImageFile } from "../lib/postImages";
import ReviewSheet, { SheetButton } from "./ReviewSheet";

/* กรอบถ่ายรูปหลักฐานการส่งมอบ — บังคับก่อนบันทึกการอนุมัติคำขอ
   - แสดงผู้ขอ + ของที่จะส่งมอบ ให้แอดมินยืนยันว่าถูกคนและถูกชิ้นก่อนถ่าย
   - ปุ่มถ่ายเปิดกล้องมือถือตรง (capture="user") / คอมพิวเตอร์เปิดเลือกไฟล์
   - ยืนยันได้ก็ต่อเมื่อมีรูปแล้วเท่านั้น (fail-closed ฝั่ง UI)
   - กฎ Firestore บังคับซ้ำอีกชั้นที่ฝั่งเซิร์ฟเวอร์ (ดู hasHandoverEvidence) */

export interface HandoverTarget {
  /** ชื่อผู้ขอรับของ */
  claimantName?: string;
  /** ชื่อของที่กำลังจะส่งมอบ */
  postTitle?: string;
  /** รูปในโพสต์ที่ถูกขอรับ */
  postImageUrl?: string;
}

interface HandoverCaptureSheetProps {
  target: HandoverTarget;
  /** true = กำลังอัปโหลดรูป / กำลังบันทึกอนุมัติ */
  busy?: boolean;
  /** ข้อความผิดพลาดจากรอบก่อนหน้า (เช่น อนุมัติไม่สำเร็จ) */
  error?: string | null;
  onCancel: () => void;
  /** ส่งไฟล์รูปที่ถ่ายแล้วกลับไปให้ผู้เรียกจัดการอัปโหลด */
  onConfirm: (file: File) => void;
}

/* เปิด/ปิดโดยการ mount/unmount (พ่นมาเป็นเงื่อนไขใน Admin.tsx) → state ถ่ายรูป
   เริ่มใหม่ทุกครั้งที่เปิด ไม่ต้องล้างด้วย effect */
export default function HandoverCaptureSheet({
  target,
  busy = false,
  error = null,
  onCancel,
  onConfirm,
}: HandoverCaptureSheetProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>("");
  const [pickError, setPickError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // คืนหน่วยความจำของ object URL เมื่อเปลี่ยนรูปหรือปิดกรอบ
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // ปิดด้วย Esc เว้นแต่กำลังบันทึก
  useEffect(() => {
    if (busy) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    const invalid = validateImageFile(picked);
    if (invalid) {
      setPickError(invalid);
      return;
    }
    setPickError(null);
    setFile(picked);
    setPreview(URL.createObjectURL(picked));
  };

  const retake = () => {
    setFile(null);
    setPreview("");
    setPickError(null);
    inputRef.current?.click();
  };

  return (
    <>
      <ReviewSheet
        open
        onClose={busy ? () => {} : onCancel}
        title="ถ่ายรูปหลักฐานการส่งมอบ"
        subtitle="บังคับก่อนบันทึกการอนุมัติ"
        busy={busy}
        maxWidth={560}
        footer={
          <>
            <SheetButton tone="neutral" disabled={busy} onClick={onCancel} icon={X}>
              ยกเลิก
            </SheetButton>
            <SheetButton
              tone="ok"
              disabled={busy || !file}
              onClick={() => file && onConfirm(file)}
              icon={CheckCircle2}
            >
              {busy ? "กำลังบันทึก..." : "ยืนยันส่งมอบ"}
            </SheetButton>
          </>
        }
      >
        {/* สิ่งที่กำลังจะส่งมอบให้แอดมินเช็กก่อนว่าถูกคน/ถูกชิ้น */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            padding: "12px 14px",
            borderRadius: "14px",
            backgroundColor: "var(--bg-subtle)",
            border: "1px solid var(--border)",
          }}
        >
          {target?.postImageUrl ? (
            <img
              src={target.postImageUrl}
              alt="ของที่จะส่งมอบ"
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "12px",
                objectFit: "cover",
                flexShrink: 0,
                border: "1px solid var(--border)",
              }}
            />
          ) : (
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "12px",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--bg-hover)",
                border: "1px solid var(--border)",
              }}
            >
              <PackageSearch size={24} color="var(--fg-accent)" />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)", lineHeight: 1.4 }}>
              {target?.postTitle || "-"}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "var(--sc-info-fg)",
                lineHeight: 1.5,
                marginTop: "3px",
                display: "flex",
                alignItems: "center",
                gap: "5px",
              }}
            >
              <User size={14} style={{ flexShrink: 0 }} />
              ผู้มารับ: <strong>{target?.claimantName || "ไม่ระบุ"}</strong>
            </div>
          </div>
        </div>

        {/* คำสั่งให้ถ่ายให้เห็นทั้งคนและของ */}
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "12px",
            backgroundColor: "var(--sc-info-bg)",
            border: "1px solid var(--sc-info-border)",
            color: "var(--sc-info-fg)",
            fontSize: "13px",
            lineHeight: 1.6,
            display: "flex",
            alignItems: "flex-start",
            gap: "8px",
          }}
        >
          <ShieldCheck size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
          <span>
            ถ่ายให้เห็น <strong>ผู้มารับของและของชิ้นนั้น</strong> อยู่ในเฟรมเดียวกัน
            เพื่อยืนยันว่าส่งมอบให้ถูกคน — ระบบจะไม่ให้อนุมัติคำขอถ้ายังไม่มีรูปนี้
          </span>
        </div>

        {/* พื้นที่รูป */}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="user"
          onChange={handlePick}
          style={{ display: "none" }}
          id="handover-evidence-capture"
        />

        {preview ? (
          <div>
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "var(--sc-ok-fg)",
                marginBottom: "6px",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <CheckCircle2 size={14} /> หลักฐานพร้อมแล้ว
            </div>
            <img
              src={preview}
              alt="หลักฐานการส่งมอบ"
              style={{
                width: "100%",
                maxHeight: "40vh",
                objectFit: "contain",
                borderRadius: "14px",
                border: "1px solid var(--sc-ok-border)",
                backgroundColor: "var(--bg-subtle)",
                display: "block",
              }}
            />
            <button
              type="button"
              onClick={retake}
              disabled={busy}
              style={{
                marginTop: "8px",
                width: "100%",
                minHeight: "44px",
                borderRadius: "12px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-subtle)",
                color: "var(--fg-strong)",
                fontSize: "13.5px",
                fontWeight: 700,
                cursor: busy ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "7px",
                opacity: busy ? 0.6 : 1,
              }}
            >
              <RotateCcw size={15} /> ถ่ายใหม่
            </button>
          </div>
        ) : (
          <label
            htmlFor="handover-evidence-capture"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              minHeight: "190px",
              padding: "24px 18px",
              borderRadius: "16px",
              border: "2px dashed var(--border-strong)",
              backgroundColor: "var(--bg-subtle)",
              cursor: busy ? "not-allowed" : "pointer",
              textAlign: "center",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <div
              style={{
                width: "60px",
                height: "60px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--accent-soft)",
                border: "1px solid var(--accent-soft-border)",
              }}
            >
              <Camera size={26} color="var(--fg-accent)" />
            </div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)" }}>
              แตะเพื่อเปิดกล้องถ่ายรูป
            </div>
            <div style={{ fontSize: "12px", color: "var(--fg-muted)", lineHeight: 1.6 }}>
              ถ่ายหน้าผู้มารับของคู่กับของ
              <br />
              รองรับ JPG / PNG สูงสุด 5MB
            </div>
            {!busy && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "5px",
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "var(--fg-accent)",
                }}
              >
                <ImagePlus size={14} /> เลือกจากคลังรูป
              </span>
            )}
          </label>
        )}

        {(pickError || error) && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "12px",
              backgroundColor: "var(--sc-danger-bg)",
              border: "1px solid var(--sc-danger-border)",
              color: "var(--sc-danger-fg)",
              fontSize: "13px",
              lineHeight: 1.6,
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: "2px" }} />
            <span>{pickError || error}</span>
          </div>
        )}
      </ReviewSheet>
    </>
  );
}
