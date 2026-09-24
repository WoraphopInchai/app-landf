import {
  Home,
  PlusCircle,
  MessageSquare,
  Briefcase,
} from "lucide-react";

type Page = "home" | "report" | "chat" | "profile" | "my-items" | "admin";

interface BottomNavProps {
  activePage: Page;
  onChangePage: (page: Page) => void;
  chatUnreadCount?: number;
}

export default function BottomNav({
  activePage,
  onChangePage,
  chatUnreadCount = 0,
}: BottomNavProps) {
  const menus = [
    { id: "home" as Page, label: "หน้าแรก", icon: Home },
    { id: "report" as Page, label: "แจ้งของ", icon: PlusCircle },
    { id: "chat" as Page, label: "แชท", icon: MessageSquare },
    { id: "my-items" as Page, label: "รายการของฉัน", icon: Briefcase },
  ];

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        backgroundColor: "var(--bg-card)",
        borderTop: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        boxShadow: "0 -4px 20px rgba(0, 0, 0, 0.5)",
        zIndex: 1000,
      }}
    >
      {menus.map((menu) => {
        const Icon = menu.icon;
        const active = activePage === menu.id;
        const isReport = menu.id === "report";

        return (
          <button
            key={menu.id}
            onClick={() => onChangePage(menu.id)}
            style={{
              flex: 1,
              height: 64,
              border: "none",
              background: "transparent",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              position: "relative",
            }}
          >
            {isReport ? (
              /* ปุ่มแจ้งของตรงกลางแบบลอยเด่น (Floating Button) */
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #7c5cfc 0%, #4f3bd6 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 2,
                  boxShadow: "0 6px 16px rgba(124, 92, 252, 0.5)",
                  border: "3px solid var(--bg)",
                  transform: "translateY(-10px)", // ดึงให้ปุ่มลอยขึ้นเหนือแถบเมนูเล็กน้อย
                  transition: "transform 0.2s ease",
                }}
              >
                <Icon size={24} color="var(--accent-fg)" />
              </div>
            ) : (
              <span style={{ position: "relative", display: "inline-flex" }}>
                <Icon
                  size={22}
                  color={active ? "#7c5cfc" : "var(--fg-faint)"}
                  style={{ transition: "color 0.2s ease" }}
                />
                {menu.id === "chat" && chatUnreadCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -11,
                      minWidth: 17,
                      height: 17,
                      padding: "0 4px",
                      borderRadius: 999,
                      backgroundColor: "#ef4444",
                      color: "#ffffff",
                      fontSize: 10,
                      fontWeight: 800,
                      lineHeight: "17px",
                      textAlign: "center",
                      boxShadow: "0 2px 6px rgba(239,68,68,0.5)",
                      pointerEvents: "none",
                    }}
                  >
                    {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
                  </span>
                )}
              </span>
            )}

            <span
              style={{
                fontSize: 11,
                fontWeight: active ? 700 : 500,
                color: isReport ? "var(--fg)" : active ? "#7c5cfc" : "var(--fg-faint)",
                marginTop: isReport ? -8 : 3, // ปรับระยะห่างตัวหนังสือของปุ่มแจ้งของให้พอดี
              }}
            >
              {menu.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}