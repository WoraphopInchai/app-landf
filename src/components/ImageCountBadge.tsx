import { Images } from "lucide-react";
import { getPostExtraCount } from "../lib/postImages";

type PostLike = {
  imageUrls?: string[] | null;
  imageUrl?: string | null;
  image?: string | null;
};

/**
 * ป้ายบอกว่ามีรูปเพิ่มอีกกี่รูป (แสดงเฉพาะโพสต์ที่มีมากกว่า 1 รูป)
 * วางทับมุมขวาล่างของรูป — ใช้ร่วมกันได้ทั้งการ์ดใหญ่และ thumbnail เล็ก
 */
export default function ImageCountBadge({
  post,
  size = "md",
}: {
  post?: PostLike | null;
  /** sm = กับ thumbnail เล็ก (44-64px) · md = กับการ์ดรูปใหญ่ (>=150px) */
  size?: "sm" | "md";
}) {
  const extra = getPostExtraCount(post);
  if (extra <= 0) return null;

  if (size === "sm") {
    return (
      <span
        aria-label={`มีรูปอีก ${extra} รูป`}
        style={{
          position: "absolute",
          bottom: "2px",
          right: "2px",
          display: "inline-flex",
          alignItems: "center",
          gap: "1px",
          padding: "1px 4px",
          borderRadius: "999px",
          backgroundColor: "rgba(0, 0, 0, 0.68)",
          color: "#fff",
          fontSize: "9px",
          fontWeight: 800,
          lineHeight: 1.5,
          pointerEvents: "none",
        }}
      >
        <Images size={8} />
        {extra}
      </span>
    );
  }

  return (
    <span
      aria-label={`มีรูปอีก ${extra} รูป`}
      style={{
        position: "absolute",
        bottom: "8px",
        right: "8px",
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        padding: "3px 9px",
        borderRadius: "999px",
        backgroundColor: "rgba(0, 0, 0, 0.68)",
        backdropFilter: "blur(6px)",
        color: "#fff",
        fontSize: "11px",
        fontWeight: 800,
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
        pointerEvents: "none",
      }}
    >
      <Images size={11} />
      {extra}
    </span>
  );
}
