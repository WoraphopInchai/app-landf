import { ShieldAlert } from "lucide-react";
import Dialog, { DialogButton } from "./Dialog";

interface RevokedModalProps {
  open: boolean;
  onConfirm: () => void;
}

export default function RevokedModal({ open, onConfirm }: RevokedModalProps) {
  return (
    <Dialog
      open={open}
      title="สิทธิ์ของคุณถูกถอดออก"
      icon={ShieldAlert}
      maxWidth={400}
      zIndex={1000}
      dismissible={false}
      footer={<DialogButton onClick={onConfirm} tone="danger" full>ตกลง กลับไปหน้าเข้าสู่ระบบ</DialogButton>}
    >
      <div style={{
        fontSize: "14.5px",
        color: "var(--fg-secondary)",
        lineHeight: 1.65,
      }}>
        บัญชีของคุณไม่อยู่ในระบบเจ้าหน้าที่อีกต่อไป
        <br />
        กด &quot;ตกลง&quot; เพื่อกลับไปหน้าเข้าสู่ระบบ
      </div>
    </Dialog>
  );
}
