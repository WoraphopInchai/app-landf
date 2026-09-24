import { AlertTriangle, Loader2, X } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({
  open,
  title,
  message,
  confirmText = "ยืนยัน",
  cancelText = "ยกเลิก",
  variant = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null;

  const isDanger = variant === "danger";
  const btnBg = isDanger ? "#2a1418" : "linear-gradient(135deg, #7c5cfc, #6a4eff)";
  const btnColor = isDanger ? "#f87171" : "#fff";
  const btnBorder = isDanger ? "#4a1f28" : "none";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(5, 4, 10, 0.75)",
        backdropFilter: "blur(8px)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        animation: "fadeIn 0.2s ease",
      }}
      onClick={onCancel}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 20,
          padding: "28px 24px 22px",
          width: "100%",
          maxWidth: 380,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          animation: "slideUp 0.25s ease",
          position: "relative",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onCancel}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            color: "var(--fg-muted)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <X size={14} />
        </button>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              backgroundColor: isDanger ? "#2a1418" : "#1a1a2e",
              border: `1px solid ${isDanger ? "#4a1f28" : "#2d2d5e"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <AlertTriangle
              size={26}
              color={isDanger ? "#f87171" : "#7c5cfc"}
            />
          </div>

          <div>
            <h3
              style={{
                margin: 0,
                fontSize: 17,
                fontWeight: 700,
                color: "var(--fg)",
              }}
            >
              {title}
            </h3>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 13.5,
                color: "var(--fg-muted)",
                lineHeight: 1.5,
              }}
            >
              {message}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              width: "100%",
              marginTop: 4,
            }}
          >
            <button
              onClick={onCancel}
              disabled={busy}
              style={{
                flex: 1,
                padding: "11px 0",
                borderRadius: 12,
                border: "1px solid var(--border)",
                backgroundColor: "var(--bg-subtle)",
                color: "var(--fg)",
                fontSize: 14,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.6 : 1,
                transition: "background-color 0.15s",
              }}
            >
              {cancelText}
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              style={{
                flex: 1,
                padding: "11px 0",
                borderRadius: 12,
                border: `1px solid ${btnBorder}`,
                background: btnBg,
                color: btnColor,
                fontSize: 14,
                fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.75 : 1,
                transition: "background-color 0.15s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              {busy && <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />}
              {busy ? "กำลังดำเนินการ..." : confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
