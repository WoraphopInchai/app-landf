import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import type { ToastItem } from "../lib/toast";
import { subscribeToasts, dismissToast } from "../lib/toast";

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
} as const;

const COLORS = {
  success: { bg: "var(--sc-ok-bg)", border: "var(--sc-ok-border)", icon: "var(--sc-ok-fg)", shadow: "rgba(74,222,128,0.25)" },
  error:   { bg: "var(--sc-danger-bg)", border: "var(--sc-danger-border)", icon: "var(--sc-danger-fg)", shadow: "rgba(248,113,113,0.25)" },
  info:    { bg: "var(--sc-info-bg)", border: "var(--sc-info-border)", icon: "var(--sc-info-fg)", shadow: "rgba(124,92,252,0.25)" },
} as const;

export default function ToastContainer() {
  const [list, setList] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeToasts(setList);
  }, []);

  if (list.length === 0) return null;

  return (
    <>
    <style>{`@keyframes toastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } } @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <div
        className="toast-wrap"
        style={{
          position: "fixed",
          top: "max(20px, env(safe-area-inset-top, 0px))",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10000,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          pointerEvents: "none",
          width: "100%",
          maxWidth: "calc(100vw - 24px)",
        }}
      >
      {list.map((t) => {
        const Icon = ICONS[t.type];
        const c = COLORS[t.type];
        return (
          <div
            key={t.id}
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "12px 16px",
              borderRadius: 14,
              backgroundColor: c.bg,
              border: `1px solid ${c.border}`,
              boxShadow: `var(--shadow-md), 0 0 20px ${c.shadow}`,
              animation: "toastIn 0.25s ease",
              width: "100%",
              maxWidth: 420,
              minWidth: 0,
            }}
          >
            <Icon size={18} color={c.icon} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--fg)", flex: 1, lineHeight: 1.45 }}>
              {t.message}
            </span>
            <button
              onClick={() => dismissToast(t.id)}
              style={{
                flexShrink: 0,
                width: 40,
                height: 40,
                margin: "-8px -8px -8px 0",
                borderRadius: 10,
                border: "none",
                background: "transparent",
                color: "var(--fg-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
    </>
  );
}