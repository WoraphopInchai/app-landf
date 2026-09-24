import { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  MapPin,
  Clock,
  Sparkles,
  Building2,
  ChevronDown,
  Package,
  ShieldAlert,
  Flag,
  X,
  SearchX,
  UserCircle,
  CheckCircle2,
  Plus,
  ArrowRight,
  BarChart3,
  Send,
  RefreshCw,
} from "lucide-react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import type { PostItem, AppUser, FirestoreTimeLike } from "../types";
import {
  MATCH_MIN_SCORE,
  NEAR_MATCH_MIN_SCORE,
  NEAR_MATCH_MAX_SCORE,
  confirmAiPair,
  runForceRescan,
  triggerBackgroundSweep,
  type AiMatchRecord,
} from "../lib/aiMatch";
import { ITEM_CATEGORIES } from "../constants";
import { refreshLoginStats } from "../lib/loginStats";
import { isCurrentUserBanned } from "../lib/userGuard";
import ToastContainer from "../components/Toast";
import { showToast } from "../lib/toast";

interface HomeProps {
  user?: AppUser;
  onNavigateToReport?: () => void;
  onOpenProfile?: () => void;
  onSelectPost?: (post: PostItem) => void;
  // Guest mode: ยังไม่ล็อกอิน กดฟีเจอร์ที่ต้องใช้บัญชี → เปิดหน้าเข้าสู่ระบบ
  onRequireLogin?: (afterLogin?: () => void) => void;
}

// รายชื่อคณะ วิทยาลัย อาคารเรียน และพื้นที่ทั้งหมดในมหาวิทยาลัยพะเยา (UP)
const BUILDINGS = [
  // --- กลุ่มคณะ และ วิทยาลัย ---
  "คณะเทคโนโลยีสารสนเทศและการสื่อสาร (ICT)",
  "คณะวิทยาศาสตร์",
  "คณะวิศวกรรมศาสตร์",
  "คณะเกษตรศาสตร์และทรัพยากรธรรมชาติ",
  "คณะสถาปัตยกรรมศาสตร์และศิลปกรรมศาสตร์",
  "คณะบริหารธุรกิจและนิเทศศาสตร์ (BCA)",
  "คณะศิลปศาสตร์",
  "คณะนิติศาสตร์",
  "คณะรัฐศาสตร์และสังคมศาสตร์",
  "คณะแพทยศาสตร์",
  "คณะพยาบาลศาสตร์",
  "คณะเภสัชศาสตร์",
  "คณะทันตแพทยศาสตร์",
  "คณะสหเวชศาสตร์",
  "คณะสาธารณสุขศาสตร์",
  "วิทยาลัยการศึกษา",

  // --- กลุ่มอาคารเรียน และ ปฏิบัติการ ---
  "อาคารเรียนรวม 1 (ภ.ป.ร.)",
  "อาคารเรียนรวม 2",
  "อาคารเรียนรวม CE",
  "ศูนย์ปฏิบัติการวิทยาศาสตร์และเทคโนโลยี (Sci Lab)",
  "อาคารปฏิบัติการวิศวกรรมศาสตร์",
  "อาคารปฏิบัติการเทคโนโลยีสารสนเทศ",

  // --- กลุ่มอาคารบริหาร และ บริการส่วนกลาง ---
  "อาคารสำนักงานอธิการบดี",
  "อาคารหอประชุมพญางำเมือง",
  "ศูนย์บรรณสารและสื่อการศึกษา (หอสมุดกลาง)",
  "โรงพยาบาลมหาวิทยาลัยพะเยา",
  "อาคารสถาบันนวัตกรรมและถ่ายทอดเทคโนโลยี (UPIT)",
  "อาคารนวัตกรรมภูมิปัญญา",

  // --- กลุ่มสิ่งอำนวยความสะดวก / หอพัก / สปอร์ตคลับ ---
  "โรงอาหารกลาง (โรงช้าง)",
  "โรงอาหาร ICT",
  "โรงอาหารคณะสงวนเสริมศรี",
  "หอพักนิสิตมหาวิทยาลัยพะเยา (UP DORM / หอใน)",
  "กลุ่มอาคารหอพักสงวนเสริมศรี (เวียงต่างๆ)",
  "สนามกีฬา 30 ปี มหาวิทยาลัยพะเยา",
  "อาคารศูนย์กีฬา / สระว่ายน้ำ",
  "ลานสมเด็จพระนเรศวรมหาราช",
  "ป้ายหน้ามหาวิทยาลัยพะเยา / ประตูทางเข้า",
];

// แปลงเวลาจาก Firestore/Date เป็น millisecond timestamp
const resolveTime = (t?: FirestoreTimeLike): number => {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t !== "object") return new Date(t).getTime();
  if (typeof t.toDate === "function") return t.toDate().getTime();
  return 0;
};

// จับ timestamp ปัจจุบัน — แยกเป็น helper เพราะ eslint/react-hooks ห้ามใช้ Date.now ระหว่าง render
const nowMillis = (): number => Date.now();

// แสดงเวลาผ่านแบบย่อ (เมื่อกี้ / X นาที / X ชม. / X วัน)
const timeAgo = (t?: FirestoreTimeLike): string => {
  const time = resolveTime(t);
  if (!time) return "เมื่อสักครู่";
  const diff = Math.max(0, Date.now() - time);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "เมื่อสักครู่";
  if (mins < 60) return `เมื่อ ${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `เมื่อ ${hours} ชม.ที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `เมื่อ ${days} วันที่แล้ว`;
};

