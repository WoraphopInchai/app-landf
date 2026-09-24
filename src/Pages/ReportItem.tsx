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
import { uploadToCloudinary } from "../lib/uploadImage";
import { isCurrentUserBanned } from "../lib/userGuard";
import ToastContainer from "../components/Toast";
import { showToast } from "../lib/toast";

interface ReportItemProps {
  user?: AppUser;
  onSuccess: () => void;
  onCancel: () => void;
  onOpenProfile?: () => void;
}

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
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocationOpen, setIsLocationOpen] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [showDropoffConfirm, setShowDropoffConfirm] = useState(false);
  const dropoffConfirmed = useRef(false);
  const [showFoundHint, setShowFoundHint] = useState(false);
  const foundHintShown = useRef(false);

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
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      showToast("กรุณาเลือกไฟล์รูปภาพเท่านั้น", "info");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      showToast("รูปภาพต้องมีขนาดไม่เกิน 5MB", "info");
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    setSelectedFile(file);
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
      // 1. อัปโหลดรูปภาพผ่าน Cloudinary (ถ้ามี)
      let imageUrl: string | null = null;
      if (selectedFile) {
        try {
          console.log("Uploading image to Cloudinary...");
          imageUrl = await uploadToCloudinary(selectedFile);
          console.log("Cloudinary Upload Success:", imageUrl);
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
        imageUrl,
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
                        : "#2a1a10",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Search
                    size={22}
                    color={itemType === "lost" ? "var(--accent-fg)" : "#fb923c"}
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
                      ? "2px solid #34d399"
                      : "1.5px solid var(--border)",
                  backgroundColor:
                    itemType === "found" ? "#0f2a1f" : "var(--bg-card)",
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
                        ? "linear-gradient(135deg, #34d399, #10b981)"
                        : "#0f2a1f",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Box
                    size={22}
                    color={itemType === "found" ? "var(--accent-fg)" : "#34d399"}
                  />
                </div>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: itemType === "found" ? "#6ee7b7" : "var(--fg-secondary)",
                  }}
                >
                  พบของ
                </span>
                <span
                  style={{
                    fontSize: "10px",
                    color: itemType === "found" ? "#34d399" : "var(--fg-faint)",
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

            {imagePreview ? (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "200px",
                  borderRadius: "14px",
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                  background: "#000",
                }}
              >
                <img
                  src={imagePreview}
                  alt="Preview"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setImagePreview(null);
                    setSelectedFile(null);
                  }}
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    background: "rgba(0, 0, 0, 0.6)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "50%",
                    width: "32px",
                    height: "32px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <X size={16} />
                </button>
              </div>
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
                    ถ่ายรูปสิ่งของให้ชัดเจน หรือไฟล์สูงสุด 5MB
                  </span>
                </div>
                <input
                  type="file"
                  accept="image/*"
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
                <span style={{ color: "#f87171" }}>*</span>
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
                ชื่อสิ่งของ <span style={{ color: "#f87171" }}>*</span>
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
                สถานที่ / ตึกเรียน <span style={{ color: "#f87171" }}>*</span>
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
                    "linear-gradient(135deg, #0f2a1f, #12301f)",
                  padding: "14px",
                  borderRadius: "14px",
                  border: "1px solid #1f4a35",
                }}
              >
                <label
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#6ee7b7",
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
                        "linear-gradient(135deg, #34d399, #10b981)",
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
                  <span style={{ color: "#f87171" }}>*</span>
                </label>
                <select
                  required={itemType === "found"}
                  value={depositLocation}
                  onChange={(e) => setDepositLocation(e.target.value)}
                  style={{
                    border: "1px solid #1f4a35",
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
                    background: "#2a1a10",
                    border: "1px solid #4a3418",
                    fontSize: "12.5px",
                    lineHeight: 1.55,
                    color: "#fbbf24",
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
                {isSubmitting ? "กำลังบันทึกข้อมูล..." : "ส่งข้อมูล"}
              </span>
            </button>
          </div>
        </form>
      </div>

      <ToastContainer />

      {showFoundHint && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(6, 20, 14, 0.4)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: "16px",
          }}
          onClick={() => setShowFoundHint(false)}
        >
          <div
            style={{
              background: "var(--card-bg, #1a1410)",
              border: "1px solid #1f4a35",
              borderRadius: "18px",
              padding: "20px",
              width: "100%",
              maxWidth: "380px",
              boxShadow: "0 24px 60px rgba(0,0,0,.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "12px",
                background: "#0f2a1f",
                border: "1px solid #1f4a35",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "12px",
                color: "#34d399",
              }}
            >
              <Box size={22} />
            </div>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 800,
                color: "var(--fg-strong, #fff)",
                marginBottom: "6px",
              }}
            >
              แจ้งพบของ — เริ่มจากไม่ยาก มี 3 ขั้น
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                margin: "12px 0 14px",
              }}
            >
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#0f2a1f",
                    border: "1px solid #1f4a35",
                    color: "#34d399",
                    fontSize: "12px",
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  1
                </div>
                <div style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--fg-secondary, #aaa)" }}>
                  เลือก<span style={{ fontWeight: 800, color: "#34d399" }}>จุดรับฝาก</span>ในฟอร์ม
                  (ป้อมยาม / กองกิจการนิสิต)
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#0f2a1f",
                    border: "1px solid #1f4a35",
                    color: "#34d399",
                    fontSize: "12px",
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  2
                </div>
                <div style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--fg-secondary, #aaa)" }}>
                  นำของที่พบไปฝากที่จุดนั้น + แจ้งเจ้าหน้าที่ว่ามีของฝากจากระบบ
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#0f2a1f",
                    border: "1px solid #1f4a35",
                    color: "#34d399",
                    fontSize: "12px",
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  3
                </div>
                <div style={{ fontSize: "13px", lineHeight: 1.5, color: "var(--fg-secondary, #aaa)" }}>
                  แอดมิน<span style={{ fontWeight: 800, color: "#34d399" }}>ตรวจรับของ</span>
                  แล้วจึงอนุมัติให้โพสต์ขึ้นระบบ
                </div>
              </div>
            </div>
            <div
              style={{
                padding: "10px 12px",
                borderRadius: "10px",
                background: "#1c1626",
                border: "1px solid #3a2f52",
                fontSize: "12px",
                lineHeight: 1.5,
                color: "#a78bfa",
                marginBottom: "16px",
              }}
            >
              ของหายโพสต์ขึ้นทันที /{" "}
              <span style={{ fontWeight: 800 }}>ของพบต้องผ่านแอดมินตรวจรับของก่อน</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFoundHint(false)}
              style={{
                width: "100%",
                padding: "11px 0",
                borderRadius: "12px",
                background: "var(--accent, #f59e0b)",
                border: "none",
                color: "#1a1a1a",
                fontSize: "13px",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              รับทราบ เข้าใจแล้ว
            </button>
          </div>
        </div>
      )}

      {showDropoffConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(82, 31, 31, 0.28)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            padding: "16px",
          }}
          onClick={() => setShowDropoffConfirm(false)}
        >
          <div
            style={{
              background: "var(--card-bg, #1a1410)",
              border: "1px solid #4a3418",
              borderRadius: "18px",
              padding: "20px",
              width: "100%",
              maxWidth: "380px",
              boxShadow: "0 24px 60px rgba(0,0,0,.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "12px",
                background: "#2a1a10",
                border: "1px solid #4a3418",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: "12px",
                color: "#fbbf24",
              }}
            >
              <Box size={22} />
            </div>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 800,
                color: "var(--fg-strong, #fff)",
                marginBottom: "6px",
              }}
            >
              นำของที่พบไปฝากที่จุดรับฝาก
            </div>
            <div
              style={{
                fontSize: "13px",
                lineHeight: 1.6,
                color: "var(--fg-secondary, #aaa)",
                marginBottom: "4px",
              }}
            >
              โพสต์ของคุณจะยังไม่ถูกเผยแพร่จนกว่าแอดมินจะตรวจรับของ
              กรุณานำของไปฝากที่จุดรับฝากที่คุณเลือกไว้:
            </div>
            <div
              style={{
                margin: "10px 0",
                padding: "10px 12px",
                borderRadius: "10px",
                background: "#2a1a10",
                border: "1px solid #4a3418",
                color: "#fbbf24",
                fontSize: "13px",
                fontWeight: 800,
              }}
            >
              {depositLocation || "จุดที่เลือกไว้"}
            </div>
            <div
              style={{
                fontSize: "12px",
                lineHeight: 1.5,
                color: "var(--fg-faint, #777)",
                marginBottom: "16px",
              }}
            >
              แจ้งเจ้าหน้าที่ ณ จุดรับฝากว่ามีของฝากจากระบบ Lost &amp; Found
              (แสดงชื่อผู้ฝากและข้อมูลที่กรอกได้เลย)
              หากไม่นำของไปฝากภายในเวลาที่กำหนด โพสต์จะถูกปฏิเสธ
            </div>
            <div
              style={{
                display: "flex",
                gap: "10px",
              }}
            >
              <button
                type="button"
                onClick={() => setShowDropoffConfirm(false)}
                style={{
                  flex: 1,
                  padding: "11px 0",
                  borderRadius: "12px",
                  background: "transparent",
                  border: "1px solid #3a3a3a",
                  color: "var(--fg-secondary, #aaa)",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={confirmDropoffAndSubmit}
                style={{
                  flex: 1,
                  padding: "11px 0",
                  borderRadius: "12px",
                  background: "var(--accent, #f59e0b)",
                  border: "none",
                  color: "#1a1a1a",
                  fontSize: "13px",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                ยืนยันโอเค ฉันจะนำของไปฝาก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}