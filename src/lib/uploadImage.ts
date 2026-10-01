// อัปโหลดรูปภาพขึ้น Cloudinary (Unsigned Upload Preset)
// ใช้ร่วมกันทั้งโพสต์ของหาย/ของพบ และรูปหลักฐานการขอรับของ
export async function uploadToCloudinary(file: File): Promise<string> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

  if (!cloudName || !uploadPreset) {
    throw new Error("Cloudinary configuration keys are missing in .env");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      body: formData,
    }
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.error?.message || "Failed to upload image to Cloudinary"
    );
  }

  const data = await response.json();
  return data.secure_url;
}

/**
 * อัปโหลดหลายรูปพร้อมกัน (สูงสุด 3 รูปต่อโพสต์)
 * อัปโหลดทีละรูป (ไม่ขนาน) เพื่อไม่ให้ชนเรตลิมิตของ Cloudinary
 * รูปที่อัปโหลดสำเร็จจะอยู่ในอาร์เรย์เสมอ แม้บางรูปจะล้มเหลว
 * @param files ไฟล์รูปที่ต้องการอัปโหลด
 * @param onProgress จำนวนรูปที่อัปโหลดเสร็จแล้ว (เรียกหลังแต่ละรูป)
 * @returns URL ของรูปที่อัปโหลดสำเร็จเรียงตามลำดับไฟล์
 */
export async function uploadManyToCloudinary(
  files: File[],
  onProgress?: (done: number, total: number) => void
): Promise<string[]> {
  const urls: string[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      urls.push(await uploadToCloudinary(files[i]));
    } catch (err) {
      console.error(`Cloudinary upload failed (file ${i + 1}/${files.length}):`, err);
    }
    onProgress?.(i + 1, files.length);
  }
  return urls;
}