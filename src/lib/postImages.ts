// จำนวนรูปสูงสุดต่อโพสต์
export const MAX_POST_IMAGES = 3;

// ขนาดไฟล์รูปสูงสุดต่อรูป (5MB)
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

/** แหล่งที่อาจมี URL รูปของโพสต์ (รองรับทั้งแบบเก่าและแบบใหม่) */
type ImageSource = {
  imageUrls?: string[] | null;
  imageUrl?: string | null;
  image?: string | null;
};

/**
 * ดึงรูปทั้งหมดของโพสต์
 * - โพสต์ใหม่: ใช้ imageUrls (ครบทุกรูป)
 * - โพสต์เก่า: มีแต่ imageUrl → คืนเป็น array 1 รูป
 * - ไม่มีรูป: คืน array ว่าง
 */
export function getPostImages(post?: ImageSource | null): string[] {
  if (!post) return [];
  const list = Array.isArray(post.imageUrls) ? post.imageUrls.filter(Boolean) : [];
  if (list.length > 0) return list;
  const single = post.imageUrl || post.image;
  return single ? [single] : [];
}

/** รูปปกของโพสต์ (รูปแรก) — ใช้กับการ์ดย่อและ thumbnail ขนาดเล็ก */
export function getPostCover(post?: ImageSource | null): string | null {
  return getPostImages(post)[0] ?? null;
}

/** จำนวนรูปที่เหลือนอีกกี่รูป (ใช้ทำป้าย "+2") */
export function getPostExtraCount(post?: ImageSource | null): number {
  return Math.max(0, getPostImages(post).length - 1);
}

/** ตรวจว่าไฟล์รูปผ่านเงื่อนไข (ชนิดไฟล์ + ขนาด) — คืนข้อความ error หรือ null ถ้าผ่าน */
export function validateImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "กรุณาเลือกไฟล์รูปภาพเท่านั้น";
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return "รูปภาพต้องมีขนาดไม่เกิน 5MB";
  }
  return null;
}
