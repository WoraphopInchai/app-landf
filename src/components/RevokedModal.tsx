import { ShieldAlert } from "lucide-react";

interface RevokedModalProps {
  open: boolean;
  onConfirm: () => void;
}

export default function RevokedModal({ open, onConfirm }: RevokedModalProps) {
  if (!open) return null;

  return (
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
        zIndex: 1000,
        padding: "20px",
        animation: "fadeIn 0.2s ease",
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid #4a1f28",
          borderRadius: "20px",
          padding: "28px 24px 20px",
          width: "100%",
          maxWidth: 360,
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          animation: "slideUp 0.25s ease",
        }}
      >
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
              backgroundColor: "#2a1418",
              border: "1px solid #4a1f28",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShieldAlert size={26} color="#f87171" />
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
              สิทธิ์ของคุณถูกถอดออก
            </h3>
            <p
              style={{
                margin: "6px 0 0",
                fontSize: 13.5,
                color: "var(--fg-muted)",
                lineHeight: 1.5,
              }}
            >
              บัญชีของคุณไม่อยู่ในระบบเจ้าหน้าที่อีกต่อไป
              <br />
              กด "ตกลง" เพื่อกลับไปหน้าเข้าสู่ระบบ
            </p>
          </div>

          <div style={{ display: "flex", width: "100%", marginTop: 4 }}>
            <button
              onClick={onConfirm}
              style={{
                flex: 1,
                padding: "11px 0",
                borderRadius: 12,
                border: "1px solid #4a1f28",
                backgroundColor: "#2a1418",
                color: "#f87171",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background-color 0.15s",
              }}
            >
              ตกลง กลับไปหน้าเข้าสู่ระบบ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}