export default function Home({
  user,
  onNavigateToReport,
  onSelectPost,
  onRequireLogin,
}: HomeProps) {
  const [posts, setPosts] = useState<PostItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState<
    "all" | "lost" | "found" | "resolved"
  >("all");
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Pagination ฟีด: แต่ละหน้าแสดงโพสต์จำนวนจำกัด (เปลี่ยนหน้าแบบชุดใหม่เรื่อย ๆ)
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);

  // State สำหรับควบคุมการเปิด-ปิด Modal เลือกตึก
  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  const [buildingSearchText, setBuildingSearchText] = useState("");

  // State สำหรับควบคุมการเปิด-ปิด Modal เลือกหมวดหมู่
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);

  // State สำหรับ Modal รายงานโพสต์
  const [reportPostData, setReportPostData] = useState<PostItem | null>(null);
  const [reportCategory, setReportCategory] = useState("เนื้อหาไม่เหมาะสม");
  const [reportDetail, setReportDetail] = useState("");
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);

  const REPORT_CATEGORIES = [
    "เนื้อหาไม่เหมาะสม",
    "ข้อมูลเท็จ / หลอกลวง",
    "สแปม / ซ้ำซ้อน",
    "โพสต์ที่ไม่เกี่ยวข้อง",
    "อื่นๆ",
  ];

  const handleReportPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportPostData?.id || !auth.currentUser?.uid) {
      onRequireLogin?.();
      return;
    }
    if (await isCurrentUserBanned()) {
      showToast("บัญชีของคุณถูกระงับการใช้งาน ไม่สามารถส่งรายงานได้", "error");
      return;
    }
    setIsSubmittingReport(true);
    try {
      await addDoc(collection(db, "reports"), {
        type: "post_report",
        postId: reportPostData.id,
        postTitle: reportPostData.title,
        postType: reportPostData.itemType || "unknown",
        reporterId: auth.currentUser.uid,
        reporterName: auth.currentUser.displayName || "ผู้ใช้ทั่วไป",
        category: reportCategory,
        detail: reportDetail.trim(),
        status: "open",
        createdAt: serverTimestamp(),
      });
      addDoc(collection(db, "notifications"), {
        type: "post_report",
        recipientRole: "admin",
        pointName: reportPostData.depositLocation || "",
        postId: reportPostData.id,
        postTitle: reportPostData.title,
        reporterId: auth.currentUser?.uid || "",
        reporterName: auth.currentUser.displayName || "ผู้ใช้ทั่วไป",
        category: reportCategory,
        detail: reportDetail.trim(),
        read: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
      showToast("ส่งรายงานเรียบร้อยแล้ว ขอบคุณที่ช่วยตรวจสอบ");
      setReportPostData(null);
      setReportDetail("");
      setReportCategory("เนื้อหาไม่เหมาะสม");
    } catch (error) {
      console.error("Error submitting report:", error);
      showToast("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง", "error");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // กวาดคู่แนะนำ/จัดการ claims หมดอายุ แบบเงียบ ๆ ตอนเปิดแอป (ล็อกอินแล้ว)
  useEffect(() => {
    if (user) {
      triggerBackgroundSweep();
    }
  }, [user]);

  // ดึงข้อมูลโพสต์แบบ Realtime (onSnapshot)
  useEffect(() => {
    const postsQuery = query(
      collection(db, "posts"),
      where("status", "in", ["active", "in_progress", "resolved", "under_investigation"]),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      postsQuery,
      (snapshot) => {
        const now = Date.now();
        const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

        const fetchedPosts: PostItem[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            itemType: data.itemType || "lost",
            category: data.category || "อื่นๆ",
            title: data.title || "ไม่ระบุชื่อ",
            faculty: data.faculty || "",
            building: data.building || "",
            locationName: data.locationName || data.building || "ไม่ระบุสถานที่",
            date: data.date || "",
            depositLocation: data.depositLocation || "",
            securityZone: data.securityZone || "",
            desc: data.desc || "",
            imageUrl: data.imageUrl || null,
            status: data.status || "active",
            createdAt: data.createdAt,
            resolvedAt: data.resolvedAt,
            userId: data.userId || "",
            reporterName: data.reporterName || "ผู้ใช้งานทั่วไป",
            matches: data.matches || [],
            aiData: data.aiData || null,
          } as PostItem;
        });

        // กรองเฉพาะ status ที่อนุญาต และรายการ resolved เกิน 7 วันให้หายไป
        const allowedStatuses = ["active", "in_progress", "resolved", "under_investigation"];
        const validPosts = fetchedPosts.filter((post) => {
          const itemStatus = post.status || "active";
          if (!allowedStatuses.includes(itemStatus)) return false;

          if (itemStatus === "resolved" && post.resolvedAt) {
            const resolvedTime = resolveTime(post.resolvedAt);

            if (!isNaN(resolvedTime) && now - resolvedTime > SEVEN_DAYS_MS) {
              return false;
            }
          }
          return true;
        });
        fetchedPosts.splice(0, fetchedPosts.length, ...validPosts);

        setPosts(fetchedPosts);
        setLoading(false);
      },
      (error) => {
        console.error("Error fetching posts realtime: ", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // =========================
  // Auto AI Match Rescan ถูกย้ายไปฝั่ง Cloud Function แล้ว (server สแกน/เก็บโควตา)
  // เหลือเพียง UX "รีแมทใหม่" ที่เรียก forceRescan ผ่าน Cloud Function
  // =========================
  const [refreshing, setRefreshing] = useState(false);
  const [scanDone, setScanDone] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);

  // ---- "รีแมทใหม่" UX: จับ diff ระหว่างผลก่อน/หลังรีเฟรช เพื่อให้รู้สึกว่าแมทใหม่จริง ----
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [matchDiff, setMatchDiff] = useState<{
    added: number;
    changed: number;
    gone: number;
  } | null>(null);
  const [highlightKeys, setHighlightKeys] = useState<Set<string>>(new Set());
  const prevAiRowsRef = useRef<Map<string, number>>(new Map());
  const aiRowsForTabRef = useRef<
    Array<{ myPost: PostItem; other: PostItem; score: number; reason: string }>
  >([]);
  const diffPendingRef = useRef(false);
  const matchDiffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diffRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (matchDiffTimer.current) clearTimeout(matchDiffTimer.current);
      if (diffRetryTimer.current) clearTimeout(diffRetryTimer.current);
    };
  }, []);

  // โพสต์ของพบของเราเองที่ยังรออนุมัติ (ให้แมทได้ทันทีตอน pending)
  // ใช้ query แค่ field เดียว (userId) + กรองฝั่ง client -> ไม่ต้องสร้าง composite index
  const [pendingFoundPosts, setPendingFoundPosts] = useState<PostItem[]>([]);

  useEffect(() => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const q = query(collection(db, "posts"), where("userId", "==", uid));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            itemType: data.itemType || "lost",
            category: data.category || "อื่นๆ",
            title: data.title || "ไม่ระบุชื่อ",
            faculty: data.faculty || "",
            building: data.building || "",
            locationName: data.locationName || data.building || "ไม่ระบุสถานที่",
            date: data.date || "",
            depositLocation: data.depositLocation || "",
            securityZone: data.securityZone || "",
            desc: data.desc || "",
            imageUrl: data.imageUrl || null,
            status: data.status || "active",
            createdAt: data.createdAt,
            resolvedAt: data.resolvedAt,
            userId: data.userId || uid,
            reporterName: data.reporterName || "ผู้ใช้งานทั่วไป",
            matches: data.matches || [],
            aiData: data.aiData || null,
          } as PostItem;
        });
        setPendingFoundPosts(
          rows.filter(
            (p) => p.itemType === "found" && p.status === "pending"
          )
        );
      },
      (error) =>
        console.error("Error fetching own posts (pending found):", error)
    );
    return () => unsubscribe();
  }, []);

  // =========================
  // อัปเดตสถิติสาธารณะ (stats/login) เมื่อข้อมูลโพสต์เปลี่ยน
  // เพื่อให้หน้า Login แสดงตัวเลขจริงล่าสุด (debounce 3 วินาที)
  // =========================
  useEffect(() => {
    if (!auth.currentUser) return;
    if (!posts || posts.length === 0) return;

    const timer = setTimeout(() => {
      refreshLoginStats();
    }, 3000);

    return () => clearTimeout(timer);
  }, [posts]);

  // =========================
  // ข้อมูลจริงสำหรับการ์ด "ภาพรวมวันนี้" (แทน demo ที่เขียนตายตัว)
  // =========================
  const heroData = useMemo(() => {
    const lostCount = posts.filter(
      (p) => p.itemType === "lost" && p.status === "active"
    ).length;
    const foundCount = posts.filter(
      (p) => p.itemType === "found" && p.status === "active"
    ).length;
    const resolvedCount = posts.filter((p) => p.status === "resolved").length;

    // จำนวนโพสต์ใหม่ย้อนหลัง 7 วัน (วันนี้ + 6 วันก่อน)
    const dayStart = (offset: number) => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - offset);
      return d.getTime();
    };
    const activity = Array.from({ length: 7 }, (_, i) => {
      const start = dayStart(i);
      const end = dayStart(i - 1);
      return posts.filter((p) => {
        const t = resolveTime(p.createdAt);
        return t >= start && t < end;
      }).length;
    });
    const maxActivity = Math.max(...activity, 1);

    const sorted = [...posts].sort(
      (a, b) => resolveTime(b.createdAt) - resolveTime(a.createdAt)
    );
    const recentLost =
      sorted.find((p) => p.itemType === "lost" && p.status === "active") ||
      null;
    const recentFound =
      sorted.find((p) => p.itemType === "found" && p.status === "active") ||
      null;

    let aiTop = 0;
    let aiPairs = 0;
    posts.forEach((p) => {
      if (p.matches && p.matches.length > 0) {
        aiPairs += p.matches.length;
        if (p.matches[0].similarityScore > aiTop) {
          aiTop = p.matches[0].similarityScore;
        }
      }
    });

    return {
      lostCount,
      foundCount,
      resolvedCount,
      activity,
      maxActivity,
      recentLost,
      recentFound,
      aiTop,
      aiPairs,
    };
  }, [posts]);

  // กรองโพสต์ตาม Search / ประเภท / อาคาร-คณะ
  const filteredPosts = posts.filter((post) => {
    // 1. กรองตามประเภทแท็บ (all, lost, found, resolved)
    let matchType: boolean;
    if (filterType === "all") {
      matchType = true;
    } else if (filterType === "resolved") {
      matchType =
        post.status === "resolved";
    } else {
      matchType =
        post.itemType === filterType &&
        post.status !== "resolved" &&
        post.status !== "under_investigation";
    }

    const queryLower = searchTerm.toLowerCase().trim();

    // รวมฟิลด์สถานที่ทั้งหมดเข้าด้วยกันเพื่อรองรับการค้นหาที่ยืดหยุ่น
    const locationString =
      `${post.faculty || ""} ${post.building || ""} ${post.locationName || ""}`.toLowerCase();

    // 2. กรองตามคำค้นหา (Search)
    const matchesSearch =
      !queryLower ||
      post.title.toLowerCase().includes(queryLower) ||
      locationString.includes(queryLower) ||
      (post.desc && post.desc.toLowerCase().includes(queryLower)) ||
      (post.category && post.category.toLowerCase().includes(queryLower));

    // 3. กรองตามอาคารหรือคณะที่เลือก
    let matchBuilding = true;
    if (selectedBuilding) {
      const sel = selectedBuilding.toLowerCase();
      matchBuilding = [post.faculty, post.building, post.locationName]
        .filter((x): x is string => Boolean(x))
        .some((loc) => loc.toLowerCase().includes(sel));
    }

    // 4. กรองตามหมวดหมู่สิ่งของ
    let matchCategory = true;
    if (selectedCategory && selectedCategory !== "all") {
      const catLower = (post.category || "อื่นๆ").toLowerCase();
      const selLower = selectedCategory.toLowerCase();
      matchCategory =
        catLower === selLower ||
        catLower.includes(selLower) ||
        selLower.includes(catLower);
    }

    return matchType && matchesSearch && matchBuilding && matchCategory;
  });

  // ---- Pagination: แบ่งหน้าตาม filteredPosts (ข้อมูลยัง realtime เดิม) ----
  const pageCount = Math.max(1, Math.ceil(filteredPosts.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagePosts = filteredPosts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // หน้าต่างเลขหน้า (ย่อด้วย "…" เมื่อหลายหน้า) + ปุ่มไปหน้าที่เลือก
  const pageItems: (number | "…")[] = (() => {
    const items: (number | "…")[] = [];
    const total = pageCount;
    const cur = currentPage;
    if (total <= 7) {
      for (let i = 1; i <= total; i++) items.push(i);
      return items;
    }
    items.push(1);
    if (cur - 2 > 2) items.push("…");
    for (let i = Math.max(2, cur - 2); i <= Math.min(total - 1, cur + 2); i++) items.push(i);
    if (cur + 2 < total - 1) items.push("…");
    items.push(total);
    return items;
  })();

  const goPage = (n: number) => {
    setPage(Math.min(Math.max(1, n), pageCount));
    document.getElementById("home-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pageBtnStyle = (active: boolean) => ({
    minWidth: 34,
    height: 34,
    padding: "0 10px",
    borderRadius: 10,
    border: active ? "none" : "1px solid var(--border)",
    backgroundColor: active ? "#7c5cfc" : "var(--bg-card)",
    color: active ? "var(--fg)" : "var(--fg-secondary)",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    boxShadow: active ? "0 2px 10px rgba(124,92,252,0.35)" : "none",
    transition: "all 0.15s ease",
  } as const);

  // กรองรายชื่อตึก/คณะ ใน Modal ค้นหา
  const filteredBuildings = BUILDINGS.filter((b) =>
    b.toLowerCase().includes(buildingSearchText.toLowerCase())
  );

  // จำนวนรายการตามแต่ละหมวด (สำหรับ badge บนแท็บ)
  const countStatus = (target: "all" | "lost" | "found" | "resolved") => {
    if (target === "all") return posts.length;
    if (target === "resolved")
      return posts.filter((p) => p.status === "resolved").length;
    return posts.filter(
      (p) =>
        p.itemType === target &&
        p.status !== "resolved" &&
        p.status !== "under_investigation"
    ).length;
  };

  // config ของแท็บกรอง (Vercel segmented style)
  const tabs: { key: "all" | "lost" | "found" | "resolved"; label: string }[] = [
    { key: "all", label: "ทั้งหมด" },
    { key: "lost", label: "ของหาย" },
    { key: "found", label: "ของพบ" },
    { key: "resolved", label: "คืนแล้ว" },
  ];

  const formatDate = (dateVal?: FirestoreTimeLike) => {
    if (!dateVal) return "";
    const t = resolveTime(dateVal);
    if (!t) return String(dateVal);
    const d = new Date(t);
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  };

  // เวลาโพสต์ (HH:mm) — โชว์เฉพาะเวลา เนื่องจากวันที่ทำหาย/พบโชว์แยกอยู่แล้ว
  const formatPostTime = (ts?: FirestoreTimeLike) => {
    const t = resolveTime(ts);
    if (!t) return "";
    const d = new Date(t);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
  };

  const getDaysLeft = (resolvedAt?: FirestoreTimeLike) => {
    if (!resolvedAt) return 7;
    const resolvedTime = resolveTime(resolvedAt);
    if (isNaN(resolvedTime)) return 7;

    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const diff = SEVEN_DAYS_MS - (now - resolvedTime);
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days > 0 ? days : 0;
  };

  // Badge สถานะ (เขียว=FOUND, ส้ม=LOST, เทา=คืนแล้ว, แดง=ตรวจสอบ)
  const statusBadge = (post: PostItem) => {
    const isResolved = post.status === "resolved";
    const isInvestigating = post.status === "under_investigation";
    const isInProgress = post.status === "in_progress";
    const isLost = post.itemType === "lost";

    const style: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 9px",
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 700,
      border: "1px solid transparent",
    };

    if (isResolved)
      return (
        <span style={{ ...style, background: "#1c1a24", color: "var(--fg-secondary)", borderColor: "var(--border)" }}>
          <CheckCircle2 size={11} color="#34d399" />
          คืนแล้ว ({getDaysLeft(post.resolvedAt)} วัน)
        </span>
      );
    if (isInvestigating)
      return (
        <span style={{ ...style, background: "#2a1418", color: "#f87171", borderColor: "#4a1f28" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171" }} />
          ตรวจสอบ
        </span>
      );
    if (isInProgress)
      return (
        <span style={{ ...style, background: "#172036", color: "#60a5fa", borderColor: "#2a3a5c" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#60a5fa" }} />
          กำลังดำเนินการ
        </span>
      );
    return (
      <span
        style={{
          ...style,
          background: isLost ? "#2a1a10" : "#0f2a1f",
          color: isLost ? "#fb923c" : "#34d399",
          borderColor: isLost ? "#4a3418" : "#1f4a35",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: isLost ? "#fb923c" : "#34d399",
          }}
        />
        {isLost ? "ของหาย (LOST)" : "ของพบ (FOUND)"}
      </span>
    );
  };

  // =========================
  // AI แนะนำ บนฟีด — จับคู่โพสต์ของเรา ↔ โพสต์ฝั่งตรงข้ามจากข้อมูล matches
  // =========================
  const uidForAi = auth.currentUser?.uid;

  const myActivePosts = uidForAi
    ? posts.filter(
        (p) =>
          p.userId === uidForAi && (p.status || "active") === "active"
      )
    : [];
  // รวมโพสต์ของพบของเราที่ยังรออนุมัติเข้าไปด้วย -> แมทได้ทันทีตอน pending
  const myPendingFound = uidForAi
    ? pendingFoundPosts.filter((p) => p.userId === uidForAi)
    : [];
  const myOwnPosts = [...myActivePosts, ...myPendingFound];
  const myOwnPostIds = new Set(myOwnPosts.map((p) => p.id));

  const aiPairs = new Map<
    string,
    {
      myPost: PostItem;
      other: PostItem;
      score: number;
      reason: string;
      confirmed: boolean;
    }
  >();
  const pushAiPair = (
    myPost: PostItem,
    other: PostItem,
    m: AiMatchRecord
  ) => {
    if (!myPost || !other || myPost.id === other.id) return;
    if (typeof myPost.id === "undefined" || typeof other.id === "undefined") return;
    if (m.rejected) return;
    const key = `${myPost.id}|${other.id}`;
    const existing = aiPairs.get(key);
    if (!existing || m.similarityScore > existing.score) {
      aiPairs.set(key, {
        myPost,
        other,
        score: m.similarityScore,
        reason: m.reason || "",
        confirmed: !!m.confirmed,
      });
    }
  };

  if (uidForAi) {
    // ทางที่ 1: โพสต์คนอื่นมี matches ชี้มาที่โพสต์ของเรา (mirror)
    for (const other of posts) {
      if (other.userId === uidForAi) continue;
      const ms = other.matches || [];
      for (const m of ms) {
        // กรองแมทคลุมเครือ (<60) ไม่ให้เข้าฟีด
        if (m.similarityScore < MATCH_MIN_SCORE) continue;
        if (myOwnPostIds.has(m.matchedPostId)) {
          const myPost = myOwnPosts.find((p) => p.id === m.matchedPostId);
          if (myPost) pushAiPair(myPost, other, m);
        }
      }
    }

    // ทางที่ 2: โพสต์ของเรามี matches ชี้ไปที่โพสต์คนอื่น
    for (const myPost of myOwnPosts) {
      const ms = myPost.matches || [];
      for (const m of ms) {
        if (m.similarityScore < MATCH_MIN_SCORE) continue;
        const other = posts.find((p) => p.id === m.matchedPostId);
        if (other && other.userId !== uidForAi) {
          pushAiPair(myPost, other, m);
        }
      }
    }
  }

  // ระดับ "ใกล้เคียง" (45-59) — ยังไม่ยืนยันว่าเป็นของเดียวกัน แสดงแยกโซน (ไม่นับเป็นแมทจริง)
  const aiNearPairs = new Map<
    string,
    {
      myPost: PostItem;
      other: PostItem;
      score: number;
      reason: string;
      confirmed: boolean;
    }
  >();
  const pushAiNearPair = (
    myPost: PostItem,
    other: PostItem,
    m: AiMatchRecord
  ) => {
    if (!myPost || !other || myPost.id === other.id) return;
    if (typeof myPost.id === "undefined" || typeof other.id === "undefined") return;
    if (m.rejected) return;
    if (m.similarityScore < NEAR_MATCH_MIN_SCORE || m.similarityScore > NEAR_MATCH_MAX_SCORE) return;
    // คู่ที่แมทจริงแล้ว (≥60) ไม่ต้องโชว์ซ้ำในโซน "ใกล้เคียง"
    if (aiPairs.has(`${myPost.id}|${other.id}`)) return;
    const key = `${myPost.id}|${other.id}`;
    const existing = aiNearPairs.get(key);
    if (!existing || m.similarityScore > existing.score) {
      aiNearPairs.set(key, {
        myPost,
        other,
        score: m.similarityScore,
        reason: m.reason || "",
        confirmed: !!m.confirmed,
      });
    }
  };

  if (uidForAi) {
    // ทางที่ 1: โพสต์คนอื่นมี nearMatches ชี้มาที่โพสต์ของเรา
    for (const other of posts) {
      if (other.userId === uidForAi) continue;
      const near = other.nearMatches || [];
      for (const m of near) {
        if (myOwnPostIds.has(m.matchedPostId)) {
          const myPost = myOwnPosts.find((p) => p.id === m.matchedPostId);
          if (myPost) {
            pushAiNearPair(myPost, other, m);
          }
        }
      }
    }

    // ทางที่ 2: โพสต์ของเรามี nearMatches ชี้ไปที่โพสต์คนอื่น
    for (const myPost of myOwnPosts) {
      const near = myPost.nearMatches || [];
      for (const m of near) {
        const other = posts.find((p) => p.id === m.matchedPostId);
        if (other && other.userId !== uidForAi) {
          pushAiNearPair(myPost, other, m);
        }
      }
    }
  }

  const aiMatchRows = Array.from(aiPairs.values()).sort(
    (a, b) => b.score - a.score
  );
  const aiRowsForTab =
    filterType === "lost"
      ? aiMatchRows.filter((r) => r.myPost.itemType === "lost")
      : filterType === "found"
        ? aiMatchRows.filter((r) => r.myPost.itemType === "found")
        : aiMatchRows;

  // แถวระดับ "ใกล้เคียง" (45-59) — แสดงแยกโซนสีเหลืองอำพัน
  const aiNearRows = Array.from(aiNearPairs.values()).sort(
    (a, b) => b.score - a.score
  );
  const aiNearRowsForTab =
    filterType === "lost"
      ? aiNearRows.filter((r) => r.myPost.itemType === "lost")
      : filterType === "found"
        ? aiNearRows.filter((r) => r.myPost.itemType === "found")
        : aiNearRows;

  // แยก "แมทจริง" (confirmed) ออกจาก "คู่ที่ AI แนะนำ" (ยังไม่ยืนยัน)
  const aiConfirmedRowsForTab = aiRowsForTab.filter((r) => r.confirmed);
  const aiSuggestedRowsForTab = aiRowsForTab.filter((r) => !r.confirmed);

  // อัปเดตผลล่าสุดให้ ref (หลัง render) เพื่อใช้เทียบ diff ตอนรีแมทเสร็จ
  useEffect(() => {
    aiRowsForTabRef.current = aiRowsForTab;
  });

  const showAiSection =
    !!uidForAi && filterType !== "resolved" && aiRowsForTab.length > 0;
  const showAiEmpty =
    !!uidForAi &&
    filterType !== "resolved" &&
    aiRowsForTab.length === 0 &&
    myOwnPosts.length > 0;
  const showAiNearSection =
    !!uidForAi && filterType !== "resolved" && aiNearRowsForTab.length > 0;
  const showAiConfirmedSection = aiConfirmedRowsForTab.length > 0;
  const showAiSuggestedSection = aiSuggestedRowsForTab.length > 0;

  // เสนอคู่โดย AI -> รอการยืนยันจากเจ้าของ (ใช่ของฉัน / ไม่ใช่ของฉัน)
  // ยืนยันแล้วเท่านั้น = แมทจริง (เขียว); ปฏิเสธ -> ตัดออกจากฟีด
  const [busyConfirmKey, setBusyConfirmKey] = useState<string | null>(null);
  const handleConfirmDecision = async (
    myPostId: string,
    otherPostId: string,
    action: "confirm" | "reject"
  ) => {
    const key = `${myPostId}|${otherPostId}`;
    if (busyConfirmKey) return;
    setBusyConfirmKey(key);
    try {
      await confirmAiPair(myPostId, otherPostId, action);
      showToast(
        action === "confirm"
          ? "ยืนยันสำเร็จ — คู่นี้ถือเป็นแมทจริงแล้ว"
          : "บันทึกแล้ว — ระบบจะไม่แนะนำคู่นี้ซ้ำ",
        action === "confirm" ? "success" : "info"
      );
    } catch (err) {
      console.error("confirmAiPair error:", err);
      const msg =
        err instanceof Error && err.message ? err.message.slice(0, 140) : "";
      showToast(`ยืนยันไม่สำเร็จ: ${msg}`, "error");
    } finally {
      setBusyConfirmKey(null);
    }
  };

  const forceRefreshAi = async () => {
    if (refreshing) return;
    const candidates = myOwnPosts.filter((p) => p.id);
    setScanTotal(candidates.length);
    setScanDone(0);
    setRefreshing(true);

    // จับภาพผลก่อนรีเฟรช เพื่อเอามาเทียบ diff หลังสแกนเสร็จ (รู้สึกว่าแมทใหม่จริงจัง)
    const prevSnapshot = new Map<string, number>();
    for (const row of aiRowsForTabRef.current) {
      prevSnapshot.set(`${row.myPost.id}|${row.other.id}`, row.score);
    }
    prevAiRowsRef.current = prevSnapshot;

    try {
      const { postsDone, totalMatches } = await runForceRescan();
      setScanDone(postsDone);
      setLastRefreshAt(nowMillis());
      if (postsDone > 0) triggerMatchDiff();
      if (totalMatches > 0) {
        showToast(
          `สแกนเสร็จ: ${postsDone} โพสต์ · พบคู่แนะนำ ${totalMatches} คู่`,
          "success"
        );
      } else {
        showToast(`สแกนเสร็จ: ${postsDone} โพสต์ · ยังไม่พบคู่ใหม่`, "info");
      }
    } catch (err) {
      console.error("Force rescan error:", err);
      const msg =
        err instanceof Error && err.message
          ? err.message.slice(0, 140)
          : "เกิดข้อผิดพลาด";
      showToast(`รีเฟรช AI Match ไม่สำเร็จ: ${msg}`, "error");
    } finally {
      setRefreshing(false);
    }
  };

  // เปรียบเทียบผลก่อน/หลังรีเฟรช แล้วไฮไลต์คู่ที่ใหม่/เปลี่ยนสกอร์
  const applyMatchDiff = (attempt: number): void => {
    const prev = prevAiRowsRef.current;
    const currentRows = aiRowsForTabRef.current;
    const nowMap = new Map<string, number>();
    for (const row of currentRows) {
      nowMap.set(`${row.myPost.id}|${row.other.id}`, row.score);
    }

    // ข้อมูลยังไม่ทันอัปเดต (ผลเหมือนเดิมอย่างไม่น่าเชื่อ) -> รอ snapshot ไล่ทันก่อน
    const identical =
      prev.size > 0 &&
      nowMap.size === prev.size &&
      Array.from(nowMap.entries()).every(([k, s]) => prev.get(k) === s);
    if (identical && attempt < 6) {
      diffRetryTimer.current = setTimeout(() => applyMatchDiff(attempt + 1), 400);
      return;
    }

    diffPendingRef.current = false;
    let added = 0;
    let changed = 0;
    const hl = new Set<string>();
    for (const [k, score] of nowMap) {
      const p = prev.get(k);
      if (p === undefined) {
        added++;
        hl.add(k);
      } else if (Math.abs(p - score) >= 2) {
        changed++;
        hl.add(k);
      }
    }
    let gone = 0;
    for (const k of prev.keys()) {
      if (!nowMap.has(k)) gone++;
    }

    setHighlightKeys(hl);
    setMatchDiff({ added, changed, gone });
    if (matchDiffTimer.current) clearTimeout(matchDiffTimer.current);
    matchDiffTimer.current = setTimeout(() => setMatchDiff(null), 7000);
  };

  const triggerMatchDiff = (): void => {
    if (diffPendingRef.current) return;
    diffPendingRef.current = true;
    applyMatchDiff(0);
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
        color: "var(--fg)",
        paddingBottom: "40px",
        scrollbarWidth: "none",
        msOverflowStyle: "none",
        position: "relative",
      }}
    >
      <style>{`
        div::-webkit-scrollbar { display: none; }
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes ghShimmer {
          0% { background-position: 100% 0; }
          100% { background-position: 0 0; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .vc-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        @media (min-width: 720px) {
          .vc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (min-width: 1024px) {
          .vc-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        .vc-skeleton {
          background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-hover) 37%, var(--bg-card) 63%);
          background-size: 400% 100%;
          animation: ghShimmer 1.4s ease infinite;
          border-radius: 8px;
        }
        .home-glow-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(50px);
          pointer-events: none;
        }
        @media (max-width: 640px) {
          .vc-home-content { padding: 0 16px !important; }
        }
      `}</style>

      {/* Ambient background glows */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div
          className="home-glow-orb"
          style={{
            width: 420,
            height: 420,
            top: -120,
            left: -80,
            background: "radial-gradient(circle, rgba(124,92,252,0.22) 0%, transparent 70%)",
            animation: "lafGlowPulse 5s ease-in-out infinite",
          }}
        />
        <div
          className="home-glow-orb"
          style={{
            width: 380,
            height: 380,
            top: 90,
            right: -100,
            background: "radial-gradient(circle, rgba(79,59,214,0.18) 0%, transparent 70%)",
            animation: "lafGlowPulse 7s ease-in-out infinite",
          }}
        />
      </div>

      <main
        className="vc-home-content"
        style={{
          maxWidth: 1080,
          margin: "0 auto",
          width: "100%",
          padding: "0 24px",
        }}
      >
        {/* ============ Hero: Split (Frame.io Style) ============ */}
        <style>{`
          @media (max-width: 860px) {
            .hero-split { grid-template-columns: 1fr !important; }
            .hero-preview { display: none; }
          }
        `}</style>
        <section
          className="hero-split"
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: "1.05fr 0.95fr",
            gap: 44,
            alignItems: "center",
            padding: "52px 0 34px",
          }}
        >
          {/* --- Left: Headline + CTA --- */}
          <div style={{ animation: "lafFadeInUp 0.4s ease-out both" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 999,
                background: "rgba(124,92,252,0.14)",
                border: "1px solid rgba(124,92,252,0.35)",
                color: "var(--fg-accent)",
                fontSize: 11.5,
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              <Sparkles size={13} />
              ระบบจับคู่ด้วย AI · มหาวิทยาลัยพะเยา
            </div>

            <h1
              style={{
                fontSize: "clamp(32px, 4.6vw, 46px)",
                fontWeight: 800,
                letterSpacing: "-0.035em",
                lineHeight: 1.12,
                margin: "18px 0 14px",
                color: "var(--fg)",
              }}
            >
              ศูนย์รวมแจ้งและ
              <br />
              <span
                style={{
                  background: "linear-gradient(90deg, var(--fg) 20%, var(--fg-accent) 60%, var(--accent) 100%)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                ตามหาของหาย
              </span>
            </h1>

            <p
              style={{
                fontSize: 14.5,
                color: "var(--fg-muted)",
                lineHeight: 1.7,
                maxWidth: 520,
                margin: 0,
              }}
            >
              {user?.name || user?.displayName
                ? `สวัสดี, ${user.name || user.displayName} — `
                : ""}
              แจ้งของหายและค้นหาสิ่งของที่พบในมหาวิทยาลัยแบบเรียลไทม์
              พร้อมระบบ AI จับคู่รายการที่มีความเป็นไปได้สูงสุด
            </p>

            {/* CTA Buttons */}
            <div style={{ display: "flex", gap: 10, marginTop: 26, flexWrap: "wrap" }}>
              <button
                onClick={onNavigateToReport}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 42,
                  padding: "0 18px",
                  borderRadius: 10,
                  border: "none",
                  background: "#7c5cfc",
                  color: "var(--accent-fg)",
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 8px 24px rgba(124, 92, 252, 0.4)",
                  transition: "background 0.13s ease, box-shadow 0.13s ease, transform 0.13s ease",
                }}
              >
                แจ้งของหายทันที
                <ArrowRight size={16} />
              </button>
              <button
                onClick={() =>
                  document
                    .getElementById("home-results")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  height: 42,
                  padding: "0 18px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--bg-card)",
                  color: "var(--fg)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "border-color 0.13s ease",
                }}
              >
                สำรวจรายการ
              </button>
            </div>

            </div>

          {/* --- Right: Dashboard Preview Card w/ Glow --- */}
          <div
            className="hero-preview"
            style={{
              position: "relative",
              animation: "lafFadeInUp 0.5s ease-out 0.1s both",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: -30,
                background:
                  "radial-gradient(50% 50% at 50% 45%, rgba(124,92,252,0.35) 0%, rgba(124,92,252,0.08) 55%, transparent 75%)",
                filter: "blur(30px)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "relative",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: 18,
                boxShadow:
                  "0 0 0 1px rgba(124,92,252,0.12), 0 24px 60px rgba(0,0,0,0.5), 0 0 60px rgba(124,92,252,0.18)",
              }}
            >
              {/* Card header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderBottom: "1px solid var(--border)",
                  paddingBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: "linear-gradient(135deg, #7c5cfc, #4f3bd6)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 4px 14px rgba(124,92,252,0.45)",
                  }}
                >
                  <BarChart3 size={16} color="var(--accent-fg)" />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--fg)" }}>
                    ภาพรวมวันนี้
                  </div>
                  <div style={{ fontSize: 11, color: "var(--fg-muted)", marginTop: 1 }}>
                    อัปเดตเรียลไทม์จากระบบ
                  </div>
                </div>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 10,
                    fontWeight: 800,
                    color: "#34d399",
                    background: "rgba(52,211,153,0.12)",
                    border: "1px solid rgba(52,211,153,0.3)",
                    padding: "3px 8px",
                    borderRadius: 999,
                    letterSpacing: "0.05em",
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#34d399", animation: "lafPulse 1.4s ease-in-out infinite" }} />
                  LIVE
                </span>
              </div>

              {/* Stat blocks */}
              <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                {[
                  { label: "ของหาย", value: String(heroData.lostCount), color: "#fb923c" },
                  { label: "ของพบ", value: String(heroData.foundCount), color: "#34d399" },
                  { label: "คืนแล้ว", value: String(heroData.resolvedCount), color: "var(--fg-secondary)" },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      flex: 1,
                      background: "var(--bg-subtle)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: "9px 12px",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
                      <span style={{ fontSize: 10.5, color: "var(--fg-muted)", fontWeight: 600 }}>{s.label}</span>
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: "var(--fg)", marginTop: 3 }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Mini bar chart */}
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 6,
                  height: 66,
                  marginTop: 16,
                  padding: "10px 12px",
                  background: "var(--bg-subtle)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                }}
              >
                {heroData.activity.map((h, i) => {
                  const pct =
                    h === 0
                      ? 5
                      : Math.max(14, Math.round((h / heroData.maxActivity) * 100));
                  return (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        height: `${pct}%`,
                        borderRadius: 4,
                        background:
                          i >= 5
                            ? "linear-gradient(180deg, #a78bfa, #7c5cfc)"
                            : "#2f2a44",
                        boxShadow:
                          i >= 5 ? "0 0 10px rgba(124,92,252,0.5)" : "none",
                        minHeight: 5,
                      }}
                    />
                  );
                })}
              </div>

              {/* Recent rows (ข้อมูลจริงล่าสุด) */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                {(
                  [
                    { post: heroData.recentLost, type: "lost" as const },
                    { post: heroData.recentFound, type: "found" as const },
                  ] as const
                ).map(({ post, type }) => {
                  const isLost = type === "lost";
                  if (!post) {
                    return (
                      <div
                        key={type}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          background: "var(--bg-subtle)",
                          border: "1px solid var(--border)",
                          borderRadius: 10,
                          padding: "9px 12px",
                        }}
                      >
                        <div
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 8,
                            background: "var(--bg-hover)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 800,
                            color: "var(--fg-faint)",
                          }}
                        >
                          —
                        </div>
                        <div
                          style={{
                            flex: 1,
                            fontSize: 12,
                            color: "var(--fg-faint)",
                            fontWeight: 600,
                          }}
                        >
                          ยังไม่มีรายการของ{isLost ? "หาย" : "พบ"}ล่าสุด
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={post.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "var(--bg-subtle)",
                        border: "1px solid var(--border)",
                        borderRadius: 10,
                        padding: "9px 12px",
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 8,
                          background: "linear-gradient(135deg, var(--bg-hover), var(--bg-card))",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 12,
                          fontWeight: 800,
                          color: isLost ? "#fb923c" : "#34d399",
                        }}
                      >
                        {(post.title || "?").charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {post.title}
                        </div>
                        <div style={{ fontSize: 10.5, color: "var(--fg-muted)", marginTop: 1 }}>
                          {post.building || post.locationName || "ไม่ระบุสถานที่"} · {timeAgo(post.createdAt)}
                        </div>
                      </div>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: isLost ? "#fb923c" : "#34d399",
                          background: isLost ? "#2a1a10" : "#0f2a1f",
                          border: isLost ? "1px solid #4a3418" : "1px solid #1f4a35",
                          padding: "3px 7px",
                          borderRadius: 999,
                        }}
                      >
                        {isLost ? "LOST" : "FOUND"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Floating AI match chip (ข้อมูลจริงจาก matches) */}
            {heroData.aiPairs > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: -14,
                  right: 16,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "var(--bg-card)",
                  border: "1px solid rgba(124,92,252,0.45)",
                  borderRadius: 999,
                  padding: "5px 11px",
                  fontSize: 11,
                  fontWeight: 800,
                  color: "var(--fg-accent)",
                  boxShadow: "0 8px 24px rgba(124,92,252,0.35)",
                  animation: "lafGlowPulse 4s ease-in-out infinite",
                }}
              >
                <Sparkles size={12} />
                AI เทียบเคียง {heroData.aiPairs} คู่ · ตรง {heroData.aiTop}%
              </div>
            )}
          </div>
        </section>

        {/* ============ Search (Glassmorphic) + Filters ============ */}
        <section style={{ position: "relative", marginTop: 6 }}>
          <div
            className="vc-glass"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              maxWidth: 660,
              margin: "0 auto",
              height: 46,
              borderRadius: 12,
              padding: "0 16px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <Search size={16} color="#7c5cfc" style={{ flexShrink: 0 }} />
            <input
              type="text"
              placeholder="ค้นหาชื่อสิ่งของ, สถานที่ หรือรายละเอียด..."
              value={searchTerm}
              onChange={(e) => {
                    setPage(1);
                    setSearchTerm(e.target.value);
                  }}
              style={{
                flex: 1,
                border: "none",
                background: "transparent",
                outline: "none",
                color: "var(--fg)",
                fontSize: 13.5,
              }}
            />
            {searchTerm && (
              <button
                onClick={() => {
                    setPage(1);
                    setSearchTerm("");
                  }}
                title="ล้างการค้นหา"
                style={{
                  background: "var(--bg-hover)",
                  border: "none",
                  borderRadius: "50%",
                  width: 22,
                  height: 22,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <X size={13} color="var(--fg-secondary)" />
              </button>
            )}
            <button
              onClick={onNavigateToReport}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 14px",
                borderRadius: 9,
                border: "none",
                background: "#7c5cfc",
                color: "var(--accent-fg)",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                flexShrink: 0,
                boxShadow: "0 4px 16px rgba(124,92,252,0.35)",
                transition: "background 0.13s ease",
              }}
            >
              <Plus size={14} />
              แจ้งของ
            </button>
          </div>

          {/* Filter Tabs (Pill Badge) */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginTop: 18,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {tabs.map((tab) => {
              const active = filterType === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    setPage(1);
                    setFilterType(tab.key);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 14px",
                    borderRadius: 999,
                    border: "1px solid",
                    cursor: "pointer",
                    fontSize: 12.5,
                    fontWeight: active ? 700 : 500,
                    background: active ? "#7c5cfc" : "var(--bg-card)",
                    borderColor: active ? "#7c5cfc" : "var(--border)",
                    color: active ? "var(--fg)" : "var(--fg-muted)",
                    boxShadow: active ? "0 6px 20px rgba(124,92,252,0.4)" : "none",
                    transition: "background 0.13s ease, box-shadow 0.13s ease",
                  }}
                >
                  <span>{tab.label}</span>
                  <span
                    style={{
                      minWidth: 18,
                      height: 18,
                      borderRadius: 999,
                      padding: "0 6px",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10.5,
                      fontWeight: 700,
                      background: active ? "rgba(255,255,255,0.22)" : "var(--bg-hover)",
                      color: active ? "var(--fg)" : "var(--fg-secondary)",
                    }}
                  >
                    {countStatus(tab.key)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ============ Notice Callout ============ */}
        <section
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            backgroundColor: "rgba(124,92,252,0.08)",
            border: "1px solid rgba(124,92,252,0.3)",
            borderLeft: "3px solid #7c5cfc",
            borderRadius: 12,
            padding: "12px 14px",
            marginTop: 20,
            marginBottom: 24,
          }}
        >
          <ShieldAlert size={16} color="var(--fg-accent)" style={{ marginTop: 1, flexShrink: 0 }} />
          <div style={{ fontSize: 12.5, color: "var(--fg-secondary)", lineHeight: 1.6 }}>
            <span style={{ fontWeight: 700, color: "var(--fg)" }}>แจ้งประกาศ:</span>{" "}
            รายการที่คืนแล้วจะแสดงในระบบ 7 วัน หากส่งมอบผิดพลาด เจ้าของสามารถกดรายงานแจ้งสวมสิทธิ์ได้ทันที
          </div>
        </section>

        {/* ============ Compact Feed (เหมือนหน้ารายการของฉัน) ============ */}
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {/* ============ AI แนะนำ Section (หน้าฟีด) ============ */}
        {(showAiSection || showAiEmpty) && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: "linear-gradient(135deg,#7c5cfc,#4f3bd6)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={14} color="var(--accent-fg)" />
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--fg)" }}>
                AI แนะนำ — ตรงกับโพสต์ของคุณ
                {showAiSection && (
                  <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>
                    {" "}· {aiRowsForTab.length} รายการ
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={forceRefreshAi}
                disabled={refreshing}
                title="ให้ระบบรีเฟรชคู่แนะนำใหม่ (กฎแมทฟรี ไม่เปลืองโควตา)"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  height: 30,
                  padding: "0 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(124,92,252,0.40)",
                  background: "rgba(124,92,252,0.10)",
                  color: "var(--fg-accent)",
                  fontSize: 11.5,
                  fontWeight: 700,
                  cursor: refreshing ? "not-allowed" : "pointer",
                  opacity: refreshing ? 0.55 : 1,
                  flexShrink: 0,
                }}
              >
                <RefreshCw size={12} />
                {refreshing
                  ? `กำลังสแกน ${scanDone}/${scanTotal}...`
                  : "รีเฟรชคู่แนะนำ"}
              </button>
            </div>
            {(refreshing || lastRefreshAt) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {refreshing ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#7c5cfc",
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: "rgba(124,92,252,0.10)",
                      border: "1px solid rgba(124,92,252,0.30)",
                    }}
                  >
                    <RefreshCw
                      size={11}
                      style={{ animation: "spin 1s linear infinite" }}
                    />
                    กำลังรีแมทใหม่... {scanDone}/{scanTotal}
                  </span>
                ) : matchDiff ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#34d399",
                      padding: "5px 10px",
                      borderRadius: 999,
                      background: "rgba(52,211,153,0.10)",
                      border: "1px solid rgba(52,211,153,0.35)",
                    }}
                  >
                    <CheckCircle2 size={12} />
                    {matchDiff.added + matchDiff.changed + matchDiff.gone === 0
                      ? "รีแมทใหม่แล้ว · ผลเหมือนเดิม"
                      : `รีแมทใหม่แล้ว · เพิ่ม ${matchDiff.added} · ปรับ ${matchDiff.changed} · หลุด ${matchDiff.gone}`}
                  </span>
                ) : null}
                {!refreshing && lastRefreshAt && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: "var(--fg-faint)",
                    }}
                  >
                    อัปเดตล่าสุด{" "}
                    {new Date(lastRefreshAt).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}{" "}
                    น.
                  </span>
                )}
              </div>
            )}
            {myPendingFound.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--fg-muted)",
                  lineHeight: 1.5,
                  marginBottom: 8,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: "rgba(251,191,36,0.08)",
                  border: "1px solid rgba(251,191,36,0.25)",
                }}
              >
                <Clock size={12} color="#fbbf24" style={{ flexShrink: 0 }} />
                <span>
                  โพสต์ของพบของคุณยัง{" "}
                  <span style={{ color: "#fbbf24", fontWeight: 800 }}>
                    รอแอดมินอนุมัติตรวจรับ
                  </span>{" "}
                  — แมทพร้อมแล้ว แต่จะแสดงให้อีกฝ่ายเห็นหลังอนุมัติ
                </span>
              </div>
            )}

            {showAiSection ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {showAiConfirmedSection && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11.5,
                        fontWeight: 800,
                        color: "#34d399",
                      }}
                    >
                      <CheckCircle2 size={12} />
                      แมทจริง · ยืนยันแล้ว ({aiConfirmedRowsForTab.length})
                    </div>
                    {aiConfirmedRowsForTab.slice(0, 5).map((row) => {
                      const other = row.other;
                      const rowKey = `${row.myPost.id}|${row.other.id}`;
                      const isFresh = highlightKeys.has(rowKey);
                      const otherLost = other.itemType === "lost";
                      const loc =
                        other.building ||
                        other.locationName ||
                        "ไม่ระบุสถานที่";
                      return (
                        <div
                          key={rowKey}
                          className="vc-card vc-card-hover"
                          onClick={() => onSelectPost && onSelectPost(other)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: "var(--bg-subtle)",
                            border: isFresh
                              ? "1px solid rgba(52,211,153,0.7)"
                              : "1px solid rgba(52,211,153,0.45)",
                            boxShadow: isFresh
                              ? "0 0 0 1px rgba(52,211,153,0.22), 0 4px 18px rgba(52,211,153,0.15)"
                              : "0 4px 18px rgba(52,211,153,0.12)",
                            cursor: "pointer",
                          }}
                        >
                          {other.imageUrl ? (
                            <img
                              src={other.imageUrl}
                              alt={other.title || "รูปสิ่งของ"}
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 10,
                                objectFit: "cover",
                                flexShrink: 0,
                                background: "var(--bg-card)",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 9,
                                background: otherLost ? "#2a1a10" : "#0f2a1f",
                                border: otherLost
                                  ? "1px solid #4a3418"
                                  : "1px solid #1f4a35",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 13,
                                fontWeight: 800,
                                color: otherLost ? "#fb923c" : "#34d399",
                                flexShrink: 0,
                              }}
                            >
                              {(other.title || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                color: "#34d399",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              โพสต์ของคุณ: {row.myPost.title}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: "var(--fg)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {other.title}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--fg-muted)",
                                marginTop: 1,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {loc} · {timeAgo(other.createdAt)}
                            </div>
                            {row.reason && (
                              <div
                                style={{
                                  fontSize: 10.5,
                                  color: "var(--fg-faint)",
                                  marginTop: 2,
                                  lineHeight: 1.4,
                                }}
                              >
                                AI: {row.reason}
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              flexShrink: 0,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              gap: 3,
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                fontSize: 9,
                                fontWeight: 800,
                                letterSpacing: "0.4px",
                                color: "#34d399",
                                background: "rgba(52,211,153,0.14)",
                                border: "1px solid rgba(52,211,153,0.40)",
                                padding: "2px 7px",
                                borderRadius: 999,
                                whiteSpace: "nowrap",
                              }}
                            >
                              <CheckCircle2 size={10} />
                              แมทจริง · ยืนยันแล้ว
                            </span>
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11.5,
                                fontWeight: 800,
                                background: "rgba(52,211,153,0.12)",
                                border: "1px solid rgba(52,211,153,0.35)",
                                color: "#34d399",
                                padding: "3px 8px",
                                borderRadius: 999,
                              }}
                            >
                              {row.score}%
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {showAiSuggestedSection && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11.5,
                        fontWeight: 800,
                        color: "#fbbf24",
                      }}
                    >
                      <Sparkles size={12} />
                      คู่ที่ AI แนะนำ · รอยืนยัน ({aiSuggestedRowsForTab.length})
                    </div>
                    {aiSuggestedRowsForTab.slice(0, 5).map((row) => {
                      const other = row.other;
                      const rowKey = `${row.myPost.id}|${row.other.id}`;
                      const isFresh = highlightKeys.has(rowKey);
                      const otherLost = other.itemType === "lost";
                      const loc =
                        other.building ||
                        other.locationName ||
                        "ไม่ระบุสถานที่";
                      const busy = busyConfirmKey === rowKey;
                      return (
                        <div
                          key={rowKey}
                          className="vc-card vc-card-hover"
                          onClick={() => onSelectPost && onSelectPost(other)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "10px 12px",
                            borderRadius: 12,
                            background: "var(--bg-subtle)",
                            border: isFresh
                              ? "1px solid rgba(251,191,36,0.6)"
                              : "1px solid rgba(251,191,36,0.32)",
                            boxShadow: isFresh
                              ? "0 0 0 1px rgba(251,191,36,0.2)"
                              : "none",
                            cursor: "pointer",
                          }}
                        >
                          {other.imageUrl ? (
                            <img
                              src={other.imageUrl}
                              alt={other.title || "รูปสิ่งของ"}
                              style={{
                                width: 44,
                                height: 44,
                                borderRadius: 10,
                                objectFit: "cover",
                                flexShrink: 0,
                                background: "var(--bg-card)",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 9,
                                background: otherLost ? "#2a1a10" : "#0f2a1f",
                                border: otherLost
                                  ? "1px solid #4a3418"
                                  : "1px solid #1f4a35",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 13,
                                fontWeight: 800,
                                color: otherLost ? "#fb923c" : "#34d399",
                                flexShrink: 0,
                              }}
                            >
                              {(other.title || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                color: "#fbbf24",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              โพสต์ของคุณ: {row.myPost.title}
                            </div>
                            <div
                              style={{
                                fontSize: 13,
                                fontWeight: 700,
                                color: "var(--fg)",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {other.title}
                            </div>
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--fg-muted)",
                                marginTop: 1,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {loc} · {timeAgo(other.createdAt)}
                            </div>
                            {row.reason && (
                              <div
                                style={{
                                  fontSize: 10.5,
                                  color: "var(--fg-faint)",
                                  marginTop: 2,
                                  lineHeight: 1.4,
                                }}
                              >
                                AI: {row.reason}
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              flexShrink: 0,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              gap: 3,
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                fontSize: 9,
                                fontWeight: 800,
                                letterSpacing: "0.4px",
                                color: "#fbbf24",
                                background: "rgba(251,191,36,0.14)",
                                border: "1px solid rgba(251,191,36,0.40)",
                                padding: "2px 7px",
                                borderRadius: 999,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {isFresh ? "· แมทใหม่" : "แนะนำ · รอยืนยัน"}
                            </span>
                            <div
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11.5,
                                fontWeight: 800,
                                background: "rgba(124,92,252,0.12)",
                                border: "1px solid rgba(124,92,252,0.35)",
                                color: "var(--fg-accent)",
                                padding: "3px 8px",
                                borderRadius: 999,
                              }}
                            >
                              {row.score}%
                            </div>
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                marginTop: 2,
                              }}
                            >
                              <button
                                type="button"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConfirmDecision(
                                    row.myPost.id as string,
                                    row.other.id as string,
                                    "confirm"
                                  );
                                }}
                                style={{
                                  height: 24,
                                  padding: "0 8px",
                                  borderRadius: 7,
                                  border: "1px solid rgba(52,211,153,0.45)",
                                  background: "rgba(52,211,153,0.14)",
                                  color: "#34d399",
                                  fontSize: 10.5,
                                  fontWeight: 800,
                                  cursor: busy ? "wait" : "pointer",
                                }}
                              >
                                ใช่ของฉัน
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleConfirmDecision(
                                    row.myPost.id as string,
                                    row.other.id as string,
                                    "reject"
                                  );
                                }}
                                style={{
                                  height: 24,
                                  padding: "0 8px",
                                  borderRadius: 7,
                                  border: "1px solid rgba(244,63,94,0.45)",
                                  background: "rgba(244,63,94,0.10)",
                                  color: "#f87171",
                                  fontSize: 10.5,
                                  fontWeight: 800,
                                  cursor: busy ? "wait" : "pointer",
                                }}
                              >
                                ไม่ใช่ของฉัน
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: "var(--bg-subtle)",
                  border: "1px dashed rgba(124,92,252,0.45)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg)" }}>
                  AI กำลังสแกนหารายการที่ตรงกับโพสต์ของคุณ
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: "var(--fg-muted)",
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  เมื่อพบรายการที่ตรงกัน ระบบจะแสดงที่นี่อัตโนมัติ หรือกดปุ่ม
                  "รีเฟรชคู่แนะนำ" ด้านบนเพื่อสแกนทันที
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============ AI ใกล้เคียง (ยังไม่ยืนยัน) Section ============ */}
        {showAiNearSection && (
          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  background: "rgba(251,191,36,0.14)",
                  border: "1px solid rgba(251,191,36,0.35)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Clock size={14} color="#fbbf24" />
              </div>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: "var(--fg)" }}>
                AI ใกล้เคียง — ยังไม่ยืนยัน
                <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>
                  {" "}· {aiNearRowsForTab.length} รายการ
                </span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {aiNearRowsForTab.slice(0, 5).map((row) => {
                const other = row.other;
                const rowKey = `${row.myPost.id}|${row.other.id}`;
                const otherLost = other.itemType === "lost";
                const loc = other.building || other.locationName || "ไม่ระบุสถานที่";
const busy = busyConfirmKey === rowKey;
                    return (
                      <div
                        key={rowKey}
                        className="vc-card vc-card-hover"
                        onClick={() => onSelectPost && onSelectPost(other)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 12px",
                          borderRadius: 12,
                          background: "var(--bg-subtle)",
                          border: row.confirmed
                            ? "1px solid rgba(52,211,153,0.5)"
                            : "1px solid rgba(251,191,36,0.28)",
                          cursor: "pointer",
                          opacity: row.confirmed ? 1 : 0.86,
                          transition:
                            "border-color 0.15s ease, opacity 0.15s ease",
                        }}
                      >
                    {other.imageUrl ? (
                      <img
                        src={other.imageUrl}
                        alt={other.title || "รูปสิ่งของ"}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 10,
                          objectFit: "cover",
                          flexShrink: 0,
                          background: "var(--bg-card)",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 9,
                          background: otherLost ? "#2a1a10" : "#0f2a1f",
                          border: otherLost
                            ? "1px solid #4a3418"
                            : "1px solid #1f4a35",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 800,
                          color: otherLost ? "#fb923c" : "#34d399",
                          flexShrink: 0,
                        }}
                      >
                        {(other.title || "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: "#fbbf24",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        โพสต์ของคุณ: {row.myPost.title}
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--fg)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {other.title}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: "var(--fg-muted)",
                          marginTop: 1,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {loc} · {timeAgo(other.createdAt)}
                      </div>
                      {row.reason && (
                        <div
                          style={{
                            fontSize: 10.5,
                            color: "var(--fg-faint)",
                            marginTop: 2,
                            lineHeight: 1.4,
                          }}
                        >
                          AI: {row.reason}
                        </div>
                      )}
                    </div>
                    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          letterSpacing: "0.4px",
                          color: row.confirmed ? "#34d399" : "#fbbf24",
                          background: row.confirmed
                            ? "rgba(52,211,153,0.14)"
                            : "rgba(251,191,36,0.12)",
                          border: "1px solid",
                          borderColor: row.confirmed
                            ? "rgba(52,211,153,0.40)"
                            : "rgba(251,191,36,0.35)",
                          padding: "1px 6px",
                          borderRadius: 999,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {row.confirmed ? "ยืนยันแล้ว" : "ใกล้เคียง · ยังไม่ยืนยัน"}
                      </span>
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11.5,
                          fontWeight: 800,
                          background: row.confirmed
                            ? "rgba(52,211,153,0.10)"
                            : "rgba(251,191,36,0.10)",
                          border: "1px solid",
                          borderColor: row.confirmed
                            ? "rgba(52,211,153,0.35)"
                            : "rgba(251,191,36,0.30)",
                          color: row.confirmed ? "#34d399" : "#fbbf24",
                          padding: "3px 8px",
                          borderRadius: 999,
                        }}
                      >
                        {row.score}%
                      </div>
                      {!row.confirmed && (
                        <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfirmDecision(
                                row.myPost.id as string,
                                row.other.id as string,
                                "confirm"
                              );
                            }}
                            style={{
                              height: 24,
                              padding: "0 8px",
                              borderRadius: 7,
                              border: "1px solid rgba(52,211,153,0.45)",
                              background: "rgba(52,211,153,0.14)",
                              color: "#34d399",
                              fontSize: 10.5,
                              fontWeight: 800,
                              cursor: busy ? "wait" : "pointer",
                            }}
                          >
                            ใช่ของฉัน
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfirmDecision(
                                row.myPost.id as string,
                                row.other.id as string,
                                "reject"
                              );
                            }}
                            style={{
                              height: 24,
                              padding: "0 8px",
                              borderRadius: 7,
                              border: "1px solid rgba(244,63,94,0.45)",
                              background: "rgba(244,63,94,0.10)",
                              color: "#f87171",
                              fontSize: 10.5,
                              fontWeight: 800,
                              cursor: busy ? "wait" : "pointer",
                            }}
                          >
                            ไม่ใช่ของฉัน
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============ Results Header ============ */}
        <div
          id="home-results"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderBottom: "1px solid var(--border)",
            paddingBottom: 12,
            marginBottom: 16,
            scrollMarginTop: 16,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--fg)" }}>
            รายการทรัพย์สิน{" "}
            <span style={{ color: "var(--fg-muted)", fontWeight: 500 }}>
              —{" "}
              {filteredPosts.length === 0
                ? "0"
                : `${(currentPage - 1) * PAGE_SIZE + 1}-${Math.min(
                    currentPage * PAGE_SIZE,
                    filteredPosts.length
                  )}`}{" "}
              จาก {filteredPosts.length} รายการ
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => setIsBuildingModalOpen(true)}
              title="กรองตามคณะ / อาคาร / พื้นที่"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: selectedBuilding ? "rgba(124,92,252,0.45)" : "var(--border)",
                background: selectedBuilding ? "rgba(124,92,252,0.14)" : "var(--bg-card)",
                fontSize: 12.5,
                fontWeight: selectedBuilding ? 700 : 500,
                color: selectedBuilding ? "var(--fg-accent)" : "var(--fg-muted)",
                cursor: "pointer",
                maxWidth: 240,
              }}
            >
              <Building2 size={14} color={selectedBuilding ? "var(--fg-accent)" : "var(--fg-muted)"} />
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {selectedBuilding || "ทุกพื้นที่"}
              </span>
              {selectedBuilding && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPage(1);
                    setSelectedBuilding(null);
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.15)",
                    marginLeft: 2,
                  }}
                >
                  <X size={11} color="var(--fg-secondary)" />
                </span>
              )}
              <ChevronDown size={14} color="var(--fg-muted)" style={{ flexShrink: 0 }} />
            </button>

            <button
              onClick={() => setIsCategoryModalOpen(true)}
              title="กรองตามหมวดหมู่สิ่งของ"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                height: 32,
                padding: "0 12px",
                borderRadius: 999,
                border: "1px solid",
                borderColor: selectedCategory !== "all" ? "rgba(124,92,252,0.45)" : "var(--border)",
                background: selectedCategory !== "all" ? "rgba(124,92,252,0.14)" : "var(--bg-card)",
                fontSize: 12.5,
                fontWeight: selectedCategory !== "all" ? 700 : 500,
                color: selectedCategory !== "all" ? "var(--fg-accent)" : "var(--fg-muted)",
                cursor: "pointer",
                maxWidth: 240,
              }}
            >
              <Package size={14} color={selectedCategory !== "all" ? "var(--fg-accent)" : "var(--fg-muted)"} />
              <span
                style={{
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {selectedCategory !== "all" ? selectedCategory : "ทุกหมวดหมู่"}
              </span>
              {selectedCategory !== "all" && (
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPage(1);
                    setSelectedCategory("all");
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,0.15)",
                    marginLeft: 2,
                  }}
                >
                  <X size={11} color="var(--fg-secondary)" />
                </span>
              )}
              <ChevronDown size={14} color="var(--fg-muted)" style={{ flexShrink: 0 }} />
            </button>
          </div>
        </div>

        {/* ============ Item Grid ============ */}
        {loading ? (
          <div className="vc-grid">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  padding: 14,
                  overflow: "hidden",
                }}
              >
                <div className="vc-skeleton" style={{ height: 130 }} />
                <div className="vc-skeleton" style={{ width: "55%", height: 13, marginTop: 12 }} />
                <div className="vc-skeleton" style={{ width: "90%", height: 11, marginTop: 8 }} />
                <div className="vc-skeleton" style={{ width: "40%", height: 10, marginTop: 8 }} />
              </div>
            ))}
          </div>
        ) : filteredPosts.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              border: "1px dashed var(--border-strong)",
              borderRadius: 12,
              background: "var(--bg-subtle)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 14px",
              }}
            >
              <SearchX size={22} color="var(--fg-secondary)" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>
              ไม่พบรายการข้อมูล
            </div>
            <div style={{ fontSize: 12.5, color: "var(--fg-muted)", marginTop: 6, lineHeight: 1.6 }}>
              ลองค้นหาด้วยคำอื่น หรือเปลี่ยนหมวดหมู่
            </div>
            <button
              onClick={onNavigateToReport}
              style={{
                marginTop: 16,
                padding: "8px 16px",
                fontWeight: 700,
                borderRadius: 9,
                border: "none",
                background: "#7c5cfc",
                color: "var(--accent-fg)",
                cursor: "pointer",
                fontSize: 13,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                boxShadow: "0 6px 20px rgba(124,92,252,0.35)",
              }}
            >
              <Plus size={14} />
              แจ้งสิ่งของ
            </button>
          </div>
        ) : (
          <>
          <div className="vc-grid">
            {pagePosts.map((post) => {
              const currentUid = auth.currentUser?.uid;
              const isMyPost = !!currentUid && post.userId === currentUid;

              // สำหรับโพสต์คนอื่น: หาว่าโพสต์นี้ match กับโพสต์ไหนของเรา
              const myPostIds = new Set(
                posts.filter((p) => p.userId === currentUid).map((p) => p.id)
              );
              const matchesWithMyPosts = !isMyPost && post.matches
                ? post.matches.filter((m) => myPostIds.has(m.matchedPostId))
                : [];
              const bestExternalMatch =
                matchesWithMyPosts.length > 0
                  ? matchesWithMyPosts.sort(
                      (a, b) => b.similarityScore - a.similarityScore
                    )[0]
                  : null;

              // สำหรับโพสต์ของตัวเอง: ไม่แสดง % (ซ่อนไว้)
              const matchChip = null;

              return (
                <div
                  key={post.id}
                  className="vc-card vc-card-hover"
                  onClick={() => onSelectPost && onSelectPost(post)}
                  style={{
                    overflow: "hidden",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    background: "var(--bg-card)",
                    borderColor: "var(--border)",
                    transition: "border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                  }}
                >
                  {post.imageUrl && (
                    <div style={{ position: "relative", width: "100%" }}>
                      <img
                        src={post.imageUrl}
                        alt={post.title}
                        style={{
                          width: "100%",
                          height: 150,
                          objectFit: "cover",
                          display: "block",
                          backgroundColor: "var(--bg-subtle)",
                        }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          top: 10,
                          left: 10,
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        {statusBadge(post)}
                        {matchChip}
                      </div>
                    </div>
                  )}

                  <div
                    style={{
                      padding: "14px 16px 16px",
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                      gap: 8,
                    }}
                  >
                    {!post.imageUrl && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {statusBadge(post)}
                        {matchChip}
                      </div>
                    )}

                    <div
                      style={{
                        fontSize: 14.5,
                        fontWeight: 700,
                        color: "var(--fg)",
                        lineHeight: 1.35,
                        letterSpacing: "-0.01em",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {post.title}
                    </div>

                    {post.desc && (
                      <div
                        style={{
                          fontSize: 12.5,
                          color: "var(--fg-muted)",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          lineHeight: 1.55,
                        }}
                      >
                        {post.desc}
                      </div>
                    )}

                    {/* Meta: หมวดหมู่ + สถานที่ + วันที่ */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        columnGap: 12,
                        rowGap: 6,
                        fontSize: 12,
                        color: "var(--fg-muted)",
                        marginTop: "auto",
                        paddingTop: 4,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "2px 8px",
                          borderRadius: 6,
                          background: "var(--bg-hover)",
                          border: "1px solid var(--border)",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "var(--fg-accent)",
                        }}
                      >
                        {post.category ||
                          (post.itemType === "lost" ? "ของหาย" : "ของที่พบ")}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
                        <MapPin size={13} color="var(--fg-faint)" />
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 140,
                          }}
                        >
                          {post.locationName}
                        </span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Clock size={13} color="var(--fg-faint)" />
                        {formatDate(post.date)}
                        {formatPostTime(post.createdAt) ? ` · โพสต์ ${formatPostTime(post.createdAt)}` : ""}
                      </span>
                    </div>

                    {/* Footer: ผู้แจ้ง + ปุ่มรายงาน */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        borderTop: "1px solid var(--border)",
                        paddingTop: 10,
                        marginTop: 4,
                      }}
                    >
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          color: "var(--fg-muted)",
                          minWidth: 0,
                        }}
                      >
                        <UserCircle size={13} color="var(--fg-faint)" style={{ flexShrink: 0 }} />
                        <span
                          style={{
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            maxWidth: 120,
                          }}
                        >
                          {post.reporterName}
                        </span>
                      </span>

                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {bestExternalMatch && bestExternalMatch.similarityScore >= 50 && (
                          <span
                            title={`ตรงกับโพสต์ของคุณ: "${bestExternalMatch.matchedTitle}"`}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              fontSize: 10.5,
                              fontWeight: 700,
                              color: "#c4b5fd",
                              background: "rgba(124,92,252,0.15)",
                              border: "1px solid rgba(124,92,252,0.4)",
                              padding: "2px 8px",
                              borderRadius: 999,
                              cursor: "default",
                            }}
                          >
                            <Sparkles size={11} color="#c4b5fd" />
                            ตรง {bestExternalMatch.similarityScore}%
                          </span>
                        )}

                        {!isMyPost && (
                          <button
                            type="button"
                            title="รายงานโพสต์นี้"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!auth.currentUser?.uid) {
                                // หลังล็อกอิน ให้เปิด modal รายงานโพสต์นี้ต่อทันที
                                onRequireLogin?.(() => setReportPostData(post));
                                return;
                              }
                              setReportPostData(post);
                            }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 24,
                              height: 24,
                              borderRadius: 6,
                              border: "1px solid var(--border)",
                              background: "var(--bg-card)",
                              color: "var(--fg-faint)",
                              cursor: "pointer",
                              flexShrink: 0,
                              transition: "color 0.15s, border-color 0.15s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.color = "#f87171";
                              e.currentTarget.style.borderColor = "#f87171";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.color = "var(--fg-faint)";
                              e.currentTarget.style.borderColor = "var(--border)";
                            }}
                          >
                            <Flag size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: 6,
                marginTop: 20,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => goPage(currentPage - 1)}
                disabled={currentPage <= 1}
                style={pageBtnStyle(false)}
              >
                ‹ ก่อนหน้า
              </button>

              {pageItems.map((item, idx) =>
                item === "…" ? (
                  <span
                    key={`dots-${idx}`}
                    style={{ color: "var(--fg-faint)", fontSize: 13, padding: "0 2px" }}
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    onClick={() => goPage(item)}
                    disabled={item === currentPage}
                    style={pageBtnStyle(item === currentPage)}
                  >
                    {item}
                  </button>
                )
              )}

              <button
                type="button"
                onClick={() => goPage(currentPage + 1)}
                disabled={currentPage >= pageCount}
                style={pageBtnStyle(false)}
              >
                ถัดไป ›
              </button>
            </div>
          )}
          </>
        )}
        </div>
      </main>

      {/* Modal / Dialog สำหรับเลือกอาคาร/คณะ */}
      {isBuildingModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(5, 4, 10, 0.72)",
            backdropFilter: "blur(6px)",
            zIndex: 100,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
          onClick={() => setIsBuildingModalOpen(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-card)",
              width: "100%",
              maxWidth: 520,
              maxHeight: "82vh",
              borderRadius: 14,
              border: "1px solid var(--border)",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(124,92,252,0.12)",
              animation: "fadeIn 0.15s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>
                  เลือกคณะ / อาคาร / พื้นที่
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>
                  กรองรายการทรัพย์สินเฉพาะจุด
                </div>
              </div>
              <button
                onClick={() => setIsBuildingModalOpen(false)}
                aria-label="ปิด"
                className="vc-btn"
                style={{ width: 30, height: 30, padding: 0 }}
              >
                <X size={15} />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "0 10px",
                marginBottom: 12,
                backgroundColor: "var(--bg-subtle)",
                height: 34,
              }}
            >
              <Search size={15} color="#7c5cfc" />
              <input
                type="text"
                placeholder="พิมพ์ชื่อคณะ หรือ อาคาร..."
                value={buildingSearchText}
                onChange={(e) => setBuildingSearchText(e.target.value)}
                style={{
                  border: "none",
                  background: "transparent",
                  outline: "none",
                  marginLeft: 8,
                  flex: 1,
                  fontSize: 13,
                  color: "var(--fg)",
                }}
              />
              {buildingSearchText && (
                <button
                  onClick={() => setBuildingSearchText("")}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <X size={14} color="var(--fg-muted)" />
                </button>
              )}
            </div>

            <div
              style={{
                overflowY: "auto",
                maxHeight: "48vh",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                scrollbarWidth: "none",
              }}
            >
              {filteredBuildings.length === 0 ? (
                <div style={{ textAlign: "center", padding: "30px 0", color: "var(--fg-muted)", fontSize: 13 }}>
                  ไม่พบสถานที่ที่ค้นหา
                </div>
              ) : (
                filteredBuildings.map((building) => {
                  const isSelected = selectedBuilding === building;
                  return (
                    <button
                      key={building}
                      onClick={() => {
                        setPage(1);
                        setSelectedBuilding(building);
                        setIsBuildingModalOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        backgroundColor: isSelected ? "rgba(124,92,252,0.14)" : "var(--bg-card)",
                        color: isSelected ? "var(--fg)" : "var(--fg-accent)",
                        border: isSelected ? "1px solid rgba(124,92,252,0.5)" : "1px solid var(--border)",
                        padding: "9px 12px",
                        borderRadius: 10,
                        fontSize: 13,
                        fontWeight: isSelected ? 700 : 500,
                        textAlign: "left",
                        cursor: "pointer",
                        width: "100%",
                        transition: "background 0.12s ease",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 0,
                        }}
                      >
                        <Building2 size={14} color={isSelected ? "#7c5cfc" : "var(--fg-faint)"} style={{ flexShrink: 0 }} />
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {building}
                        </span>
                      </div>
                      {isSelected && <CheckCircle2 size={15} color="#7c5cfc" style={{ flexShrink: 0 }} />}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal / Dialog สำหรับเลือกหมวดหมู่ */}
      {isCategoryModalOpen && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(5, 4, 10, 0.72)",
            backdropFilter: "blur(6px)",
            zIndex: 100,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
          }}
          onClick={() => setIsCategoryModalOpen(false)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-card)",
              width: "100%",
              maxWidth: 520,
              maxHeight: "82vh",
              borderRadius: 14,
              border: "1px solid var(--border)",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 24px 60px rgba(0, 0, 0, 0.6), 0 0 40px rgba(124,92,252,0.12)",
              animation: "fadeIn 0.15s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--fg)" }}>
                  เลือกหมวดหมู่สิ่งของ
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>
                  กรองรายการตามหมวดหมู่ที่แจ้ง
                </div>
              </div>
              <button
                onClick={() => setIsCategoryModalOpen(false)}
                aria-label="ปิด"
                className="vc-btn"
                style={{ width: 30, height: 30, padding: 0 }}
              >
                <X size={15} />
              </button>
            </div>

            <div
              style={{
                overflowY: "auto",
                maxHeight: "56vh",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                scrollbarWidth: "none",
              }}
            >
              <button
                onClick={() => {
                  setPage(1);
                  setSelectedCategory("all");
                  setIsCategoryModalOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  backgroundColor:
                    selectedCategory === "all" ? "rgba(124,92,252,0.14)" : "var(--bg-card)",
                  color: selectedCategory === "all" ? "var(--fg)" : "var(--fg-accent)",
                  border:
                    selectedCategory === "all"
                      ? "1px solid rgba(124,92,252,0.5)"
                      : "1px solid var(--border)",
                  padding: "9px 12px",
                  borderRadius: 10,
                  fontSize: 13,
                  fontWeight: selectedCategory === "all" ? 700 : 500,
                  textAlign: "left",
                  cursor: "pointer",
                  width: "100%",
                  transition: "background 0.12s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Package size={14} color={selectedCategory === "all" ? "#7c5cfc" : "var(--fg-faint)"} style={{ flexShrink: 0 }} />
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    ทุกหมวดหมู่
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                    {posts.length} รายการ
                  </span>
                  {selectedCategory === "all" && <CheckCircle2 size={15} color="#7c5cfc" style={{ flexShrink: 0 }} />}
                </div>
              </button>

              {ITEM_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat;
                const count = posts.filter(
                  (p) => (p.category || "อื่นๆ").toLowerCase() === cat.toLowerCase()
                ).length;
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setPage(1);
                      setSelectedCategory(cat);
                      setIsCategoryModalOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 8,
                      backgroundColor: isSelected ? "rgba(124,92,252,0.14)" : "var(--bg-card)",
                      color: isSelected ? "var(--fg)" : "var(--fg-accent)",
                      border: isSelected ? "1px solid rgba(124,92,252,0.5)" : "1px solid var(--border)",
                      padding: "9px 12px",
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: isSelected ? 700 : 500,
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                      transition: "background 0.12s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <Package size={14} color={isSelected ? "#7c5cfc" : "var(--fg-faint)"} style={{ flexShrink: 0 }} />
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {cat}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>
                        {count} รายการ
                      </span>
                      {isSelected && <CheckCircle2 size={15} color="#7c5cfc" style={{ flexShrink: 0 }} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== Report Post Modal ==================== */}
      {reportPostData && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(5,4,10,0.72)",
            backdropFilter: "blur(6px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            animation: "fadeIn 0.18s ease-out",
          }}
          onClick={() => {
            setReportPostData(null);
            setReportDetail("");
            setReportCategory("เนื้อหาไม่เหมาะสม");
          }}
        >
          <div
            style={{
              backgroundColor: "var(--bg-card)",
              borderRadius: 16,
              padding: 22,
              maxWidth: 400,
              width: "100%",
              boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 50px rgba(248,113,113,0.1)",
              border: "1px solid var(--border)",
              animation: "fadeIn 0.18s ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#f87171", fontWeight: 800, fontSize: 15 }}>
                <Flag size={18} />
                รายงานโพสต์
              </div>
              <button
                onClick={() => {
                  setReportPostData(null);
                  setReportDetail("");
                  setReportCategory("เนื้อหาไม่เหมาะสม");
                }}
                style={{
                  border: "none", background: "var(--bg-hover)", cursor: "pointer",
                  color: "var(--fg-secondary)", borderRadius: "50%", width: 28, height: 28,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={15} />
              </button>
            </div>

            {/* ชื่อโพสต์ที่รายงาน */}
            <div style={{
              padding: "8px 12px", borderRadius: 8,
              backgroundColor: "var(--bg-subtle)", border: "1px solid var(--border)",
              marginBottom: 14, fontSize: 12.5, fontWeight: 600, color: "var(--fg)",
            }}>
              {reportPostData.title}
            </div>

            <form onSubmit={handleReportPost}>
              {/* เลือกหมวดหมู่ */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--fg-muted)", marginBottom: 6 }}>
                  หมวดหมู่รายงาน *
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {REPORT_CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setReportCategory(cat)}
                      style={{
                        padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                        border: "1px solid",
                        borderColor: reportCategory === cat ? "#f87171" : "var(--border)",
                        background: reportCategory === cat ? "rgba(248,113,113,0.12)" : "var(--bg-card)",
                        color: reportCategory === cat ? "#f87171" : "var(--fg-muted)",
                        cursor: "pointer",
                      }}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* รายละเอียด */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--fg-muted)", marginBottom: 6 }}>
                  รายละเอียดเพิ่มเติม (ถ้ามี)
                </label>
                <textarea
                  rows={3}
                  value={reportDetail}
                  onChange={(e) => setReportDetail(e.target.value)}
                  placeholder="อธิบายปัญหาที่พบ..."
                  style={{
                    width: "100%", padding: "10px 12px", borderRadius: 10,
                    border: "1.5px solid var(--border)", fontSize: 12, outline: "none",
                    boxSizing: "border-box", fontFamily: "inherit", resize: "none",
                    backgroundColor: "var(--bg-subtle)", color: "var(--fg)",
                  }}
                />
              </div>

              {/* ปุ่ม */}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => {
                    setReportPostData(null);
                    setReportDetail("");
                    setReportCategory("เนื้อหาไม่เหมาะสม");
                  }}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 10,
                    border: "1px solid var(--border)", backgroundColor: "var(--bg-subtle)",
                    color: "var(--fg-secondary)", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 10, border: "none",
                    backgroundColor: "#dc2626", color: "#fff",
                    fontSize: 13, fontWeight: 700, cursor: isSubmittingReport ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    opacity: isSubmittingReport ? 0.7 : 1,
                  }}
                >
                  <Send size={13} />
                  {isSubmittingReport ? "กำลังส่ง..." : "ส่งรายงาน"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ToastContainer />
    </div>
  );
}