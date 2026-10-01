import { useEffect } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/* กรอบกล่องข้อความ/ยืนยันกลางของฝั่งผู้ใช้
   - สูงไม่เกินจอจริง (92dvh) เลื่อนเนื้อหากลางได้ ปุ่มลงมือตรึงล่างเสมอ
   - รองรับมือถือ: เว้นขอบตามจอ (safe-area), ปุ่มสูง 48px, ปุ่มซ้อนบรรทัดถัดไป
   - ปิดได้ด้วย Esc / คลิกพื้นหลัง และล็อกการเลื่อนหน้าหลังขณะเปิด */

interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  iconTone?: "danger" | "primary" | "ok";
  children?: ReactNode;
  footer?: ReactNode;
  /** ความกว้างสูงสุดของกล่อง (ปรับตามชนิดกล่อง) */
  maxWidth?: number;
  zIndex?: number;
  /** ปิดด้วย Esc / คลิกพื้นหลังได้ไหม */
  dismissible?: boolean;
  /** จัดข้อความกึ่งกลาง (กล่องยืนยัน) หรือชิดซ้าย (กล่องฟอร์ม) */
  align?: "center" | "start";
}

export default function Dialog({
  open,
  onClose,
  title,
  subtitle,
  icon: Icon,
  iconTone = "danger",
  children,
  footer,
  maxWidth = 420,
  zIndex = 100,
  dismissible = true,
  align = "center",
}: DialogProps) {
  const canClose = Boolean(onClose) && dismissible;

  // กันหน้าเว็บหลังเลื่อนได้ขณะเปิดกล่อง (ผูกกับ open อย่างเดียว ไม่ขึ้นกับ dismissible)
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // ปิดด้วยปุ่ม Esc
  useEffect(() => {
    if (!open || !canClose) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, canClose, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={() => canClose && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(5,4,10,0.74)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "max(14px, env(safe-area-inset-top, 0px)) 12px max(12px, env(safe-area-inset-bottom, 0px))",
        animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="modal-cap"
        style={{
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: "20px",
          boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
          width: "100%",
          maxWidth,
          overflow: "hidden",
          animation: "slideUp 0.25s ease",
        }}
      >
        {/* หัวเรื่อง (ตรึงบน) */}
        <div style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          padding: "16px 16px 14px",
          borderBottom: children ? "1px solid var(--border)" : "none",
        }}>
          {Icon && (
            <div style={{
              flexShrink: 0,
              width: 44,
              height: 44,
              borderRadius: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: iconTone === "danger"
                ? "var(--sc-danger-bg)"
                : iconTone === "ok"
                  ? "var(--sc-ok-bg)"
                  : "var(--accent-soft)",
              border: `1px solid ${iconTone === "danger"
                ? "var(--sc-danger-border)"
                : iconTone === "ok"
                  ? "var(--sc-ok-border)"
                  : "var(--accent-soft-border)"}`,
            }}>
              <Icon
                size={22}
                color={iconTone === "danger"
                  ? "var(--sc-danger-fg)"
                  : iconTone === "ok"
                    ? "var(--sc-ok-fg)"
                    : "var(--fg-accent)"}
              />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: "18px",
              fontWeight: 800,
              color: "var(--fg)",
              lineHeight: 1.35,
            }}>
              {title}
            </div>
            {subtitle && (
              <div style={{
                fontSize: "13px",
                color: "var(--fg-muted)",
                lineHeight: 1.55,
                marginTop: "4px",
              }}>
                {subtitle}
              </div>
            )}
          </div>
          {onClose && (
            <button
              onClick={onClose}
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
                cursor: "pointer",
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* เนื้อหา (เลื่อนได้) */}
        {children && (
          <div style={{
            flex: 1,
            overflowY: "auto",
            overscrollBehavior: "contain",
            WebkitOverflowScrolling: "touch",
            padding: "16px",
            textAlign: align === "center" ? "center" : "left",
          }}>
            {children}
          </div>
        )}

        {/* ปุ่มลงมือ (ตรึงล่าง) */}
        {footer && (
          <div style={{
            flexShrink: 0,
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            padding: "12px 16px max(12px, env(safe-area-inset-bottom, 0px))",
            borderTop: "1px solid var(--border)",
            backgroundColor: "var(--bg-card)",
            textAlign: align === "center" ? "center" : "left",
          }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ปุ่มในส่วนลงมือของกล่อง — สูง 48px ตามมาตรฐานแตะบนมือถือ */
export function DialogButton({
  children,
  onClick,
  type = "button",
  tone = "neutral",
  disabled = false,
  full = false,
  icon: Icon,
  formId,
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  tone?: "neutral" | "primary" | "ok" | "warn" | "danger" | "accent";
  disabled?: boolean;
  full?: boolean;
  icon?: LucideIcon;
  /** ผูกกับฟอร์มที่อยู่ในส่วนเนื้อหา เพื่อให้ปุ่มในส่วนลงมือกดส่งฟอร์มได้ */
  formId?: string;
}) {
  const tones: Record<string, { border: string; background: string; color: string }> = {
    neutral: { border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--fg-strong)" },
    primary: { border: "none", background: "linear-gradient(135deg, #7c5cfc, #6a4eff)", color: "#fff" },
    ok: { border: "none", background: "#10b981", color: "#fff" },
    warn: { border: "1px solid var(--sc-warn-border)", background: "var(--sc-warn-bg)", color: "var(--sc-warn-fg)" },
    danger: { border: "none", background: "#dc2626", color: "#fff" },
    accent: { border: "none", background: "var(--accent, #f59e0b)", color: "#1a1a1a" },
  };
  const t = tones[tone] || tones.neutral;

  return (
    <button
      type={type}
      form={formId}
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
