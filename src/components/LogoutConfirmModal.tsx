import { LogOut } from "lucide-react";
import Dialog, { DialogButton } from "./Dialog";

interface LogoutConfirmModalProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LogoutConfirmModal({
  open,
  onConfirm,
  onCancel,
}: LogoutConfirmModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="ออกจากระบบ"
      icon={LogOut}
      maxWidth={420}
      zIndex={1000}
      footer={
        <>
          <DialogButton onClick={onCancel}>ยกเลิก</DialogButton>
          <DialogButton onClick={onConfirm} tone="danger">ออกจากระบบ</DialogButton>
        </>
      }
    >
      <div style={{
        fontSize: "14.5px",
        color: "var(--fg-secondary)",
        lineHeight: 1.65,
      }}>
        คุณต้องการออกจากระบบใช่หรือไม่?
      </div>
    </Dialog>
  );
}
