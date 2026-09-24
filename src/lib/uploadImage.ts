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