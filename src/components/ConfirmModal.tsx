import { AlertTriangle, Loader2 } from "lucide-react";
import Dialog, { DialogButton } from "./Dialog";

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
  const isDanger = variant === "danger";

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      icon={AlertTriangle}
      iconTone={isDanger ? "danger" : "primary"}
      maxWidth={420}
      zIndex={10000}
      footer={
        <>
          <DialogButton onClick={onCancel} disabled={busy}>
            {cancelText}
          </DialogButton>
          <DialogButton
            onClick={onConfirm}
            tone={isDanger ? "danger" : "primary"}
            disabled={busy}
          >
            {busy && <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} />}
            {busy ? "กำลังดำเนินการ..." : confirmText}
          </DialogButton>
        </>
      }
    >
      <div style={{
        fontSize: "14.5px",
        color: "var(--fg-secondary)",
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {message}
      </div>
    </Dialog>
  );
}
