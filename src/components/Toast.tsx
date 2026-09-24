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
  success: { bg: "#14261a", border: "#24543a", icon: "#4ade80", shadow: "rgba(74,222,128,0.25)" },
  error:   { bg: "#2a1418", border: "#4a1f28", icon: "#f87171", shadow: "rgba(248,113,113,0.25)" },
  info:    { bg: "#1a1a2e", border: "#2d2d5e", icon: "#7c5cfc", shadow: "rgba(124,92,252,0.25)" },
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
      style={{
        position: "fixed",
        top: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 10000,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        pointerEvents: "none",
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
              boxShadow: `0 8px 30px rgba(0,0,0,0.45), 0 0 20px ${c.shadow}`,
              animation: "toastIn 0.25s ease",
              maxWidth: 420,
              minWidth: 220,
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
                width: 24,
                height: 24,
                borderRadius: 6,
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
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
    </>
  );
}