import React, { useState, useRef, useEffect } from "react";
import {
  Search,
  Box,
  ShieldAlert,
  ChevronDown,
  Camera,
  X,
  ArrowLeft,
  CheckCircle2,
  Tag,
} from "lucide-react";
import {
  collection,
  query,
  getDocs,
  orderBy,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import { ITEM_CATEGORIES, UP_LOCATIONS } from "../constants";
import type { AppUser } from "../types";
import { uploadManyToCloudinary } from "../lib/uploadImage";
import { MAX_POST_IMAGES, validateImageFile } from "../lib/postImages";
import { isCurrentUserBanned } from "../lib/userGuard";
import ToastContainer from "../components/Toast";
import Dialog, { DialogButton } from "../components/Dialog";
import { showToast } from "../lib/toast";

interface ReportItemProps {
  user?: AppUser;
  onSuccess: () => void;
  onCancel: () => void;
  onOpenProfile?: () => void;
}

/** รูปที่เลือกแต่ยังไม่ได้อัปโหลด — เก็บ preview เป็น object URL เพื่อให้ได้ทันทีและเรียงตามลำดับไฟล์เสมอ */
type PendingImage = {
  id: string;
  file: File;
  preview: string;
};

export default function ReportItem({
  user,
  onSuccess,
  onCancel,
}: ReportItemProps) {
  const [itemType, setItemType] = useState<"lost" | "found">("lost");
  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [locationName, setLocationName] = useState("");
  const [depositLocation, setDepositLocation] = useState("");
  const [returnPointOptions, setReturnPointOptions] = useState<string[]>([]);
  const [desc, setDesc] = useState("");
  const [reporterName] = useState(user?.name || "");
  // เก็บไฟล์กับพรีวิวไว้คู่กันที่ index เดียวกันเสมอ (ไม่งั้นลำดับรูปจะเพี้ยน)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [uploadedCount, setUploadedCount] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [showDropoffConfirm, setShowDropoffConfirm] = useState(false);
  const dropoffConfirmed = useRef(false);
  const [showFoundHint, setShowFoundHint] = useState(false);
  const foundHintShown = useRef(false);

  // ปล่อย object URL ของพรีวิวเมื่อฟอร์มถูกปิด ไม่งั้นหน่วยความจำรูปจะค้าง
  const pendingImagesRef = useRef<PendingImage[]>(pendingImages);
  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);
  useEffect(() => {
    return () => {
      pendingImagesRef.current.forEach((p) => URL.revokeObjectURL(p.preview));
    };
  }, []);

  const handleSelectFound = () => {
    setItemType("found");
    if (!foundHintShown.current) {
      foundHintShown.current = true;
      setShowFoundHint(true);
    }
  };

  const locationDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        locationDropdownRef.current &&
        !locationDropdownRef.current.contains(event.target as Node)
      ) {
        setIsLocationOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // โหลดจุดคืนจากคอลเลกชัน returnPoints (ที่แอดมินจัดการผ่านหน้า "จัดการแอดมิน")
  // เฉพาะจุดที่เปิดใช้ (active !== false) — ถ้าไม่มีจุดเปิดเลย ฟอร์มจะบอกให้ติดต่อแอดมิน
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const q = query(
          collection(db, "returnPoints"),
          orderBy("createdAt", "asc")
        );
        const snap = await getDocs(q);
        if (!active) return;
        const points = snap.docs
          .map((d) => d.data() as { name?: string; active?: boolean })
          .filter((d) => d.active !== false && d.name && d.name.trim())
          .map((d) => d.name!.trim());
        setReturnPointOptions(points);
      } catch (error) {
        console.warn("Cannot load return points:", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filteredLocations = UP_LOCATIONS.filter((loc) =>
    loc.toLowerCase().includes(locationSearch.toLowerCase())
  );

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    // ให้เลือกไฟล์เดิมซ้ำได้ (จำเป็นมาก เพราะ input เป็น element เดียวกันทุกครั้ง)
    e.target.value = "";
    if (picked.length === 0) return;

    // เติมให้ครบไม่เกิน 3 รูป
    const room = MAX_POST_IMAGES - pendingImages.length;
    if (room <= 0) {
      showToast(`ใส่รูปได้สูงสุด ${MAX_POST_IMAGES} รูป`, "info");
      return;
    }
    const accepted: File[] = [];
    for (const file of picked) {
      if (accepted.length >= room) break;
      const err = validateImageFile(file);
      if (err) {
        showToast(err, "info");
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    if (picked.length > room) {
      showToast(`เลือกได้อีก ${room} รูป (สูงสุด ${MAX_POST_IMAGES} รูป)`, "info");
    }

    // ใช้ object URL เพราะได้ผลทันที (FileReader เป็น async ทำให้ลำดับพรีวิวเพี้ยนได้)
    setPendingImages((prev) => [
      ...prev,
      ...accepted.map((file, i) => ({
        id: `${Date.now()}-${prev.length + i}-${file.name}`,
        file,
        preview: URL.createObjectURL(file),
      })),
    ]);
  };

  // ลบรูปออกจากช่องที่เลือก
  const removeImageAt = (index: number) => {
    setPendingImages((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  // ฟังก์ชันอัปโหลดรูปขึ้น Cloudinary
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (await isCurrentUserBanned()) {
      showToast("บัญชีของคุณถูกระงับการใช้งาน ไม่สามารถแจ้งของได้", "error");
      return;
    }

    if (!title.trim() || !category || !locationName) {
      showToast("กรุณากรอกข้อมูลที่จำเป็น (*) และเลือกหมวดหมู่ให้ครบถ้วน", "info");
      return;
    }

    if (itemType === "found" && returnPointOptions.length === 0) {
      showToast("ยังไม่มีจุดคืนที่เปิดใช้งานอยู่ โปรดติดต่อแอดมินก่อนแจ้งของพบ", "info");
      return;
    }

    if (itemType === "found" && !depositLocation) {
      showToast("กรุณาเลือกจุดฝากสิ่งของที่นำส่ง (ป้อมยาม/กองกิจการนิสิต)", "info");
      return;
    }

    // โพสต์ของพบ: แจ้ง popup เตือนก่อนว่าให้เอาของไปฝากที่จุดรับฝากที่เลือก
    if (itemType === "found" && !dropoffConfirmed.current) {
      setShowDropoffConfirm(true);
      return;
    }

    await runSubmit();
  };

  const confirmDropoffAndSubmit = async () => {
    setShowDropoffConfirm(false);
    dropoffConfirmed.current = true;
    await runSubmit();
  };

  const runSubmit = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);

    try {
      // 1. อัปโหลดรูปภาพทั้งหมดผ่าน Cloudinary (ถ้ามี)
      let imageUrls: string[] = [];
      const files = pendingImages.map((p) => p.file);
      if (files.length > 0) {
        try {
          console.log(`Uploading ${files.length} image(s) to Cloudinary...`);
          setUploadedCount(0);
          imageUrls = await uploadManyToCloudinary(files, (done, total) =>
            setUploadedCount(done / total)
          );
          console.log("Cloudinary Upload Success:", imageUrls);
          if (imageUrls.length === 0) {
            showToast("อัปโหลดรูปไม่สำเร็จ แต่จะดำเนินการโพสต์ข้อมูลต่อ", "error");
          } else if (imageUrls.length < files.length) {
            showToast(
              `อัปโหลดสำเร็จ ${imageUrls.length} จาก ${files.length} รูป`,
              "info"
            );
          }
        } catch (imgErr) {
          console.error("Cloudinary upload failed:", imgErr);
          showToast("อัปโหลดรูปไม่สำเร็จ แต่จะดำเนินการโพสต์ข้อมูลต่อ", "error");
        }
      }

      // 2. บันทึกลง Firestore
      console.log("Saving post to Firestore...");
      const postRef = await addDoc(collection(db, "posts"), {
        itemType,
        category,
        title,
        locationName,
        building: locationName,
        date: new Date().toISOString(),
        depositLocation: itemType === "found" ? depositLocation : "",
        desc,
        // รูปปก = รูปแรก (คงฟิลด์เดิมไว้ให้ทุกที่ที่แสดงรูปเดิมทำงานถูกต้อง)
        imageUrl: imageUrls[0] || null,
        // รูปทั้งหมด (สูงสุด 3 รูป)
        imageUrls,
        status: itemType === "found" ? "pending" : "active",
        createdAt: serverTimestamp(),
        userId: auth.currentUser?.uid || user?.id || "anonymous",
        reporterName:
          reporterName.trim() ||
          auth.currentUser?.displayName ||
          "ผู้ใช้งานทั่วไป",
      });

      console.log("Post saved with ID:", postRef.id);

      // โพสต์ของพบต้องรอแอดมินตรวจรับของที่จุดรับก่อน → แจ้งกริ่งแอดมินทันที
      if (itemType === "found") {
        addDoc(collection(db, "notifications"), {
          type: "found_pending",
          recipientRole: "admin",
          pointName: depositLocation || "",
          postId: postRef.id,
          postTitle: title,
          itemType,
          reporterId: auth.currentUser?.uid || user?.id || "anonymous",
          reporterName:
            reporterName.trim() || auth.currentUser?.displayName || "ผู้ใช้งานทั่วไป",
          read: false,
          createdAt: serverTimestamp(),
        }).catch((err) => console.error("Error notifying admin for found request:", err));
      }

      setIsSubmitting(false);
      showToast(
        itemType === "found"
          ? "ส่งคำขอโพสต์ของพบแล้ว รอแอดมินตรวจรับของที่จุดรับ"
          : "บันทึกข้อมูลสำเร็จเรียบร้อยแล้ว!"
      );
      onSuccess();
    } catch (error) {
      console.error("Error adding document: ", error);
      showToast("เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง", "error");
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="laf-page-scroll"
      style={{
        flex: 1,
        overflowY: "auto",
        backgroundColor: "var(--bg)",
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        color: "var(--fg-strong)",
        position: "relative",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        paddingBottom: "40px",
      }}
    >
      <style>{`
        div::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* Header */}
      <div
        className="laf-page-header"
        style={{
          padding: "12px 20px",
          color: "var(--fg)",
          borderBottom: "1px solid var(--border)",
          position: "relative",
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                width: "38px",
                height: "38px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <ArrowLeft size={18} color="var(--fg-strong)" />
            </button>
            <div>
              <div
                style={{
                  fontSize: "11px",
                  letterSpacing: "0.05em",
                  color: "var(--fg-muted)",
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}
              >
                University of Phayao
              </div>
              <div
                style={{
                  fontSize: "17px",
                  fontWeight: 800,
                  color: "var(--fg)",
                  marginTop: "1px",
                  letterSpacing: "-0.01em",
                }}
              >
                ระบบบันทึกข้อมูลทรัพย์สิน{" "}
                <span style={{ color: "var(--fg-muted)" }}>(UP Lost & Found)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Form Container */}
      <div style={{ padding: "20px", maxWidth: 720, margin: "0 auto", width: "100%" }}>
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "16px" }}
        >
          {/* Section: Select Report Item */}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  background: "#7c5cfc",
                  boxShadow: "0 0 8px rgba(124,92,252,0.8)",
                }}
              />
              <span
                style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)" }}
              >
                เลือกประเภทการแจ้ง
              </span>
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => setItemType("lost")}
                style={{
                  flex: 1,
                  padding: "18px 12px",
                  borderRadius: "14px",
                  border:
                    itemType === "lost"
                      ? "2px solid #7c5cfc"
                      : "1.5px solid var(--border)",
                  backgroundColor:
                    itemType === "lost" ? "var(--bg-hover)" : "var(--bg-card)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "10px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow:
                    itemType === "lost"
                      ? "0 6px 20px rgba(124,92,252,0.25)"
                      : "0 1px 3px rgba(0,0,0,0.3)",
                }}
              >
                <div
                  style={{
                    width: "46px",
                    height: "46px",
                    borderRadius: "13px",
                    background:
                      itemType === "lost"
                        ? "#7c5cfc"
                        : "var(--sc-warn-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Search
                    size={22}
                    color={itemType === "lost" ? "var(--accent-fg)" : "var(--sc-warn-fg)"}
                  />
                </div>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: itemType === "lost" ? "var(--fg)" : "var(--fg-secondary)",
                  }}
                >
                  ของหาย
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: itemType === "lost" ? "var(--fg-accent)" : "var(--fg-faint)",
                    fontWeight: 500,
                  }}
                >
                  คุณทำของหาย
                </span>
              </button>

              <button
                type="button"
                onClick={handleSelectFound}
                style={{
                  flex: 1,
                  padding: "18px 12px",
                  borderRadius: "14px",
                  border:
                    itemType === "found"
                      ? "2px solid var(--sc-ok-fg)"
                      : "1.5px solid var(--border)",
                  backgroundColor:
                    itemType === "found" ? "var(--sc-ok-bg)" : "var(--bg-card)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "10px",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow:
                    itemType === "found"
                      ? "0 6px 20px rgba(52,211,153,0.2)"
                      : "0 1px 3px rgba(0,0,0,0.3)",
                }}
              >
                <div
                  style={{
                    width: "46px",
                    height: "46px",
                    borderRadius: "13px",
                    background:
                      itemType === "found"
                        ? "linear-gradient(135deg, var(--sc-ok-fg), #10b981)"
                        : "var(--sc-ok-bg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Box
                    size={22}
                    color={itemType === "found" ? "var(--accent-fg)" : "var(--sc-ok-fg)"}
                  />
                </div>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: itemType === "found" ? "var(--sc-ok-fg-strong)" : "var(--fg-secondary)",
                  }}
                >
                  พบของ
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: itemType === "found" ? "var(--sc-ok-fg)" : "var(--fg-faint)",
                    fontWeight: 500,
                  }}
                >
                  คุณเก็บของได้
                </span>
              </button>
            </div>
          </div>

          {/* Section: หลักฐานรูปภาพ */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  background: "#7c5cfc",
                  boxShadow: "0 0 8px rgba(124,92,252,0.8)",
                }}
              />
              <span
                style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)" }}
              >
                หลักฐานรูปภาพ
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "var(--fg-faint)",
                  marginLeft: "auto",
                }}
              >
                ไม่บังคับ
              </span>
            </div>

            {pendingImages.length > 0 ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: "8px",
                  }}
                >
                  {pendingImages.map(({ id, preview }, idx) => (
                    <div
                      key={id}
                      style={{
                        position: "relative",
                        aspectRatio: "1 / 1",
                        borderRadius: "12px",
                        overflow: "hidden",
                        border: "1px solid var(--border)",
                        background: "var(--bg-subtle)",
                      }}
                    >
                      <img
                        src={preview}
                        alt={`รูปที่ ${idx + 1}`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                      {idx === 0 && (
                        <span
                          style={{
                            position: "absolute",
                            top: "5px",
                            left: "5px",
                            padding: "2px 7px",
                            borderRadius: "999px",
                            background: "rgba(0,0,0,0.66)",
                            color: "#fff",
                            fontSize: "10px",
                            fontWeight: 700,
                            lineHeight: 1.5,
                          }}
                        >
                          รูปปก
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeImageAt(idx)}
                        aria-label={`ลบรูปที่ ${idx + 1}`}
                        style={{
                          position: "absolute",
                          top: "5px",
                          right: "5px",
                          background: "rgba(0, 0, 0, 0.6)",
                          color: "#fff",
                          border: "none",
                          borderRadius: "50%",
                          width: "26px",
                          height: "26px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* ปุ่มเพิ่มรูป (ซ่อนเมื่อครบ 3 รูปแล้ว) */}
                {pendingImages.length < MAX_POST_IMAGES && (
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                      marginTop: "8px",
                      padding: "12px",
                      backgroundColor: "var(--bg-subtle)",
                      border: "2px dashed var(--border-strong)",
                      borderRadius: "12px",
                      cursor: "pointer",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "var(--fg-strong)",
                    }}
                  >
                    <Camera size={18} color="var(--fg-accent)" />
                    เพิ่มรูปภาพ ({pendingImages.length}/{MAX_POST_IMAGES})
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageChange}
                      style={{ display: "none" }}
                    />
                  </label>
                )}
                <div style={{ fontSize: "11px", color: "var(--fg-muted)", marginTop: "6px" }}>
                  รูปแรกจะเป็นรูปปกของโพสต์ · รูปละไม่เกิน 5MB
                </div>
              </>
            ) : (
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "10px",
                  padding: "30px",
                  backgroundColor: "var(--bg-subtle)",
                  border: "2px dashed var(--border-strong)",
                  borderRadius: "14px",
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "all 0.15s ease",
                }}
              >
                <div
                  style={{
                    width: "52px",
                    height: "52px",
                    borderRadius: "16px",
                    background: "#7c5cfc",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 14px rgba(124,92,252,0.4)",
                  }}
                >
                  <Camera size={24} color="var(--accent-fg)" />
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "var(--fg-strong)",
                    }}
                  >
                    แตะเพื่ออัปโหลดรูปภาพ
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--fg-muted)" }}>
                    เลือกได้สูงสุด {MAX_POST_IMAGES} รูป · ถ่ายให้ชัด หรือไฟล์สูงสุด 5MB ต่อรูป
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageChange}
                  style={{ display: "none" }}
                />
              </label>
            )}
          </div>

          {/* Section: Item Details */}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  background: "#7c5cfc",
                  boxShadow: "0 0 8px rgba(124,92,252,0.8)",
                }}
              />
              <span
                style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)" }}
              >
                รายละเอียดสิ่งของ
              </span>
            </div>

            {/* หมวดหมู่สิ่งของ */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "var(--fg-secondary)",
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                <Tag size={14} color="var(--fg-accent)" />
                <span>หมวดหมู่สิ่งของ</span>{" "}
                <span style={{ color: "var(--sc-danger-fg)" }}>*</span>
              </label>
              <select
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-subtle)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  fontSize: "13px",
                  outline: "none",
                  color: category ? "var(--fg-strong)" : "var(--fg-faint)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.4)",
                }}
              >
                <option value="" disabled>
                  เลือกหมวดหมู่สิ่งของ...
                </option>
                {ITEM_CATEGORIES.map((cat, idx) => (
                  <option key={idx} value={cat} style={{ color: "var(--fg-strong)" }}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            {/* ชื่อสิ่งของ */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label
                style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)" }}
              >
                ชื่อสิ่งของ <span style={{ color: "var(--sc-danger-fg)" }}>*</span>
              </label>
              <input
                type="text"
                required
                placeholder="เช่น กระติกน้ำสีฟ้า, กุญแจพร้อมสายคล้อง"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-subtle)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  fontSize: "13px",
                  outline: "none",
                  color: "var(--fg-strong)",
                  transition: "all 0.15s ease",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* รายละเอียด */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <label
                style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)" }}
              >
                รายละเอียด
              </label>
              <textarea
                rows={3}
                placeholder="ระบุลักษณะเด่น สี ตำหนิ หรือเลขห้อง/พื้นที่เพิ่มเติม..."
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                style={{
                  border: "1px solid var(--border)",
                  backgroundColor: "var(--bg-subtle)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  fontSize: "13px",
                  outline: "none",
                  resize: "none",
                  color: "var(--fg-strong)",
                  transition: "all 0.15s ease",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>

          {/* Section: Location Information */}
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "9px",
                  height: "9px",
                  borderRadius: "50%",
                  background: "#7c5cfc",
                  boxShadow: "0 0 8px rgba(124,92,252,0.8)",
                }}
              />
              <span
                style={{ fontSize: "15px", fontWeight: 800, color: "var(--fg)" }}
              >
                ข้อมูลสถานที่
              </span>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                position: "relative",
              }}
              ref={locationDropdownRef}
            >
              <label
                style={{ fontSize: "12px", fontWeight: 700, color: "var(--fg-secondary)" }}
              >
                สถานที่ / ตึกเรียน <span style={{ color: "var(--sc-danger-fg)" }}>*</span>
              </label>
              <div
                onClick={() => setIsLocationOpen(!isLocationOpen)}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  fontSize: "13px",
                  backgroundColor: "var(--bg-subtle)",
                  color: locationName ? "var(--fg-strong)" : "var(--fg-faint)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  transition: "all 0.15s ease",
                }}
              >
                <span>
                  {locationName ||
                    "คลิกเพื่อเลือกหรือพิมพ์ค้นหาตึกเรียน/สถานที่..."}
                </span>
                <ChevronDown size={16} color="var(--fg-muted)" />
              </div>

              {isLocationOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    backgroundColor: "var(--bg-card)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "14px",
                    boxShadow: "0 12px 32px rgba(0,0,0,0.6)",
                    zIndex: 20,
                    marginTop: "6px",
                    padding: "10px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      padding: "8px 10px",
                      backgroundColor: "var(--bg-subtle)",
                      borderRadius: "10px",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <Search size={14} color="var(--fg-accent)" />
                    <input
                      type="text"
                      placeholder="พิมพ์ค้นหาชื่อคณะ อาคาร หรือพื้นที่..."
                      value={locationSearch}
                      onChange={(e) => setLocationSearch(e.target.value)}
                      autoFocus
                      style={{
                        border: "none",
                        background: "transparent",
                        fontSize: "12px",
                        outline: "none",
                        width: "100%",
                        color: "var(--fg-strong)",
                      }}
                    />
                  </div>

                  <div
                    style={{
                      maxHeight: "200px",
                      overflowY: "auto",
                      display: "flex",
                      flexDirection: "column",
                      gap: "2px",
                    }}
                  >
                    {locationSearch.trim() &&
                      !filteredLocations.includes(locationSearch.trim()) && (
                        <div
                          onClick={() => {
                            setLocationName(locationSearch.trim());
                            setIsLocationOpen(false);
                            setLocationSearch("");
                          }}
                          style={{
                            padding: "9px 10px",
                            fontSize: "12px",
                            cursor: "pointer",
                            borderRadius: "4px",
                            backgroundColor: "var(--bg-hover)",
                            color: "var(--fg-accent)",
                            fontWeight: 600,
                            borderBottom: "1px dashed var(--border-strong)",
                            marginBottom: "4px",
                          }}
                        >
                          ใช้ข้อความที่พิมพ์ : "{locationSearch.trim()}"
                        </div>
                      )}

                    {filteredLocations.length > 0 ? (
                      filteredLocations.map((loc, index) => (
                        <div
                          key={index}
                          onClick={() => {
                            setLocationName(loc);
                            setIsLocationOpen(false);
                            setLocationSearch("");
                          }}
                          style={{
                            padding: "9px 10px",
                            fontSize: "12px",
                            cursor: "pointer",
                            borderRadius: "4px",
                            backgroundColor:
                              locationName === loc ? "var(--bg-hover)" : "transparent",
                            color:
                              locationName === loc ? "var(--fg)" : "var(--fg-secondary)",
                            fontWeight: locationName === loc ? 600 : 400,
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.backgroundColor = "var(--bg-card)")
                          }
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.backgroundColor =
                              locationName === loc ? "var(--bg-hover)" : "transparent")
                          }
                        >
                          {loc}
                        </div>
                      ))
                    ) : !locationSearch.trim() ? (
                      <div
                        style={{
                          padding: "10px",
                          fontSize: "12px",
                          color: "var(--fg-faint)",
                          textAlign: "center",
                        }}
                      >
                        พิมพ์เพื่อค้นหาตึกเรียนหรืออาคาร
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>

            {/* จุดฝากที่ป้อมยาม (แสดงเฉพาะเมื่อเลือก "พบของ") */}
            {itemType === "found" && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  background:
                    "linear-gradient(135deg, var(--sc-ok-bg), var(--sc-ok-bg))",
                  padding: "14px",
                  borderRadius: "14px",
                  border: "1px solid var(--sc-ok-border)",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--sc-ok-fg-strong)",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "7px",
                      background:
                        "linear-gradient(135deg, var(--sc-ok-fg), #10b981)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ShieldAlert size={13} color="var(--accent-fg)" />
                  </div>
                  <span>
                    จุดฝากสิ่งของที่นำส่ง (ป้อมยาม/กองกิจการนิสิต)
                  </span>{" "}
                  <span style={{ color: "var(--sc-danger-fg)" }}>*</span>
                </label>
                <select
                  required={itemType === "found"}
                  value={depositLocation}
                  onChange={(e) => setDepositLocation(e.target.value)}
                  style={{
                    border: "1px solid var(--sc-ok-border)",
                    borderRadius: "10px",
                    padding: "11px 14px",
                    fontSize: "13px",
                    outline: "none",
                    backgroundColor: "var(--bg-subtle)",
                    color: depositLocation ? "var(--fg-strong)" : "var(--fg-faint)",
                    cursor: "pointer",
                    boxSizing: "border-box",
                  }}
                >
                  {returnPointOptions.length === 0 ? (
                    <option value="" disabled>
                      จุดคืนยังไม่พร้อมใช้งาน ติดต่อแอดมิน
                    </option>
                  ) : (
                    <>
                      <option value="" disabled>
                        เลือกจุดฝากของ...
                      </option>
                      {returnPointOptions.map((point) => (
                        <option key={point} value={point}>
                          {point}
                        </option>
                      ))}
                    </>
                  )}
                </select>
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "8px",
                    marginTop: "10px",
                    padding: "10px 12px",
                    borderRadius: "10px",
                    background: "var(--sc-warn-bg)",
                    border: "1px solid var(--sc-warn-border)",
                    fontSize: "12.5px",
                    lineHeight: 1.55,
                    color: "var(--sc-warn-fg)",
                  }}
                >
                  <div style={{ flexShrink: 0, marginTop: 1 }}>
                    <Box size={15} />
                  </div>
                  <div>
                    <b>อย่าลืม!</b> นำของไปฝากที่{" "}
                    <b style={{ color: "#fde68a" }}>
                      {depositLocation || "จุดที่เลือกไว้"}
                    </b>{" "}
                    โดยเร็วที่สุด แล้วแจ้งเจ้าหน้าที่ — ไม่อย่างนั้นโพสต์จะไม่ขึ้น
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "12px", marginTop: "10px" }}>
            <button
              type="button"
              onClick={onCancel}
              style={{
                flex: 1,
                backgroundColor: "var(--bg-card)",
                color: "var(--fg-strong)",
                border: "1.5px solid var(--border)",
                borderRadius: "14px",
                padding: "14px",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                flex: 2,
                background: isSubmitting
                  ? "var(--border-strong)"
                  : "linear-gradient(135deg, #7c5cfc 0%, #4f3bd6 100%)",
                color: isSubmitting ? "var(--fg-secondary)" : "var(--accent-fg)",
                border: "none",
                borderRadius: "14px",
                padding: "14px",
                fontSize: "14px",
                fontWeight: 800,
                cursor: isSubmitting ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                boxShadow: isSubmitting
                  ? "none"
                  : "0 8px 22px rgba(124, 92, 252, 0.4)",
                transition: "all 0.15s ease",
              }}
            >
              <CheckCircle2 size={18} color="var(--fg)" />
              <span>
                {isSubmitting
                  ? uploadedCount > 0
                    ? `กำลังอัปโหลดรูป ${Math.round(uploadedCount * 100)}%`
                    : "กำลังบันทึกข้อมูล..."
                  : "ส่งข้อมูล"}
              </span>
            </button>
          </div>
        </form>
      </div>

      <ToastContainer />

      <Dialog
        open={showFoundHint}
        onClose={() => setShowFoundHint(false)}
        title="แจ้งพบของ — เริ่มจากไม่ยาก มี 3 ขั้น"
        icon={Box}
        iconTone="ok"
        align="start"
        maxWidth={420}
        footer={
          <DialogButton onClick={() => setShowFoundHint(false)} tone="accent" full>
            รับทราบ เข้าใจแล้ว
          </DialogButton>
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {[
            {
              step: "1",
              text: (
                <>
                  เลือก<span style={{ fontWeight: 800, color: "var(--sc-ok-fg)" }}>จุดรับฝาก</span>ในฟอร์ม (ป้อมยาม / กองกิจการนิสิต)
                </>
              ),
            },
            {
              step: "2",
              text: "นำของที่พบไปฝากที่จุดนั้น + แจ้งเจ้าหน้าที่ว่ามีของฝากจากระบบ",
            },
            {
              step: "3",
              text: (
                <>
                  แอดมิน<span style={{ fontWeight: 800, color: "var(--sc-ok-fg)" }}>ตรวจรับของ</span>แล้วจึงอนุมัติให้โพสต์ขึ้นระบบ
                </>
              ),
            },
          ].map((row) => (
            <div key={row.step} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <div style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "var(--sc-ok-bg)",
                border: "1px solid var(--sc-ok-border)",
                color: "var(--sc-ok-fg)",
                fontSize: "12px",
                fontWeight: 800,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                {row.step}
              </div>
              <div style={{ fontSize: "13.5px", lineHeight: 1.6, color: "var(--fg-secondary)" }}>
                {row.text}
              </div>
            </div>
          ))}
        </div>
        <div style={{
          padding: "10px 12px",
          borderRadius: "10px",
          background: "var(--sc-brand-bg)",
          border: "1px solid var(--sc-brand-border)",
          fontSize: "13px",
          lineHeight: 1.6,
          color: "var(--sc-brand-fg)",
          marginTop: "14px",
        }}>
          ของหายโพสต์ขึ้นทันที /{" "}
          <span style={{ fontWeight: 800 }}>ของพบต้องผ่านแอดมินตรวจรับของก่อน</span>
        </div>
      </Dialog>

      <Dialog
        open={showDropoffConfirm}
        onClose={() => setShowDropoffConfirm(false)}
        title="นำของที่พบไปฝากที่จุดรับฝาก"
        icon={Box}
        iconTone="ok"
        align="start"
        maxWidth={440}
        footer={
          <>
            <DialogButton onClick={() => setShowDropoffConfirm(false)}>ยกเลิก</DialogButton>
            <DialogButton onClick={confirmDropoffAndSubmit} tone="accent">
              ยืนยันโอเค ฉันจะนำของไปฝาก
            </DialogButton>
          </>
        }
      >
        <div style={{ fontSize: "14px", lineHeight: 1.65, color: "var(--fg-secondary)" }}>
          โพสต์ของคุณจะยังไม่ถูกเผยแพร่จนกว่าแอดมินจะตรวจรับของ
          กรุณานำของไปฝากที่จุดรับฝากที่คุณเลือกไว้:
        </div>
        <div style={{
          margin: "12px 0",
          padding: "10px 12px",
          borderRadius: "10px",
          background: "var(--sc-warn-bg)",
          border: "1px solid var(--sc-warn-border)",
          color: "var(--sc-warn-fg)",
          fontSize: "14px",
          fontWeight: 800,
        }}>
          {depositLocation || "จุดที่เลือกไว้"}
        </div>
        <div style={{ fontSize: "13px", lineHeight: 1.6, color: "var(--fg-faint)" }}>
          แจ้งเจ้าหน้าที่ ณ จุดรับฝากว่ามีของฝากจากระบบ Lost &amp; Found
          (แสดงชื่อผู้ฝากและข้อมูลที่กรอกได้เลย)
          หากไม่นำของไปฝากภายในเวลาที่กำหนด โพสต์จะถูกปฏิเสธ
        </div>
      </Dialog>
    </div>
  );
}