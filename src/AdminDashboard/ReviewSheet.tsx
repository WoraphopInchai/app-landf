import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* กรอบ popup ตรวจสอบกลางของฝั่งแอดมิน
   - การ์ดกว้าง 720px / สูงสูงสุด 92dvh (เต็มจอบนมือถือ)
   - หัวเรื่องกับปุ่มลงมือตรึงบน/ล่าง ส่วนกลางเลื่อนอ่านได้
   - ตัวอักษรใหญ่กว่าเดิมเพื่อให้อ่านง่ายตอนตรวจของจริงที่จุดรับ
   - รองรับมือถือ: เว้นขอบตามจอ (safe-area), ปุ่มสูง 48px, ปุ่มซ้อนบรรทัดถัดไป */

interface ReviewSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: { label: string; bg: string; color: string };
  children: ReactNode;
  footer?: ReactNode;
  /** ปิดไม่ได้ชั่วคราว (กำลังเขียนข้อมูลอยู่) */
  busy?: boolean;
  zIndex?: number;
  /** ความกว้างสูงสุดของกรอบ (ปรับตามชนิดข้อมูล) */
  maxWidth?: number;
}

export default function ReviewSheet({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
  busy = false,
  zIndex = 100,
  maxWidth = 720,
}: ReviewSheetProps) {
  useEffect(() => {
    if (!open) return;

    // กันหน้าเว็บหลังเลื่อนได้ขณะเปิดกรอบตรวจสอบ
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // ปิดด้วยปุ่ม Esc (ยกเว้นตอนกำลังเขียนข้อมูล)
  useEffect(() => {
    if (!open || busy) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(5,4,10,0.78)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(14px, env(safe-area-inset-top, 0px)) 12px max(12px, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="modal-cap"
        style={{
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
          width: "100%",
          maxWidth,
          overflow: "hidden",
          animation: "lafFadeInUp 0.22s ease",
        }}
      >
        {/* หัวเรื่อง (ตรึงบน) */}
        <div style={{
          flexShrink: 0,
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{
              margin: 0,
              fontSize: "18px",
              fontWeight: 800,
              color: "var(--fg)",
              lineHeight: 1.3,
            }}>
              {title}
            </h3>
            {subtitle && (
              <div style={{
                fontSize: "12.5px",
                color: "var(--fg-muted)",
                fontWeight: 600,
                marginTop: "3px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {subtitle}
              </div>
            )}
          </div>
          {badge && (
            <span style={{
              flexShrink: 0,
              fontSize: "12px",
              fontWeight: 800,
              padding: "5px 10px",
              borderRadius: "8px",
              backgroundColor: badge.bg,
              color: badge.color,
              whiteSpace: "nowrap",
            }}>
              {badge.label}
            </span>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="ปิด"
            style={{
              flexShrink: 0,
              width: "40px",
              height: "40px",
              marginTop: "-2px",
              borderRadius: "12px",
              border: "1px solid var(--border)",
              background: "var(--bg-hover)",
              color: "var(--fg-secondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            <X size={19} />
          </button>
        </div>

        {/* เนื้อหา (เลื่อนได้) */}
        <div style={{
          flex: 1,
          overflowY: "auto",
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          padding: "16px 18px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}>
          {children}
        </div>

        {/* ปุ่มลงมือ (ตรึงล่าง) */}
        {footer && (
          <div style={{
            flexShrink: 0,
            padding: "12px 16px max(12px, env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--border)",
            backgroundColor: "var(--bg-card)",
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* รูปใหญ่ใน popup — กดแล้วเปิดดูขนาดเต็ม */
export function ReviewImage({
  src,
  images,
  alt = "",
  onZoom,
}: {
  src?: string | null;
  /** รูปทั้งหมดของโพสต์ (รูปแรกคือรูปปก) — ถ้ามีมากกว่า 1 รูปจะแสดงแถบรูปย่อให้เลื่อนดู */
  images?: string[] | null;
  alt?: string;
  onZoom: (src: string) => void;
}) {
  const list = images?.filter(Boolean) ?? [];
  const all = list.length > 0 ? list : src ? [src] : [];
  if (all.length === 0) return null;
  const [cover, ...rest] = all;
  return (
    <div>
      <div style={{ position: "relative" }}>
        <img
          src={cover}
          alt={alt}
          onClick={() => onZoom(cover)}
          style={{
            width: "100%",
            aspectRatio: "4 / 3",
            maxHeight: "46vh",
            objectFit: "cover",
            borderRadius: "14px",
            border: "1px solid var(--border)",
            cursor: "zoom-in",
            display: "block",
            backgroundColor: "var(--bg-subtle)",
          }}
        />
        <div style={{
          position: "absolute",
          right: "10px",
          bottom: "10px",
          fontSize: "11px",
          fontWeight: 700,
          color: "var(--fg-secondary)",
          backgroundColor: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "8px",
          padding: "4px 9px",
          pointerEvents: "none",
        }}>
          แตะรูปเพื่อดูขนาดเต็ม{all.length > 1 ? ` (1/${all.length})` : ""}
        </div>
      </div>

      {rest.length > 0 && (
        <div style={{
          marginTop: "8px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
          gap: "8px",
        }}>
          {rest.map((u, i) => (
            <img
              key={`${u.slice(-24)}-${i}`}
              src={u}
              alt={`${alt || "รูป"} ${i + 2}`}
              onClick={() => onZoom(u)}
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                objectFit: "cover",
                borderRadius: "10px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-subtle)",
                cursor: "zoom-in",
                display: "block",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* กล่องข้อมูล 1 ช่อง (ไอคอน + ป้าย + ค่า) */
export function InfoRow({
  icon: Icon,
  label,
  value,
  color,
  bg,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: "10px",
      padding: "12px 14px",
      borderRadius: "12px",
      backgroundColor: bg || "var(--bg-subtle)",
      border: "1px solid var(--border)",
    }}>
      <Icon size={18} color={color || "var(--fg-accent)"} style={{ flexShrink: 0, marginTop: "2px" }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg-muted)" }}>{label}</div>
        <div style={{
          fontSize: "14.5px",
          fontWeight: 700,
          color: color || "var(--fg-strong)",
          lineHeight: 1.5,
          wordBreak: "break-word",
          whiteSpace: "pre-wrap",
        }}>
          {value}
        </div>
      </div>
    </div>
  );
}

/* ตารางข้อมูล 2 คอลัมน์ (จอกว้าง) → 1 คอลัมน์ (มือถือ) */
export function InfoGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
      gap: "10px",
    }}>
      {children}
    </div>
  );
}

/* ปุ่มในส่วนลงมือของ popup */
export function SheetButton({
  children,
  onClick,
  tone = "neutral",
  disabled = false,
  full = false,
  icon: Icon,
}: {
  children: ReactNode;
  onClick: () => void;
  tone?: "neutral" | "primary" | "ok" | "warn" | "danger";
  disabled?: boolean;
  /** กว้างเต็มแถว (ใช้กับปุ่มลบที่ต้องแยกเป็นแถวของตัวเอง) */
  full?: boolean;
  icon?: LucideIcon;
}) {
  const tones: Record<string, { border: string; background: string; color: string }> = {
    neutral: { border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--fg-strong)" },
    primary: { border: "none", background: "linear-gradient(135deg, #7c5cfc, #6a4eff)", color: "#fff" },
    ok: { border: "none", background: "#10b981", color: "#fff" },
    warn: { border: "1px solid var(--sc-warn-border)", background: "var(--sc-warn-bg)", color: "var(--sc-warn-fg)" },
    danger: { border: "none", background: "#dc2626", color: "#fff" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: full ? "1 1 100%" : "1 1 130px",
        minHeight: "48px",
        padding: "0 16px",
        borderRadius: "12px",
        border: t.border,
        background: t.background,
        color: t.color,
        fontSize: "14.5px",
        fontWeight: 700,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
      }}
    >
      {Icon && <Icon size={16} />}
      {children}
    </button>
  );
}

/* เปิดดูรูปขนาดเต็ม — ถ้าส่ง images มาด้วยจะเลื่อนดูทีละรูปได้ (เริ่มที่รูปที่ผู้ใช้แตะ) */
export function ImageLightbox({
  src,
  images,
  onClose,
  zIndex = 400,
}: {
  src: string | null;
  /** รูปทั้งหมดของโพสต์ — ถ้าไม่ส่งจะแสดงรูปเดียวตาม src */
  images?: string[] | null;
  onClose: () => void;
  /** ต้องมากกว่า zIndex ของกรอบที่เปิดอยู่ ไม่งั้นรูปจะถูกบัง */
  zIndex?: number;
}) {
  const all = images?.filter(Boolean) ?? [];
  // ต้องมี src (รูปที่ผู้ใช้แตะ) ถึงจะเปิด lightbox ได้
  // ถ้าไม่มี src แต่ส่ง images มาด้วย รูปจะเด้งทับหน้าจอทันทีโดยที่ยังไม่ได้แตะรูป
  // และ onClose จะ set เป็น null ซึ่งเป็น null อยู่แล้ว → ปิดไม่ได้ ต้องรีเว็บ
  const list = src ? (all.length > 0 ? all : [src]) : [];
  const [index, setIndex] = useState(() => {
    if (!src) return 0;
    const i = all.indexOf(src);
    return i >= 0 ? i : 0;
  });

  const go = (dir: 1 | -1) => {
    setIndex((prev) => (prev + dir + list.length) % list.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && list.length > 1) go(1);
      if (e.key === "ArrowLeft" && list.length > 1) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (list.length === 0) return null;
  const current = list[Math.min(index, list.length - 1)];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(5,4,10,0.88)",
        backdropFilter: "blur(6px)",
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(12px, env(safe-area-inset-top, 0px)) 12px max(12px, env(safe-area-inset-bottom, 0px))",
        cursor: "zoom-out",
      }}
    >
      <img
        key={current}
        src={current}
        alt=""
        onClick={(e) => e.stopPropagation()}
        className="lightbox-cap"
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          borderRadius: "16px",
          border: "1px solid var(--border)",
          boxShadow: "0 25px 60px rgba(0,0,0,0.7)",
          animation: "lafFadeInUp 0.2s ease",
        }}
      />

      {list.length > 1 && (
        <>
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                go(dir);
              }}
              aria-label={dir === -1 ? "รูปก่อนหน้า" : "รูปถัดไป"}
              style={{
                position: "absolute",
                top: "50%",
                [dir === -1 ? "left" : "right"]: "12px",
                transform: "translateY(-50%)",
                width: "42px",
                height: "42px",
                borderRadius: "50%",
                border: "1px solid var(--border)",
                background: "var(--bg-card)",
                color: "var(--fg-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              {dir === -1 ? <ChevronLeft size={22} /> : <ChevronRight size={22} />}
            </button>
          ))}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              bottom: "max(12px, env(safe-area-inset-bottom, 0px))",
              padding: "5px 12px",
              borderRadius: "999px",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              color: "var(--fg-secondary)",
              fontSize: "12px",
              fontWeight: 700,
            }}
          >
            {Math.min(index, list.length - 1) + 1}/{list.length}
          </div>
        </>
      )}
    </div>
  );
}
