import { useCallback, useEffect, useMemo, useState, useRef, lazy, Suspense } from "react"
import { auth, db, storage, ensureAnonymousAuth, requireAuthUid, getFirebaseMessagingIfSupported } from "./firebase"
import {
  distanceMeters,
  distanceKm,
  formatDistanceKm,
  reportsMapFingerprint,
} from "./utils/reportsRenderStability"
import {
  isReportExpired,
  normalizeLiveReports,
  reportRenderKey,
} from "./utils/reportSnapshot"
import { reportAgeColor, timeAgo } from "./utils/reportTimeLabels"

const GoogleMapView = lazy(() => import("./components/GoogleMapView"))
import type { MapTypeMode } from "./components/mapChrome/mapTypes"
import MapChromeControls from "./components/mapChrome/MapChromeControls"
import PrimaryActionSheet, {
  type ActionReportType,
} from "./components/mapChrome/PrimaryActionSheet"
import LayersSheet from "./components/mapChrome/LayersSheet"
import WeatherChip from "./components/mapChrome/WeatherChip"
import RiderConditionsSheet from "./components/mapChrome/RiderConditionsSheet"
import MarketplaceBridgeSheet from "./components/mapChrome/MarketplaceBridgeSheet"
import ReportConfirmationPanel from "./components/mapChrome/ReportConfirmationPanel"
import NearbyChip from "./components/mapChrome/NearbyChip"
import NearbyIntelligenceSheet from "./components/mapChrome/NearbyIntelligenceSheet"
import DuplicateReportSheet from "./components/mapChrome/DuplicateReportSheet"
import { useRiderWeather } from "./weather/useRiderWeather"
import { getNearbyReportCandidates } from "./nearby/nearbyIntelligence"
import {
  findLikelyDuplicateReport,
  isDuplicateEligibleCreateType,
  isReportOwnerForDuplicate,
  type DuplicateMatch,
} from "./duplicateReports/duplicateReportIntelligence"
import { DUPLICATE_COPY } from "./duplicateReports/duplicateConfig"
import { upsertReportConfirmation } from "./reportConfirmations/firestoreConfirmations"
import { canUserCastConfirmation } from "./reportConfirmations/reportConfirmations"
import { shouldShowReportByLifecycle } from "./reportLifecycle/reportLifecycle"
import { resolveCreateLocation } from "./utils/resolveCreateLocation"
import { onAuthStateChanged } from "firebase/auth"
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  deleteField,

} from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"
import { formatLebaneseLocationConcise, formatLebaneseLocationDetailed, parseNominatimToLocationInfo } from "./utils/formatLebaneseLocation"
import { storagePathFromUrlOrPath } from "./utils/storagePath"
import { NotificationPermissionSheet } from "./notifications/NotificationPermissionSheet"
import {
  evaluateNotificationSupport,
  markPromptAskedThisSession,
  resolveSettingsNotificationState,
  setSoftDismiss,
  settingsStateLabelAr,
  shouldOfferNotificationPromptAfterCreate,
  wasPromptAskedThisSession,
} from "./notifications/notificationSupport"
import { getOrCreateInstallationId } from "./notifications/installationId"
import { parseTrnSearchParams } from "./notifications/notificationPayload"
import {
  countUnresolvedByFamily,
  filterAndSortReports,
} from "./utils/reportListQuery"
import { capMapReports } from "./utils/capMapReports"
import {
  CHECKPOINT_REPORT_TYPE,
  isRoadIntelligenceReport,
  matchesReportTypeSearch,
} from "./utils/roadIntelligenceTypes"
import {
  INCIDENT_REPORT_TYPES,
  isIncidentReport,
  usesApproximateIncidentArea,
} from "./utils/incidentTypes"

type ReportItem = {
  id?: string | number
  type: string
  area: string
street?: string
city?: string
district?: string
locationName?: string
  distance: string
  lat: number
  lng: number
  ownerId?: string
  ownerUid?: string
  ownerPhone?: string
  helperId?: string
  helperUid?: string
  helperAcceptedAt?: number
  color: string
  emoji: string
  priority: string
  createdAt: number
  expiry?: number
  helperComing?: boolean
  helperArrived?: boolean
  resolved?: boolean
  solvedAt?: number
  helperStatus?: string
  helpers?: number
  joined?: boolean
helperLat?: number
helperLng?: number
helperTargetLat?: number
helperTargetLng?: number
helperMoving?: boolean
reportFamily?: string

phone?: string
helperPhone?: string
description?: string
reportImageUrl?: string
stolenBikeImageUrls?: string[]

}

async function compressImage(file: File): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()

    reader.onload = () => {
      img.src = reader.result as string
    }

    img.onload = () => {
      const canvas = document.createElement("canvas")
      const maxWidth = 900
      const scale = Math.min(maxWidth / img.width, 1)

      canvas.width = img.width * scale
      canvas.height = img.height * scale

      const ctx = canvas.getContext("2d")
      if (!ctx) {
        reject(new Error("Canvas not supported"))
        return
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Image compression failed"))
            return
          }

          resolve(
            new File([blob], file.name.replace(/\.[^/.]+$/, ".jpg"), {
              type: "image/jpeg",
              lastModified: Date.now()
            })
          )
        },
        "image/jpeg",
        0.65
      )
    }

    img.onerror = reject
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Resolve a Storage ref from a download URL or a storage path. */
function storageRefFromUrlOrPath(urlOrPath: string) {
  return ref(storage, storagePathFromUrlOrPath(urlOrPath))
}

async function deleteStorageUrl(url: string | undefined | null) {
  if (!url || typeof url !== "string") return
  try {
    await deleteObject(storageRefFromUrlOrPath(url))
  } catch (error) {
    console.warn("Could not delete report image:", error)
  }
}

async function deleteReportImage(report: any) {
  await deleteStorageUrl(report?.reportImageUrl)
  const stolen = report?.stolenBikeImageUrls
  if (Array.isArray(stolen)) {
    for (const url of stolen) {
      await deleteStorageUrl(url)
    }
  }
}

const assistanceTypes = [
  "وصلني معك",
  "ما معي بنزين",
   "محتاج دفش",
  "محتاج دفشة",
  "عطل بالدراجة"
]

const isAssistanceReport = (report:any) =>
  assistanceTypes.some(t => report.type?.includes(t))

const reportTypes = [
  { label: "بلاغ عن دراجة مسروقة", emoji: "🚨", color: "#7f1d1d", expiry: 43200, priority: "high", reportFamily: "stolen", reportCategory: "stolen" },
  { label: "زحمة", emoji: "🚗", color: "#dc2626", expiry: 15, priority: "medium", reportFamily: "intelligence", reportCategory: "traffic" },
  { label: "حادث", emoji: "⚠️", color: "#f97316", expiry: 45, priority: "high", reportFamily: "intelligence", reportCategory: "accident" },
  { label: "طريق مسكر", emoji: "⛔", color: "#1d4ed8", expiry: 45, priority: "medium", reportFamily: "intelligence", reportCategory: "road_closed" },
  { label: "طريق زلق", emoji: "🌊", color: "#06b6d4", expiry: 45, priority: "high", reportFamily: "intelligence", reportCategory: "slippery_road" },
  { ...CHECKPOINT_REPORT_TYPE },
  { label: "عطل بالدراجة", emoji: "🔧", color: "#7c3aed", expiry: 45, priority: "medium", reportFamily: "assistance", reportCategory: "bike_broken" },
  {label: "محتاج دفشة", emoji: "🛵", color: "#16a34a", expiry: 30, priority: "medium", reportFamily: "assistance", reportCategory: "push" },
  { label: "ما معي بنزين", emoji: "⛽", color: "#eab308", expiry: 30, priority: "medium", reportFamily: "assistance", reportCategory: "fuel" },
  { label: "وصلني معك", emoji: "🤝", color: "#db2777", expiry: 10, priority: "medium", reportFamily: "sharedRide", reportCategory: "ride" },
]

/** Haversine km between [lat,lng] pairs. */
function calculateDistance(from: any, to: any) {
  if (!from || !to) return null
  return distanceKm(from[0], from[1], to[0], to[1])
}

const communityBtnStyle = {
  width: "100%",
  padding: 14,
  borderRadius: 16,
  border: "1px solid #d1d5db",
  background: "#f8fafc",
  marginTop: 10,
  fontSize: 16,
  fontWeight: "bold",
};

function App() {
  // Empty until Auth is ready and the gated reports listener delivers live data.
  const [reports, setReports] = useState<ReportItem[]>([])
  const [activeReportFamily, setActiveReportFamily] = useState("all")

  const [deviceId] = useState(() => {
  let id = localStorage.getItem("deviceId")

  if (!id) {
   id = Date.now().toString() + "-" + Math.random().toString(36).slice(2)
    localStorage.setItem("deviceId", id)
  }

  return id
})

  useEffect(() => {
    getOrCreateInstallationId()
  }, [])

  // Silent Firebase Anonymous Auth — does not replace deviceId ownership.
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null)
  const [authStatus, setAuthStatus] = useState<"checking" | "ready" | "error">(
    "checking"
  )

  useEffect(() => {
    let createdNewAnonymousSession = false

    const redactUid = (uid: string) =>
      uid.length <= 8 ? "****" : `${uid.slice(0, 4)}...${uid.slice(-4)}`

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (user) {
        setFirebaseUid(user.uid)
        setAuthStatus("ready")
        if (import.meta.env.DEV) {
          const status = createdNewAnonymousSession
            ? "Created new anonymous session"
            : "Restored existing anonymous session"
          console.info(
            `[TRN Auth]\nStatus: ${status}\nUID: ${redactUid(user.uid)}`
          )
        }
        return
      }

      // Still restoring or need a new anonymous session — not ready yet.
      setAuthStatus("checking")
      createdNewAnonymousSession = true
      ensureAnonymousAuth().catch((error: unknown) => {
        setAuthStatus("error")
        setReports([])
        const message =
          error instanceof Error ? error.message : "Anonymous sign-in failed"
        console.error("[TRN Auth] Anonymous sign-in failed:", message)
      })
    })

    return () => unsubscribeAuth()
  }, [])

  // Attach reports listener only after Auth is ready (not on mount alone).
  useEffect(() => {
    if (authStatus !== "ready") {
      if (authStatus === "error") {
        setReports([])
      }
      return
    }

    const unsubscribe = onSnapshot(
      collection(db, "reports"),
      (snapshot) => {
        const liveReports: any = normalizeLiveReports(snapshot.docs)
        if (import.meta.env.DEV) {
          for (const r of liveReports) {
            console.info("[TRN Report identity]", {
              id: String(r.id ?? ""),
              surface: "snapshot",
              type: r.type ?? "",
              label: r.label ?? "",
              reportFamily: r.reportFamily ?? "",
              createdAt: r.createdAt ?? null,
              key: reportRenderKey(r),
            })
          }
        }
        setReports((prev: any) => {
          if (reportsMapFingerprint(prev) === reportsMapFingerprint(liveReports)) {
            return prev
          }
          return liveReports
        })
      },
      (error) => {
        console.error("[TRN Firestore] reports listener error:", error)
        // permission-denied / other listener failures: do not keep stale live data
        setReports([])
      }
    )

    return () => unsubscribe()
  }, [authStatus])

  const [selectedType, setSelectedType] = useState<any>(null)
  const [selectedReport, setSelectedReport] = useState<any>(null)
  useEffect(() => {
  if (!selectedReport) return

  const updatedReport = reports.find(
    (r: any) => String(r.id) === String(selectedReport.id)
  )

 if (updatedReport && !updatedReport.resolved) {
  setSelectedReport(updatedReport)
} else {
  setSelectedReport(null)
}

}, [reports, selectedReport])

  const pendingDeepLinkReportId = useRef<string | null>(
    typeof window !== "undefined"
      ? parseTrnSearchParams(window.location.search).reportId
      : null
  )

  const applyDeepLinkReportId = (reportId: string | null) => {
    if (!reportId) return false
    const found = reports.find((r: any) => String(r.id) === String(reportId))
    if (!found) return false
    setSelectedReport(found)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete("report")
      url.searchParams.delete("notification")
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
    } catch {
      /* ignore */
    }
    pendingDeepLinkReportId.current = null
    return true
  }

  const applyDeepLinkReportIdRef = useRef(applyDeepLinkReportId)
  applyDeepLinkReportIdRef.current = applyDeepLinkReportId

  useEffect(() => {
    const fromUrl = parseTrnSearchParams(window.location.search)
    if (fromUrl.reportId) {
      pendingDeepLinkReportId.current = fromUrl.reportId
    }
    if (pendingDeepLinkReportId.current) {
      applyDeepLinkReportIdRef.current(pendingDeepLinkReportId.current)
    }
  }, [reports])

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    const onSwMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.type !== "TRN_NOTIFICATION_CLICK") return
      const reportId =
        typeof data.reportId === "string" && data.reportId.trim()
          ? data.reportId.trim()
          : null
      if (!reportId) return
      pendingDeepLinkReportId.current = reportId
      if (!applyDeepLinkReportIdRef.current(reportId)) {
        // Report may still be loading; keep pending for reports effect.
      }
    }

    navigator.serviceWorker.addEventListener("message", onSwMessage)
    return () => {
      navigator.serviceWorker.removeEventListener("message", onSwMessage)
    }
  }, [])

  const [showReportModal, setShowReportModal] = useState(false)
  const [showDescriptionModal, setShowDescriptionModal] = useState(false)
  const [mapZoom, setMapZoom] = useState(12)
  const [mapTarget, setMapTarget] = useState<any>(null)
  const [showStolenModal, setShowStolenModal] = useState(false)
  const [showReportsPage, setShowReportsPage] = useState(false)
  const [showLayersSheet, setShowLayersSheet] = useState(false)
  const [showWeatherSheet, setShowWeatherSheet] = useState(false)
  const [showMarketplaceSheet, setShowMarketplaceSheet] = useState(false)
  const [showNearbySheet, setShowNearbySheet] = useState(false)
  const [showDuplicateSheet, setShowDuplicateSheet] = useState(false)
  const [duplicateMatch, setDuplicateMatch] = useState<DuplicateMatch | null>(
    null
  )
  const [pendingDuplicateCreate, setPendingDuplicateCreate] = useState<{
    typePayload: any
    coords: [number, number]
  } | null>(null)
  const [duplicateBusy, setDuplicateBusy] = useState(false)
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  const [mapTypeId, setMapTypeId] = useState<MapTypeMode>("roadmap")
  const [trafficOn, setTrafficOn] = useState(false)
  const [reportsSearch, setReportsSearch] = useState("")
  const [reportDescription, setReportDescription] = useState("")
  const [pendingReportType, setPendingReportType] = useState<any>(null)
const [stolenBikeType, setStolenBikeType] = useState("")
const [stolenBikeColor, setStolenBikeColor] = useState("")
const [stolenBikePlate, setStolenBikePlate] = useState("")
const [stolenBikePhone, setStolenBikePhone] = useState("")
const [stolenBikePlace, setStolenBikePlace] = useState("")
const [stolenBikeDate, setStolenBikeDate] = useState("")
const [stolenBikeTime, setStolenBikeTime] = useState("")

const [stolenBikeImages, setStolenBikeImages] = useState<any[]>([])
const [stolenBikeImagePreviews, setStolenBikeImagePreviews] = useState<string[]>([])
const [isSubmittingStolenBike, setIsSubmittingStolenBike] = useState(false)

const [reportImage, setReportImage] = useState<any>(null)
const [reportImagePreview, setReportImagePreview] = useState("")
const [isSubmittingReport, setIsSubmittingReport] = useState(false)

const [showContactModal, setShowContactModal] = useState(false)
const [showCommunityCenter, setShowCommunityCenter] = useState(false)
const [showLegalPage, setShowLegalPage] = useState<any>(null)
const [contactName, setContactName] = useState(localStorage.getItem("contactName") || "")
const [contactPhone, setContactPhone] = useState(localStorage.getItem("contactPhone") || "")
const [pendingAction, setPendingAction] = useState<any>(null)

const [feedbackMessage, setFeedbackMessage] = useState("")
const [sendingFeedback, setSendingFeedback] = useState(false)

const [installPrompt, setInstallPrompt] = useState<any>(null)
const [showInstallGuide, setShowInstallGuide] = useState(false)
const [showNotifPrompt, setShowNotifPrompt] = useState(false)
const [notifPromptBusy, setNotifPromptBusy] = useState(false)
const [notifPromptError, setNotifPromptError] = useState("")
const [notifSettingsTick, setNotifSettingsTick] = useState(0)

const [fullImageUrl, setFullImageUrl] = useState<string | null>(null)

const [showReportFilters, setShowReportFilters] = useState(false)
const [geoFilter, setGeoFilter] = useState("all")
const [typeFilter, setTypeFilter] = useState("all")
const [sortFilter, setSortFilter] = useState("newest")

const GPS_WRITE_DISTANCE_METERS = 50
const GPS_HEARTBEAT_MS = 30000
/** UI/map location updates — tighter than Firestore helper writes. */
const GPS_UI_DISTANCE_METERS = 12
const GPS_UI_INTERVAL_MS = 2500

const lastHelperGpsWriteAtRef = useRef(0)
const lastHelperGpsLocationRef = useRef<[number, number] | null>(null)
const lastUiGpsAtRef = useRef(0)
const lastUiGpsLocationRef = useRef<[number, number] | null>(null)

function ensureContactInfo(action: any) {
  if (contactName.trim() && contactPhone.trim()) {
    action()
    return
  }

  setPendingAction(() => action)
  setShowContactModal(true)
}

function saveContactInfo() {
  if (!contactName.trim()) {
    alert("يرجى إدخال الاسم")
    return
  }

  if (!contactPhone.trim()) {
    alert("يرجى إدخال رقم الهاتف")
    return
  }

  localStorage.setItem("contactName", contactName)
  localStorage.setItem("contactPhone", contactPhone)

  setShowContactModal(false)

  if (pendingAction) {
    pendingAction()
    setPendingAction(null)
  }
}

async function handleInstallApp() {

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true

  if (isStandalone) {
    alert("توتيموتو موجود بالفعل على هاتفك ✅")
    return
  }

  if (installPrompt) {
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
    return
  }

  setShowInstallGuide(true)
}

function openNotificationPrompt(options?: { force?: boolean }) {
  const support = evaluateNotificationSupport()
  if (support.code === "ios_requires_install") {
    setShowCommunityCenter(false)
    setShowInstallGuide(true)
    return
  }
  if (!options?.force && wasPromptAskedThisSession()) return
  markPromptAskedThisSession()
  setNotifPromptError("")
  setShowNotifPrompt(true)
}

function dismissNotificationPrompt() {
  setSoftDismiss()
  markPromptAskedThisSession()
  setShowNotifPrompt(false)
  setNotifPromptError("")
  setNotifSettingsTick((n) => n + 1)
}

async function confirmEnableNotifications() {
  if (notifPromptBusy) return
  setNotifPromptBusy(true)
  setNotifPromptError("")
  markPromptAskedThisSession()

  try {
    const support = evaluateNotificationSupport()
    if (support.code === "ios_requires_install") {
      setShowNotifPrompt(false)
      setShowInstallGuide(true)
      return
    }

    const messaging = await getFirebaseMessagingIfSupported()
    const { enableNotificationsFromUserGesture } = await import(
      "./notifications/notificationSubscription"
    )
    const result = await enableNotificationsFromUserGesture({
      messaging,
      deviceId,
    })

    if (!result.ok) {
      if (result.reason === "ios_requires_install") {
        setShowNotifPrompt(false)
        setShowInstallGuide(true)
        return
      }
      setNotifPromptError(result.messageAr)
      setNotifSettingsTick((n) => n + 1)
      return
    }

    setShowNotifPrompt(false)
    setNotifSettingsTick((n) => n + 1)
    if (result.mode === "local_pending_rules") {
      alert(
        "تم السماح بالإشعارات على هذا الجهاز. اكتمال الربط مع الخادم سيتم في التحديث القادم."
      )
    } else {
      alert("تم تفعيل الإشعارات ✅")
    }
  } finally {
    setNotifPromptBusy(false)
  }
}

async function submitFeedback() {


  if (!feedbackMessage.trim()) {
    alert("اكتب ملاحظتك أولاً")
    return
  }

  try {
    setSendingFeedback(true)

    try {
      await requireAuthUid()
    } catch (error) {
      console.error(
        "[TRN Auth] Cannot submit feedback without UID:",
        error instanceof Error ? error.message : error
      )
      alert("تعذّر التحقق من الجلسة. حاول مرة أخرى.")
      return
    }

    await addDoc(collection(db, "feedback"), {
      message: feedbackMessage.trim(),
      deviceId,
      contactName,
      contactPhone,
      createdAt: Date.now(),
      source: "beta-feedback"
    })

    setFeedbackMessage("")
    alert("شكراً لك، تم إرسال ملاحظتك بنجاح")
  } catch (error: any) {
    if (import.meta.env.DEV) {
      console.error("[TRN Feedback]", error?.code || error)
    } else {
      console.error("[TRN Feedback] write failed")
    }
    alert(
      error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied"
        ? "ليس لديك صلاحية لإرسال الملاحظة. أعد فتح التطبيق ثم حاول مرة أخرى."
        : "تعذّر إرسال الملاحظة، حاول مرة أخرى"
    )
  } finally {
    setSendingFeedback(false)
  }
}

async function submitStolenBikeReport() {
  if (isSubmittingStolenBike) return
  setIsSubmittingStolenBike(true)

  try {
 ;(document.activeElement as HTMLElement)?.blur()

let ownerUid: string
try {
  ownerUid = await requireAuthUid()
} catch (error) {
  console.error("[TRN Auth] Cannot create stolen report without UID:", error instanceof Error ? error.message : error)
  alert("تعذّر التحقق من الجلسة. حاول مرة أخرى.")
  return
}

const located = await resolveCreateLocation({ existing: myLocation })
if (located.coords) {
  setMyLocation(located.coords)
}
const reportLat = located.coords ? located.coords[0] : 33.8938
const reportLng = located.coords ? located.coords[1] : 35.5018

const locationInfo = await getAddressFromCoords(reportLat, reportLng)

let stolenBikeImageUrls: string[] = []

if (stolenBikeImages.length > 0) {
for (const image of stolenBikeImages) {
  const imageRef = ref(
    storage,
    `stolen-bikes/${Date.now()}-${image.name}`
  )

  await uploadBytes(imageRef, image)

  const downloadUrl = await getDownloadURL(imageRef)
  stolenBikeImageUrls.push(downloadUrl)
}
}

     const reportData = {
      id: Date.now(),

      type: "بلاغ عن دراجة مسروقة",
      reportFamily: "stolen",
      reportCategory: "stolen",
      emoji: "🚨",
      priority: "high",
      ownerId: deviceId,
      ownerUid,

area: locationInfo.area,
street: locationInfo.street,
city: locationInfo.city,
district: locationInfo.district,
locationName: locationInfo.locationName,

  lat: reportLat,
  lng: reportLng,
distance: "الآن",
color: "#7f1d1d",
expiry: 43200,
helperComing: false,
helperArrived: false,
helpers: 0,
resolved: false,

      stolenBikeType,
      stolenBikeColor,
      stolenBikePlate,
      stolenBikePhone,
      stolenBikePlace,
      stolenBikeDate,
      stolenBikeTime,

stolenBikeImageUrls,

      createdAt: Date.now()
    }



    await addDoc(
      collection(db, "reports"),
      reportData
    )

    setShowStolenModal(false)

    setTimeout(() => {
  window.dispatchEvent(new Event("resize"))
}, 300)

    alert("✅ تم نشر البلاغ")
}
catch (error: any) {
  if (import.meta.env.DEV) {
    console.error("[TRN Stolen Create]", error?.code || error)
  } else {
    console.error("[TRN Stolen Create] write failed")
  }

  alert(
    error?.code === "permission-denied" ||
      error?.code === "firestore/permission-denied"
      ? "ليس لديك صلاحية لنشر البلاغ. أعد فتح التطبيق ثم حاول مرة أخرى."
      : "❌ فشل نشر البلاغ. حاول مرة أخرى."
  )
} finally {
  setIsSubmittingStolenBike(false)
}
}

async function helperRespond(report: any) {


  try {
   let helperUid: string
   try {
     helperUid = await requireAuthUid()
   } catch (error) {
     console.error("[TRN Auth] Cannot claim report without UID:", error instanceof Error ? error.message : error)
     alert("تعذّر التحقق من الجلسة. حاول مرة أخرى.")
     return
   }

   await updateDoc(doc(db, "reports", (report.id)), {
helperComing: true,
helperStatus: "مساعد بالطريق",
helpers: 1,
joined: true,
helperId: deviceId,
helperUid,
helperPhone: contactPhone,
helperName: localStorage.getItem("contactName") || "",
helperLat: myLocation ? myLocation[0] : null,
helperLng: myLocation ? myLocation[1] : null,
helperLocationUpdatedAt: Date.now(),

helperAcceptedAt: Date.now()
    })

  setSelectedReport({
  ...report,
  helperComing: true,
  joined: true,
  helperId: deviceId,
  helperUid,
  helperPhone: contactPhone,
  helperName: localStorage.getItem("contactName") || "",
  helperLat: myLocation ? myLocation[0] : null,
  helperLng: myLocation ? myLocation[1] : null
})

  } catch (error) {
    console.error(error)
    alert("❌ فشل تحديث المساعدة")
  }
}

async function cancelReport(report: any) {
  try {

    await deleteReportImage(report)

    await deleteDoc(doc(db, "reports", String(report.id)))

    setSelectedReport(null)
    alert("تم إلغاء الطلب ❌")
  } catch (error) {
    console.error(error)
    alert("❌ فشل إلغاء الطلب")
  }
}

async function resolveReport(report: any) {
  try {
    await updateDoc(doc(db, "reports", String(report.id)), {
      resolved: true,
      solvedAt: Date.now()
    })

    setSelectedReport(null)
  } catch (error) {
    console.error(error)
    alert("❌ فشل إنهاء الطلب")
  }
}

async function cancelHelp(report: any) {
  try {
    // Reopen claim slot; clear all helper identity/contact/location residue.
    // helperId stays "" for legacy UI checks (helperId === deviceId / emptiness).
    // Optional/new helper fields use deleteField() so no stale ownership or GPS remains.
    await updateDoc(doc(db, "reports", String(report.id)), {
      helperComing: false,
      helperStatus: "",
      helpers: 0,
      joined: false,
      helperArrived: false,
      helperId: "",
      helperUid: deleteField(),
      helperName: deleteField(),
      helperPhone: deleteField(),
      helperLat: deleteField(),
      helperLng: deleteField(),
      helperLocationUpdatedAt: deleteField(),
      helperAcceptedAt: deleteField(),
    })

setSelectedReport({
  ...report,
  helperComing: false,
  helperStatus: "",
  helpers: 0,
  joined: false,
  helperArrived: false,
  helperId: "",
  helperUid: undefined,
  helperName: undefined,
  helperPhone: undefined,
  helperLat: null,
  helperLng: null,
  helperLocationUpdatedAt: undefined,
  helperAcceptedAt: null,
})


  } catch (error) {
    console.error(error)
    alert("❌ فشل إلغاء المساعدة")
  }
}

useEffect(() => {
  const handleBeforeInstallPrompt = (e: any) => {
    e.preventDefault()
    setInstallPrompt(e)
  }

  window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)

  return () => {
    window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
  }
}, [])

  useEffect(() => {
  const timer = setInterval(() => {
    setReports((prev: any) => {
      let changed = false
      const next = prev.map((item: any) => {
        if (!item.moving) return item
        changed = true
        return {
          ...item,
          lat: item.lat + (item.targetLat - item.lat) * 0.35,
          lng: item.lng + (item.targetLng - item.lng) * 0.35,
        }
      })
      return changed ? next : prev
    })
  }, 1000)

  return () => clearInterval(timer)
}, [])


function canReceiveHelp(report: any) {
  return isAssistanceReport(report)
}

const needsHelper = selectedReport ? isAssistanceReport(selectedReport) : false

const showMapChrome =
  !showReportsPage &&
  !showReportModal &&
  !showLayersSheet &&
  !showWeatherSheet &&
  !showMarketplaceSheet &&
  !showNearbySheet &&
  !showDuplicateSheet &&
  !showStolenModal &&
  !showDescriptionModal &&
  !showContactModal &&
  !showCommunityCenter &&
  !selectedReport

const roadActionTypes = reportTypes.filter(
  (t) => t.reportFamily === "intelligence"
) as ActionReportType[]
const helpActionTypes = reportTypes.filter(
  (t) => t.reportFamily === "assistance" || t.reportFamily === "sharedRide"
) as ActionReportType[]
const incidentActionTypes = INCIDENT_REPORT_TYPES.map((t) => ({
  label: t.label,
  emoji: t.emoji,
  color: t.color,
  expiry: t.expiry,
  priority: t.priority,
  reportFamily: t.reportFamily,
  reportCategory: t.reportCategory,
})) as ActionReportType[]
const stolenActionType =
  (reportTypes.find((t) => t.reportFamily === "stolen") as
    | ActionReportType
    | undefined) ?? null

function handlePrimaryActionSelect(type: ActionReportType) {
  if (type.reportFamily === "stolen" || type.label.includes("مسروقة")) {
    setShowReportModal(false)
    setShowStolenModal(true)
    return
  }
  if (type.reportFamily === "assistance" || type.reportFamily === "sharedRide") {
    ensureContactInfo(() => {
      setShowReportModal(false)
      setPendingReportType(type)
      setShowDescriptionModal(true)
    })
    return
  }
  setShowReportModal(false)
  setPendingReportType(type)
  setShowDescriptionModal(true)
}

function handleLocateMe() {
  refreshGps()
  if (myLocation) {
    setMapTarget([myLocation[0], myLocation[1]])
    setMapZoom(16)
  }
}

/** Open Google Maps turn-by-turn navigation to report coords (no Directions API). */
function openReportNavigation(
  lat: unknown,
  lng: unknown,
  locationLabel?: string
) {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    alert("موقع البلاغ غير متوفر")
    return
  }
  const destination = `${lat},${lng}`
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
  // Keep coords as destination; label is for rider context only (share / UI).
  void locationLabel
  window.open(url, "_blank")
}

/** Reuse existing fly-to / mapTarget navigation path. */
function centerMapOnReport(lat: unknown, lng: unknown) {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    alert("موقع البلاغ غير متوفر")
    return
  }
  setMapTarget([lat, lng])
  setMapZoom(15)
}

/** Share Google Maps pin link via Web Share API, or copy to clipboard. */
async function shareReportLocation(
  lat: unknown,
  lng: unknown,
  report?: { type?: string; locationName?: string; street?: string; district?: string; city?: string; area?: string }
) {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    alert("موقع البلاغ غير متوفر")
    return
  }

  const url = `https://www.google.com/maps?q=${lat},${lng}`
  const place = formatLebaneseLocationDetailed(report || {})
  const typeLabel = report?.type?.trim() || "بلاغ"
  const title = `${typeLabel} — Totimoto`
  const text = place ? `${typeLabel} • ${place}` : title

  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({ title, text, url })
      return
    }
  } catch (error: any) {
    if (error?.name === "AbortError") return
  }

  try {
    await navigator.clipboard.writeText(`${text}\n${url}`)
    alert("تم نسخ رابط الموقع")
  } catch {
    window.prompt("انسخ رابط الموقع:", `${text}\n${url}`)
  }
}

const riderActionBtnStyle = {
  width: "100%",
  padding: "10px 6px",
  borderRadius: 12,
  border: "none",
  background: "#0f172a",
  color: "white",
  fontWeight: "bold" as const,
  fontSize: 12,
  cursor: "pointer",
  lineHeight: 1.25,
}

function renderRiderActionBar(report: any) {
  const placeLabel = formatLebaneseLocationConcise(report)
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 6,
        marginTop: 12,
        marginBottom: 8,
        direction: "rtl",
        width: "100%",
      }}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          openReportNavigation(report.lat, report.lng, placeLabel)
        }}
        style={riderActionBtnStyle}
        title={placeLabel}
      >
        🧭 توجيه
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          centerMapOnReport(report.lat, report.lng)
        }}
        style={riderActionBtnStyle}
      >
        📍 توسيط
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          void shareReportLocation(report.lat, report.lng, report)
        }}
        style={riderActionBtnStyle}
      >
        📤 مشاركة
      </button>
    </div>
  )
}

async function getAddressFromCoords(lat: number, lng: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`
    )

    const data = await response.json()
    return parseNominatimToLocationInfo(data)
  } catch (error) {
    console.error("Reverse geocoding failed:", error)

    return {
      street: "",
      area: "موقع البلاغ",
      city: "",
      district: "",
      locationName: "موقع البلاغ"
    }
  }
}


async function addReport(type: any) {


if (type.label.includes("مسروقة")) {
  setShowReportModal(false)
  setShowStolenModal(true)
  return
}

  if (!myLocation) return

const locationInfo = await getAddressFromCoords(myLocation[0], myLocation[1])

  const newReport = {
    ownerId: deviceId,
    type: type.label,
    area: locationInfo.area,
street: locationInfo.street,
city: locationInfo.city,
district: locationInfo.district,
locationName: locationInfo.locationName,
    distance: "الآن",
    lat: myLocation[0],
    lng: myLocation[1],
    color: type.color,
    emoji: type.emoji,
    reportFamily: type.reportFamily,
    reportCategory: type.reportCategory,

    createdAt: Date.now(),
    expiry:
type.label === "زحمة" ? 30 :
type.label === "حادث" ? 60 :
type.label === "طريق مسكر" ? 120 :
type.label === "ما معي بنزين" ? 20 :
type.label === "محتاج دفشة" ? 45 :
type.label === "عطل بالدراجة" ? 60 :
type.label === "وصّلني معك" ? 20 :
  45,
    helpers: 0,
    helpersList: [],
helperComing: false,
  }

 addDoc(collection(db, "reports"), newReport)
}

  const [myLocation, setMyLocation] = useState<[number, number] | null>(null)
  const {
    weather: riderWeather,
    errorMessage: weatherErrorMessage,
    refresh: refreshRiderWeather,
    status: weatherStatus,
  } = useRiderWeather(myLocation)

  // DEV-only visibility diagnostics (no coords/secrets).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const secure =
      typeof window !== "undefined" ? window.isSecureContext : false
    console.info(
      `[TRN DEV] location: ${myLocation ? "available" : "unavailable"} | secureContext: ${secure}`
    )
  }, [myLocation])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.info(
      `[TRN DEV] weather: ${weatherStatus}${
        weatherErrorMessage ? " | error" : ""
      }`
    )
  }, [weatherStatus, weatherErrorMessage])

  const isActivelyHelping = useMemo(
    () =>
      reports.some(
        (r: any) =>
          r.helperId === deviceId && r.helperComing && !r.resolved
      ),
    [reports, deviceId]
  )

  useEffect(() => {
  const interval = setInterval(() => {
    setReports((currentReports: any) => {
      const next = currentReports.filter(
        (report: any) => !isReportExpired(report)
      )
      return next.length === currentReports.length ? currentReports : next
    })
  }, 30000)

  return () => clearInterval(interval)
}, [])

useEffect(() => {
  if (!myLocation) return

  const activeHelp = reports.find((r: any) =>
    r.helperId === deviceId &&
    r.helperComing &&
    !r.resolved
  )

  if (!activeHelp) {
    lastHelperGpsWriteAtRef.current = 0
    lastHelperGpsLocationRef.current = null
    return
  }

  const now = Date.now()
  const lastWriteAt = lastHelperGpsWriteAtRef.current
  const lastLocation = lastHelperGpsLocationRef.current

  const secondsPassed = now - lastWriteAt >= GPS_HEARTBEAT_MS

  const movedMeters = lastLocation
    ? distanceMeters(
        lastLocation[0],
        lastLocation[1],
        myLocation[0],
        myLocation[1]
      )
    : GPS_WRITE_DISTANCE_METERS

  const movedEnough = movedMeters >= GPS_WRITE_DISTANCE_METERS

  if (!secondsPassed && !movedEnough) return

const activeHelpId = String(activeHelp.id)

async function updateHelperGps() {
  try {
   await updateDoc(doc(db, "reports", activeHelpId), {
        helperLat: myLocation[0],
        helperLng: myLocation[1],
        helperLocationUpdatedAt: now,
      })

      lastHelperGpsWriteAtRef.current = now
      lastHelperGpsLocationRef.current = myLocation
    } catch (error) {
      console.error("Failed to update smart helper GPS", error)
    }
  }

  updateHelperGps()
}, [myLocation, reports, deviceId])

useEffect(() => {
  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      const next: [number, number] = [
        position.coords.latitude,
        position.coords.longitude,
      ]
      const now = Date.now()
      const last = lastUiGpsLocationRef.current
      const elapsed = now - lastUiGpsAtRef.current
      const moved = last
        ? distanceMeters(last[0], last[1], next[0], next[1])
        : GPS_UI_DISTANCE_METERS

      if (
        !last ||
        moved >= GPS_UI_DISTANCE_METERS ||
        elapsed >= GPS_UI_INTERVAL_MS
      ) {
        lastUiGpsAtRef.current = now
        lastUiGpsLocationRef.current = next
        setMyLocation(next)
      }
    },
(error) => {
  if (import.meta.env.DEV) {
    const secure =
      typeof window !== "undefined" ? window.isSecureContext : false
    console.info(
      `[TRN DEV] GPS error code=${(error as GeolocationPositionError)?.code ?? "?"} secureContext=${secure}`
    )
  } else {
    console.log("GPS error:", error)
  }
},
    {
      enableHighAccuracy: isActivelyHelping,
      maximumAge: isActivelyHelping ? 5000 : 15000,
      timeout: 10000,
    }
  )

  return () => navigator.geolocation.clearWatch(watchId)
}, [isActivelyHelping])

const refreshGps = () => {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setMyLocation([
        position.coords.latitude,
        position.coords.longitude,
      ])
    },
    (error) => {
      console.log("Manual GPS refresh error:", error)
    },
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000,
    }
  )
}

  function sendReport() {
    if (!selectedType || !myLocation) return

    const newReport = {
      type: selectedType.label,
      area: "موقعك الحالي",
      distance: "الآن",
      lat: myLocation[0],
      lng: myLocation[1],
      color: selectedType.color,
      emoji: selectedType.emoji,
      priority: selectedType.priority,
      createdAt: Date.now(),
      expiry: selectedType.expiry,
    }

    setReports([newReport, ...reports])
    setSelectedType(null)
  }

async function createUserReport(
  type: any,
  options?: { preResolvedCoords?: [number, number] }
): Promise<boolean> {
try {
let ownerUid: string
try {
  ownerUid = await requireAuthUid()
} catch (error) {
  console.error("[TRN Auth] Cannot create report without UID:", error instanceof Error ? error.message : error)
  alert("تعذّر التحقق من الجلسة. حاول مرة أخرى.")
  return false
}

let lat: number
let lng: number
if (
  options?.preResolvedCoords &&
  Number.isFinite(options.preResolvedCoords[0]) &&
  Number.isFinite(options.preResolvedCoords[1])
) {
  lat = options.preResolvedCoords[0]
  lng = options.preResolvedCoords[1]
  setMyLocation([lat, lng])
} else {
  const located = await resolveCreateLocation({ existing: myLocation })
  if (located.coords) {
    setMyLocation(located.coords)
  }
  lat = located.coords ? located.coords[0] : 33.8938
  lng = located.coords ? located.coords[1] : 35.5018
}
const locationInfo = await getAddressFromCoords(lat, lng)

let reportImageUrl = ""

if (reportImage) {
  const imageRef = ref(
    storage,
    `report-images/${Date.now()}-${reportImage.name}`
  )

  await uploadBytes(imageRef, reportImage)

  reportImageUrl = await getDownloadURL(imageRef)
}

  const newReport = {
      phone: contactPhone,
ownerPhone: contactPhone,
ownerName: contactName,
      description: type.description || "",
      reportImageUrl,
    ...type,
type: type.label,
color: type.color,
emoji: type.emoji,
priority: type.priority,
expiry: type.expiry,
helperComing: false,
helperArrived: false,
helpers: 0,
helpersList: [],
resolved: false,

area: locationInfo.area,
street: locationInfo.street,
city: locationInfo.city,
district: locationInfo.district,
locationName: locationInfo.locationName,
distance: "مباشر",
   lat,
   lng,
    ownerId: deviceId,
    ownerUid,
    createdAt: Date.now(),
  }

await addDoc(collection(db, "reports"), newReport)

setReportImage(null)
setReportImagePreview("")
setShowReportModal(false)
setReportDescription("")
setPendingReportType(null)
return true
} catch (error: any) {
  if (import.meta.env.DEV) {
    console.error("[TRN Create]", error?.code || error)
  } else {
    console.error("[TRN Create] write failed")
  }
  alert(
    error?.code === "permission-denied" ||
      error?.code === "firestore/permission-denied"
      ? "ليس لديك صلاحية لنشر البلاغ. أعد فتح التطبيق ثم حاول مرة أخرى."
      : "تعذّر نشر البلاغ. حاول مرة أخرى."
  )
  return false
} finally {
  setIsSubmittingReport(false)
}
}

const familyCounts = useMemo(
  () => countUnresolvedByFamily(reports),
  [reports]
)
const intelligenceCount = familyCounts.intelligence
const assistanceCount = familyCounts.assistance
const sharedRideCount = familyCounts.sharedRide
const stolenCount = familyCounts.stolen
const incidentCount = familyCounts.incident

const visibleReports = useMemo(
  () =>
    reports
      .filter((r: any) => {
        if (r.resolved) return false
        if (activeReportFamily !== "all" && r.reportFamily !== activeReportFamily) {
          return false
        }
        // Task 056 — soft-hide likely-gone after grace (aggregates only; no N+1).
        return shouldShowReportByLifecycle(r, {
          selectedReportId: selectedReport?.id,
          viewerDeviceId: deviceId,
          viewerUid: firebaseUid,
        })
      })
      .sort((a: any, b: any) => {
        if (a.ownerId === deviceId && b.ownerId !== deviceId) return -1
        if (a.ownerId !== deviceId && b.ownerId === deviceId) return 1
        return 0
      }),
  [reports, activeReportFamily, deviceId, firebaseUid, selectedReport?.id]
)

const listedReports = useMemo(
  () =>
    filterAndSortReports(visibleReports, {
      geoFilter,
      sortFilter,
      myLocation,
    }).filter((r) => matchesReportTypeSearch(r, reportsSearch)),
  [visibleReports, geoFilter, sortFilter, myLocation, reportsSearch]
)

/** Cap map markers for large datasets; list view stays uncapped. */
const MAP_MARKER_CAP = 400
const mapReports = useMemo(
  () =>
    capMapReports(visibleReports, {
      cap: MAP_MARKER_CAP,
      deviceId,
      selectedId: selectedReport?.id,
      userLocation: myLocation,
    }),
  [visibleReports, deviceId, selectedReport?.id, myLocation]
)

const nearbyCandidates = useMemo(() => {
  if (!myLocation) return []
  return getNearbyReportCandidates({
    reports: visibleReports,
    rider: { lat: myLocation[0], lng: myLocation[1] },
  })
}, [visibleReports, myLocation])

useEffect(() => {
  if (!import.meta.env.DEV) return
  console.info(`[TRN DEV] nearby candidates: ${nearbyCandidates.length}`)
}, [nearbyCandidates.length])

const handleNearbySelect = useCallback(
  (candidate: { id: string; report: any }) => {
    setShowNearbySheet(false)
    const report =
      visibleReports.find((r: any) => String(r.id) === candidate.id) ??
      candidate.report
    setSelectedReport(report)
    centerMapOnReport(report.lat, report.lng)
  },
  [visibleReports]
)

const duplicateIsOwn = useMemo(() => {
  if (!duplicateMatch) return false
  return isReportOwnerForDuplicate(duplicateMatch.report, {
    currentUid: firebaseUid,
    deviceId,
  })
}, [duplicateMatch, firebaseUid, deviceId])

const clearDuplicateFlow = useCallback(() => {
  setShowDuplicateSheet(false)
  setDuplicateMatch(null)
  setPendingDuplicateCreate(null)
  setDuplicateError(null)
  setDuplicateBusy(false)
}, [])

const handleDuplicateView = useCallback(() => {
  if (!duplicateMatch) return
  const report =
    visibleReports.find((r: any) => String(r.id) === duplicateMatch.id) ??
    duplicateMatch.report
  clearDuplicateFlow()
  setShowReportModal(false)
  setShowDescriptionModal(false)
  setSelectedReport(report)
  centerMapOnReport(report.lat, report.lng)
}, [duplicateMatch, visibleReports, clearDuplicateFlow])

const handleDuplicateConfirmPresent = useCallback(async () => {
  if (!duplicateMatch || duplicateBusy) return
  if (duplicateIsOwn) return

  setDuplicateBusy(true)
  setDuplicateError(null)
  try {
    let uid: string
    try {
      uid = await requireAuthUid()
    } catch {
      setDuplicateError(DUPLICATE_COPY.authNotReady)
      return
    }

    const live =
      visibleReports.find((r: any) => String(r.id) === duplicateMatch.id) ??
      null
    if (!live || isReportExpired(live)) {
      setDuplicateError(DUPLICATE_COPY.candidateGone)
      return
    }

    if (
      !canUserCastConfirmation({
        report: live,
        currentUid: uid,
      })
    ) {
      setDuplicateError(DUPLICATE_COPY.confirmFailed)
      return
    }

    await upsertReportConfirmation({
      db,
      reportId: String(live.id),
      uid,
      status: "present",
    })

    clearDuplicateFlow()
    setShowReportModal(false)
    setShowDescriptionModal(false)
    setSelectedReport(live)
    centerMapOnReport(live.lat, live.lng)
  } catch {
    setDuplicateError(DUPLICATE_COPY.confirmFailed)
  } finally {
    setDuplicateBusy(false)
  }
}, [
  duplicateMatch,
  duplicateBusy,
  duplicateIsOwn,
  visibleReports,
  clearDuplicateFlow,
])

const handleDuplicateCreateAnyway = useCallback(async () => {
  if (!pendingDuplicateCreate || isSubmittingReport || duplicateBusy) return
  setDuplicateBusy(true)
  setDuplicateError(null)
  setIsSubmittingReport(true)
  try {
    const { typePayload, coords } = pendingDuplicateCreate
    // Same cached coords — no second GPS request.
    const ok = await createUserReport(typePayload, {
      preResolvedCoords: coords,
    })
    if (ok) {
      clearDuplicateFlow()
      setReportDescription("")
      setShowDescriptionModal(false)
      setShowReportModal(false)
      if (
        shouldOfferNotificationPromptAfterCreate({
          reportFamily: typePayload?.reportFamily,
        })
      ) {
        openNotificationPrompt()
      }
    }
  } finally {
    setDuplicateBusy(false)
    setIsSubmittingReport(false)
  }
}, [pendingDuplicateCreate, isSubmittingReport, duplicateBusy, clearDuplicateFlow])

const handleGoogleReportSelect = useCallback(
  (r: any) => {
    const family = r.reportFamily

    // Road intelligence & incidents are viewable on the map (no helper claim loop).
    if (isRoadIntelligenceReport(r) || isIncidentReport(r)) {
      setSelectedReport(r)
      return
    }

    // Own open assistance/ride stays list-managed until claimed.
    if (
      r.ownerId === deviceId &&
      !r.helperComing &&
      (family === "assistance" || family === "sharedRide" || isAssistanceReport(r))
    ) {
      return
    }

    setSelectedReport(r)
  },
  [deviceId]
)

  return (
    <>

{fullImageUrl && (
  <div
    onClick={() => setFullImageUrl(null)}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.9)",
      zIndex: 999999,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: 20
    }}
  >
    <button
      onClick={(e) => {
        e.stopPropagation()
        setFullImageUrl(null)
      }}
      style={{
        position: "absolute",
        top: 20,
        right: 20,
        width: 44,
        height: 44,
        border: "none",
        borderRadius: "50%",
        background: "white",
        color: "black",
        fontSize: 26,
        fontWeight: "bold",
        cursor: "pointer"
      }}
    >
      ×
    </button>

    <img
      src={fullImageUrl}
      alt="Full Report"
      onClick={(e) => e.stopPropagation()}
      style={{
        maxWidth: "95%",
        maxHeight: "90%",
        objectFit: "contain",
        borderRadius: 12
      }}
    />
  </div>
)}

    <div style={{ height: "100dvh", width: "100%", background: "#020617", direction: "rtl", fontFamily: "Arial", position: "relative", overflow: "hidden" }}>
{authStatus === "error" && (
  <div
    style={{
      position: "absolute",
      top: 12,
      left: 12,
      right: 12,
      zIndex: 5000,
      background: "#7f1d1d",
      color: "white",
      borderRadius: 12,
      padding: "10px 12px",
      fontSize: 13,
      fontWeight: "bold",
      textAlign: "center",
      boxShadow: "0 8px 20px rgba(0,0,0,.35)",
    }}
  >
    تعذّر تسجيل الدخول. أعد فتح التطبيق أو تحقق من الاتصال.
  </div>
)}
{(() => {
  const mapFallback = (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#e2e8f0",
        background: "#0b1220",
        direction: "rtl",
      }}
    >
      جارٍ تحميل الخريطة...
    </div>
  )

  return (
    <Suspense fallback={mapFallback}>
      <div style={{ height: "100%", width: "100%" }}>
        <GoogleMapView
          userLocation={myLocation}
          reports={mapReports}
          selectedReportId={selectedReport?.id ?? null}
          mapTarget={mapTarget}
          mapZoom={mapZoom}
          onReportSelect={handleGoogleReportSelect}
          mapTypeId={mapTypeId}
          trafficOn={trafficOn}
        />
      </div>
    </Suspense>
  )
})()}

<MapChromeControls
  visible={showMapChrome}
  onOpenLayers={() => setShowLayersSheet(true)}
  onLocate={handleLocateMe}
  onOpenList={() => setShowReportsPage(true)}
  onOpenAction={() => setShowReportModal(true)}
  onOpenSettings={() => setShowCommunityCenter(true)}
/>

<WeatherChip
  visible={showMapChrome}
  weather={riderWeather}
  onOpen={() => setShowWeatherSheet(true)}
/>

<NearbyChip
  visible={showMapChrome}
  count={nearbyCandidates.length}
  stackBelowWeather={
    !!(riderWeather && riderWeather.temperatureC != null)
  }
  onOpen={() => setShowNearbySheet(true)}
/>

<NearbyIntelligenceSheet
  open={showNearbySheet}
  candidates={nearbyCandidates}
  onClose={() => setShowNearbySheet(false)}
  onSelect={handleNearbySelect}
/>

<DuplicateReportSheet
  open={showDuplicateSheet}
  match={duplicateMatch}
  isOwnReport={duplicateIsOwn}
  busy={duplicateBusy}
  errorMessage={duplicateError}
  onConfirmPresent={() => {
    void handleDuplicateConfirmPresent()
  }}
  onViewReport={handleDuplicateView}
  onCreateAnyway={() => {
    void handleDuplicateCreateAnyway()
  }}
  onClose={clearDuplicateFlow}
/>

<LayersSheet
  open={showLayersSheet}
  mapTypeId={mapTypeId}
  trafficOn={trafficOn}
  onMapTypeIdChange={setMapTypeId}
  onTrafficOnChange={setTrafficOn}
  onClose={() => setShowLayersSheet(false)}
/>

<RiderConditionsSheet
  open={showWeatherSheet}
  weather={riderWeather}
  errorMessage={weatherErrorMessage}
  refreshing={weatherStatus === "loading"}
  onRefresh={refreshRiderWeather}
  onClose={() => setShowWeatherSheet(false)}
/>

<PrimaryActionSheet
  open={showReportModal}
  roadTypes={roadActionTypes}
  helpTypes={helpActionTypes}
  incidentTypes={incidentActionTypes}
  stolenType={stolenActionType}
  onSelectType={handlePrimaryActionSelect}
  onOpenMarketplace={() => {
    setShowReportModal(false)
    setShowMarketplaceSheet(true)
  }}
  onClose={() => setShowReportModal(false)}
/>

<MarketplaceBridgeSheet
  open={showMarketplaceSheet}
  onClose={() => setShowMarketplaceSheet(false)}
/>

{showReportsPage && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "#ffffff",
      zIndex: 99999,
      overflowY: "auto",
      padding: 16
    }}
  >

    {/* Header */}
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 20
      }}
    >
      <h2
        style={{
          margin: 0,
          fontSize: 24,
          fontWeight: "bold"
        }}
      >
        البلاغات
      </h2>

      <button
        onClick={() => setShowReportsPage(false)}
        style={{
          border: "none",
          background: "transparent",
          fontSize: 28,
          cursor: "pointer"
        }}
      >
        ✕
      </button>
    </div>

{/* Professional Mini Filter Tabs */}
<div
  style={{
    display: "grid",
   gridTemplateColumns: "repeat(5, 1fr)",
    gap: 8,
    marginBottom: 16
  }}
>
  {[
    ["🌍", "الكل", reports.length],
    ["🚨", "مسروقة", stolenCount],
    ["⚠️", "حدث", incidentCount],
    ["⚠️", "حادث", reports.filter((r:any) => r.type === "حادث").length],
    ["🚗", "زحمة", reports.filter((r:any) => r.type === "زحمة").length],
    ["⛔", "مسكر", reports.filter((r:any) => r.type === "طريق مسكر").length],
    ["🌊", "زلق", reports.filter((r:any) => r.type === "طريق زلق").length],
    ["🛂", "حاجز", reports.filter((r:any) => r.type === "حاجز" || r.reportCategory === "checkpoint").length],
    ["🔧", "عطل", reports.filter((r:any) => r.type === "عطل بالدراجة").length],
    ["⛽", "بنزين", reports.filter((r:any) => r.type === "ما معي بنزين").length],
    ["🤝", "وصلني معك", reports.filter((r:any) => r.type === "وصلني معك").length],
    ["🛵", "محتاج دفشة", reports.filter((r:any) => r.type === "محتاج دفشة").length],

  ].map((tab:any) => (
<button
  key={tab[1]}
  onClick={() => {
    setReportsSearch(tab[1] === "الكل" ? "" : tab[1])
  }}
  style={{

        background: reportsSearch === tab[1] || (reportsSearch === "" && tab[1] === "الكل") ?  "#020617" : "#ffffff",
color: reportsSearch === tab[1] || (reportsSearch === "" && tab[1] === "الكل") ? "white" : tab[3],
border: reportsSearch === tab[1] || (reportsSearch === "" && tab[1] === "الكل") ? `2px solid ${tab[3]}` : "1px solid #e5e7eb",
boxShadow: reportsSearch === tab[1] || (reportsSearch === "" && tab[1] === "الكل") ? `0 0 14px ${tab[3]}66` : "0 2px 8px rgba(0,0,0,.06)",
transform: reportsSearch === tab[1]
  ? "scale(1.05)"
  : "scale(1)",

transition: "all .2s ease",

        borderRadius: 10,
        padding: "2px",
        fontWeight: "bold",
        fontSize: 10,
        height: 38,

      }}
    >
<div
  style={{
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 4
  }}
>
  <span style={{ fontSize: 12 }}>{tab[0]}</span>
  <span>{tab[1]}</span>
  <span
    style={{
      color: tab[1] === "الكل" ? "white" : "#2563eb"
    }}
  >
    {tab[2]}
  </span>
</div>
    </button>
  ))}
</div>

{/* Reports Filter Panel */}
<div style={{
  background: "white",
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  marginBottom: 14,
  padding: 12,
  boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  direction: "rtl"
}}>
  <button
    onClick={() => setShowReportFilters(!showReportFilters)}
    style={{
      width: "100%",
      padding: "12px 14px",
      borderRadius: 12,
      border: "none",
      background: "#020617",
      color: "white",
      fontWeight: "bold",
      fontSize: 15,
      cursor: "pointer"
    }}
  >
    🔎 فلترة البلاغات {showReportFilters ? "▲" : "▼"}
  </button>

  {showReportFilters && (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: "bold", marginBottom: 8 }}>📍 المنطقة</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {[
          ["all", "⬜ الكل"],
          ["near", "📍 قريب مني"],
          ["beirut", "🟦 بيروت"],
          ["mount", "🟩 جبل لبنان"],
          ["north", "🟨 الشمال"],
          ["bekaa", "🟧 البقاع"],
          ["south", "🟥 الجنوب"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setGeoFilter(value)}
            style={{
              padding: "8px 10px",
              borderRadius: 999,
              border: geoFilter === value ? "2px solid #2563eb" : "1px solid #e5e7eb",
              background: geoFilter === value ? "#eff6ff" : "white",
              color: "#020617",
              fontWeight: "bold",
              fontSize: 12,
              cursor: "pointer"
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ fontWeight: "bold", marginBottom: 8 }}>📂 النوع</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
        {[
          ["all", "🌍 الكل"],
          ["roads", "🛣️ الطرق"],
          ["help", "🤝 مساعدة"],
          ["ride", "🏍️ وصلني"],
          ["stolen", "🚨 مسروقة"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTypeFilter(value)}
            style={{
              padding: "8px 10px",
              borderRadius: 999,
              border: typeFilter === value ? "2px solid #2563eb" : "1px solid #e5e7eb",
              background: typeFilter === value ? "#eff6ff" : "white",
              color: "#020617",
              fontWeight: "bold",
              fontSize: 12,
              cursor: "pointer"
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ fontWeight: "bold", marginBottom: 8 }}>📌 الترتيب</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {[
          ["newest", "🕒 الأحدث"],
          ["nearest", "📍 الأقرب"],
          ["important", "⭐ الأهم"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setSortFilter(value)}
            style={{
              padding: "8px 10px",
              borderRadius: 999,
              border: sortFilter === value ? "2px solid #2563eb" : "1px solid #e5e7eb",
              background: sortFilter === value ? "#eff6ff" : "white",
              color: "#020617",
              fontWeight: "bold",
              fontSize: 12,
              cursor: "pointer"
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )}
</div>

    {/* Reports List */}
    {/* TEMP NEW REPORT CARDS - WILL BE REPLACED BY OLD WORKING ENGINE */}

    <div
style={{
  maxHeight: "calc(100vh - 240px)",
  overflowY: "auto",
  overflowX: "hidden",
  touchAction: "pan-y",
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
  paddingBottom: 80
}}
>

{listedReports.map((r, index) => (


<div
  key={reportRenderKey(r, index)}

onClick={() => {
  setSelectedReport(r)
  setMapTarget([r.lat, r.lng])
  setShowReportsPage(false)
}}

  style={{
    background: "#111827",
    borderWidth: 2,
    borderLeftWidth: 8,
    borderStyle: "solid",
    borderColor:
  r.priority === "high"
    ? "#ef4444"
    : r.priority === "medium"
    ? "#f59e0b"
    : "#3b8df8",
    borderRadius: 12,
    padding: 6,
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  }}
>


<div style={{ flex: 1, color: "white", lineHeight: 1.25 }}>
  <div
  style={{
    fontSize: 14,
    fontWeight: "bold"
  }}
>
<div
  style={{
display: "inline-block",
padding: 0,
borderRadius: 0,
background: "transparent",
    color:
      r.type.includes("مسروقة")
        ? "#dc2626"
        : r.type.includes("حادث")
        ? "#d97706"
        : r.type.includes("بنزين")
        ? "#ea580c"
        : r.type.includes("عطل")
        ? "#7c3aed"
        : r.type.includes("وصلني")
        ? "#db2777"
        : "#0369a1",
    fontWeight: "bold",
    fontSize: 12
  }}
>

<>



<div>
  <div
    style={{
      fontWeight: "bold",
      fontSize: 16
    }}
  >
    {r.emoji} {r.type}
  </div>

  {(r.locationName || r.area || r.street) && (
    <div
      style={{
        marginTop: 6,
        fontSize: 14,
        color: "#ffd166",
        fontWeight: "700",
        lineHeight: 1.4,
        direction: "rtl"
      }}
    >
      📍 {formatLebaneseLocationConcise(r)}

    </div>
  )}
</div>

</>
</div>
</div>

<div
  style={{
    color:
      r.priority === "high"
        ? "#ef4444"
        : r.priority === "medium"
        ? "#f59e0b"
        : "#38bdf8",
    fontSize: 10,
    fontWeight: "bold",
    marginTop: 2
  }}
>
  {r.priority === "high"
    ? "🔴 خطر عالي"
    : r.priority === "medium"
    ? "🟠 انتباه"
    : "🔵 معلومة"}
</div>

  <div style={{
  color: "#cbd5e1",
  fontSize: 11,
  lineHeight: 1.1,
  marginTop: 2
}}>
  📍 {formatLebaneseLocationConcise(r)}

{r.description && (
  <div style={{ marginTop: 4, color: "#e5e7eb", fontSize: 11, lineHeight: 1.25 }}>
    📝 {r.description}
  </div>
)}

{(r.reportImageUrl || r.stolenBikeImageUrls?.[0]) && (
<img
  src={r.reportImageUrl || r.stolenBikeImageUrls?.[0]}
  alt="Report"
  loading="lazy"
 onClick={() =>
  setFullImageUrl(
    r.reportImageUrl || r.stolenBikeImageUrls?.[0] || null
  )
}
  style={{
    width: 180,
    height: 115,
    objectFit: "cover",
    borderRadius: 10,
    marginTop: 6,
    cursor: "pointer",
  }}
/>
)}

</div>

{myLocation && r.lat != null && r.lng != null && (
  <div style={{ color: "#22c55e", fontSize: 12, fontWeight: "bold", marginTop: 2 }}>
    📍 يبعد {formatDistanceKm(calculateDistance(myLocation, [r.lat, r.lng]))}
  </div>
)}

<div
  style={{
    color: reportAgeColor(r.createdAt || Date.now()),
    fontSize: 10,
    marginTop: 2,
    fontWeight: "bold"
  }}
>
  ⏱️ {timeAgo(r.createdAt || Date.now())}
</div>

  {r.helperComing && isAssistanceReport(r) && (
  <div style={{
    color: "#22c55e",
    fontSize: 13,
    fontWeight: "bold",
    marginTop: 4
  }}>
{r.helperArrived ? (
  <>✅ المساعدة وصلت للموقع</>
) : (
  <>
    {r.helperId === deviceId
      ? "✅ أنت استلمت هذا الطلب"
      : `${r.helpers || 1} مساعد بالطريق`}
  </>
)}
  </div>
)}

</div>

{r.resolved ? (
  <button
    style={{
      background: "#22c55e",
      color: "white",
      border: "none",
      borderRadius: 12,
      padding: "9px 12px",
      fontWeight: "bold"
    }}
  >
    ✅ تم الحل
  </button>
) : (
  canReceiveHelp(r) && r.ownerId !== deviceId && !r.helperComing && (
    <button
     onClick={() => ensureContactInfo(() => helperRespond(r))}
      style={{
        background: "white",
        border: "none",
        borderRadius: 12,
        padding: "9px 12px",
        fontWeight: "bold"
      }}
    >
      أنا قريب
    </button>
  )
)}

{r.ownerId === deviceId && r.helperComing && (
  <button
    onClick={(e) => {
      e.stopPropagation()
      resolveReport(r)
    }}
    style={{
background: "#22c55e",
color: "white",
border: "none",
width: "auto",
minWidth: 110,
borderRadius: 10,
padding: "6px 8px",
fontSize: 11,
fontWeight: "bold",
marginTop: 0,
marginRight: 0
    }}
  >
    ✅ تم الحل
  </button>
)}

{r.ownerId === deviceId && !r.type?.includes("مسروقة") && (
  <button
    onClick={(e) => {
      e.stopPropagation()
      cancelReport(r)
    }}
style={{
  width: "auto",
  minWidth: 90,
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: 10,
  padding: "7px 10px",
  fontWeight: "bold",
  fontSize: 12,
  marginTop: 0,
  marginRight: "auto"
}}
  >
    ❌ إلغاء
  </button>
)}

{r.helperId === deviceId && (
  <div style={{
    display: "grid",
    gap: 6,
    width: 150,
    flexShrink: 0
  }}>
    <button
      onClick={(e) => {
        e.stopPropagation()
        window.open(`https://www.google.com/maps?q=${r.lat},${r.lng}`, "_blank")
      }}
      style={{
        width: "100%",
        background: "#16a34a",
        color: "white",
        border: "none",
        borderRadius: 10,
        padding: "7px 8px",
        fontSize: 12,
        fontWeight: "bold"
      }}
    >
      📍 موقع الطلب
    </button>

    {r.phone && (
      <>
        <button
          onClick={(e) => {
            e.stopPropagation()
            window.location.href = `tel:${r.phone}`
          }}
          style={{
            width: "100%",
            background: "#16a34a",
            color: "white",
            border: "none",
            borderRadius: 10,
            padding: "8px",
            fontSize: 12,
            fontWeight: "bold"
          }}
        >
          📞 اتصال
        </button>

        <button

onClick={(e) => {
  e.stopPropagation()

  const ownerPhone = String(
    r.phone || ""
  )
    .replace(/\D/g, "")
    .replace(/^0/, "")

  window.open(
    `https://wa.me/961${ownerPhone}`,
    "_blank"
  )
}}


          style={{
            width: "100%",
            background: "#16a34a",
            color: "white",
            border: "none",
            borderRadius: 10,
            padding: "8px",
            fontSize: 12,
            fontWeight: "bold"
          }}
        >
          💬 واتساب
        </button>
      </>
    )}

    <button
      onClick={(e) => {
        e.stopPropagation()
        cancelHelp(r)
      }}
      style={{
        width: "100%",
        background: "#16a34a",
        color: "white",
        border: "none",
        borderRadius: 10,
        padding: "8px",
        fontSize: 12,
        fontWeight: "bold"
      }}
    >
      ❌ إلغاء المساعدة
    </button>
  </div>
)}


     </div>
     ))}
     </div>
     </div>

)}



{showDescriptionModal && (
  <div style={{
    position: "fixed",
    inset: 0,
    zIndex: 2900,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20
  }}>
    <div style={{
      background: "white",
      width: "100%",
      maxWidth: 380,
      borderRadius: 24,
      padding: 20,
      direction: "rtl"
    }}>

      <h3 style={{ marginTop: 0 }}>
        {pendingReportType?.reportCategory === "otherIncident"
          ? "وصف مختصر (مطلوب)"
          : pendingReportType?.reportFamily === "incident"
            ? "ملاحظة اختيارية"
            : "إضافة ملاحظة (اختياري)"}
      </h3>

      {pendingReportType?.reportFamily === "incident" && (
        <p style={{ color: "#64748b", fontSize: 13, marginTop: 0, lineHeight: 1.5 }}>
          بلّغ عما تشوفه أو تسمعه — بدون تخمين أو اتهامات.
        </p>
      )}

      <textarea
        value={reportDescription}
        onChange={(e) => setReportDescription(e.target.value)}
        placeholder={
          pendingReportType?.reportFamily === "incident"
            ? "مثال: دخان كثيف قرب الجسر"
            : "مثال: زحمة قوية بسبب حادث"
        }
        maxLength={120}
        style={{
          width: "100%",
          minHeight: 100,
          padding: 12,
          borderRadius: 12,
          border: "1px solid #ddd",
          resize: "none",
          boxSizing: "border-box",
          fontSize: 16,
        }}
      />

<input
  type="file"
  accept="image/*"

onChange={async (e) => {
  const file = e.target.files?.[0]
  if (!file) return

  if (file.size > 2 * 1024 * 1024) {
  alert("⚠️ الصورة كبيرة جداً. الحد الأقصى 2MB")
  return
}

const compressedFile = await compressImage(file)

setReportImage(compressedFile)
setReportImagePreview(URL.createObjectURL(compressedFile))

}}

  style={{
    width: "100%",
    marginTop: 10,
    fontSize: 16
  }}
/>

{reportImagePreview && (
  <img
    src={reportImagePreview}
    alt="Preview"
    style={{
      width: "100%",
      maxHeight: 200,
      objectFit: "cover",
      borderRadius: 12,
      marginTop: 10
    }}
  />
)}

<button
  onClick={async () => {
    if (isSubmittingReport) return
    if (!pendingReportType) return

    if (
      pendingReportType.reportCategory === "otherIncident" &&
      !reportDescription.trim()
    ) {
      alert("للنوع «أخرى» اكتب ملاحظة قصيرة عما تشوفه.")
      return
    }

    const finalDescription = reportDescription
    const typePayload = {
      ...pendingReportType,
      description: finalDescription,
    }

    const finishSuccessfulCreate = () => {
      setReportDescription("")
      setShowDescriptionModal(false)
      setShowReportModal(false)
      setShowDuplicateSheet(false)
      setDuplicateMatch(null)
      setPendingDuplicateCreate(null)
      if (
        shouldOfferNotificationPromptAfterCreate({
          reportFamily: pendingReportType?.reportFamily,
        })
      ) {
        openNotificationPrompt()
      }
    }

    const runCreate = async (preResolvedCoords?: [number, number]) => {
      setIsSubmittingReport(true)
      const ok = await createUserReport(typePayload, { preResolvedCoords })
      if (ok) finishSuccessfulCreate()
    }

    if (
      pendingReportType?.reportFamily === "assistance" ||
      pendingReportType?.reportFamily === "sharedRide"
    ) {
      ensureContactInfo(() => {
        void runCreate()
      })
      return
    }

    // Road / incident: one fresh GPS, then duplicate nudge before addDoc.
    if (isDuplicateEligibleCreateType(pendingReportType)) {
      setIsSubmittingReport(true)
      try {
        const located = await resolveCreateLocation({ existing: myLocation })
        const coords: [number, number] = located.coords
          ? located.coords
          : [33.8938, 35.5018]
        if (located.coords) setMyLocation(located.coords)

        const category =
          typeof pendingReportType.reportCategory === "string"
            ? pendingReportType.reportCategory
            : ""
        const match = findLikelyDuplicateReport({
          reports: visibleReports,
          createCategory: category,
          createLat: coords[0],
          createLng: coords[1],
        })

        if (match) {
          setPendingDuplicateCreate({ typePayload, coords })
          setDuplicateMatch(match)
          setDuplicateError(null)
          setShowDescriptionModal(false)
          setShowDuplicateSheet(true)
          return
        }

        // Reuse same coords — no second GPS request.
        const ok = await createUserReport(typePayload, {
          preResolvedCoords: coords,
        })
        if (ok) finishSuccessfulCreate()
      } finally {
        setIsSubmittingReport(false)
      }
      return
    }

    await runCreate()
  }}
  disabled={isSubmittingReport}
  style={{
    width: "100%",
    padding: 14,
    marginTop: 12,
    borderRadius: 14,
    border: "none",
    background: isSubmittingReport ? "#777" : "#16a34a",
    color: "white",
    fontWeight: "bold",
    opacity: isSubmittingReport ? 0.7 : 1
  }}
>
  {isSubmittingReport ? "جارٍ نشر البلاغ..." : "نشر البلاغ"}
</button>

      <button
        onClick={() => {
          setReportDescription("")
          setShowDescriptionModal(false)
        }}
        style={{
          width: "100%",
          padding: 14,
          marginTop: 8,
          borderRadius: 14,
          border: "none"
        }}
      >
        إلغاء
      </button>

    </div>
  </div>
)}

{showStolenModal && (
  <div style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
  <div
  style={{
    background: "#020617",
    width: "100%",
    maxWidth: 430,
    borderRadius: 28,
    padding: 22,
    textAlign: "center",
    direction: "rtl",
    color: "white",

    maxHeight: "92vh",
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    paddingBottom: 40,
  }}
>
      <h2>🚨 الإبلاغ عن دراجة مسروقة</h2>

      <p style={{ color: "#fca5a5", fontSize: 13 }}>
        صورة الدراجة إلزامية لتجنب أي التباس أو مشاكل مع الآخرين
      </p>

<input value={stolenBikeType} onChange={(e) => setStolenBikeType(e.target.value)} placeholder="🏍️ نوع الدراجة" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<input value={stolenBikeColor} onChange={(e) => setStolenBikeColor(e.target.value)} placeholder="🎨 اللون" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<input value={stolenBikePlate} onChange={(e) => setStolenBikePlate(e.target.value)} placeholder="🔢 رقم اللوحة إذا موجود" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<input value={stolenBikePhone} onChange={(e) => setStolenBikePhone(e.target.value)} placeholder="📞 رقم التواصل" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16}} />
<input value={stolenBikePlace} onChange={(e) => setStolenBikePlace(e.target.value)} placeholder="📍 مكان السرقة" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<label style={{ color: "white", marginTop: 12, display: "block", textAlign: "right" }}>
  📅 التاريخ
</label>
<input
  value={stolenBikeDate}
  onChange={(e) => setStolenBikeDate(e.target.value)}
  type="date"
  style={{ width: "100%", padding: 14, marginTop: 6, borderRadius: 14, fontSize: 16 }}
/>

<label style={{ color: "white", marginTop: 12, display: "block", textAlign: "right" }}>
  🕒 الوقت
</label>
<input
  value={stolenBikeTime}
  onChange={(e) => setStolenBikeTime(e.target.value)}
  type="time"
  style={{ width: "100%", padding: 14, marginTop: 6, borderRadius: 14, fontSize: 16 }}
/>

<input
  type="file"
  accept="image/*"
  multiple
  onChange={async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 5)

    if (files.length === 0) return

    const compressedFiles: File[] = []

    for (const file of files) {
      const compressedFile = await compressImage(file)
      compressedFiles.push(compressedFile)
    }

    setStolenBikeImages(compressedFiles)
    setStolenBikeImagePreviews(
      compressedFiles.map((file) => URL.createObjectURL(file))
    )
  }}
  style={{
    width: "100%",
    padding: 14,
    marginTop: 10,
    borderRadius: 14,
    background: "white",
    color: "black",
  }}
/>

{stolenBikeImagePreviews.length > 0 && (
  <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 10 }}>
    {stolenBikeImagePreviews.map((preview, index) => (
      <img
        key={index}
        src={preview}
        style={{
          width: 120,
          height: 120,
          objectFit: "cover",
          borderRadius: 14,
          flexShrink: 0
        }}
      />
    ))}
  </div>
)}

<button
  onClick={submitStolenBikeReport}
  disabled={isSubmittingStolenBike}
  style={{
    width: "100%",
    padding: 15,
    marginTop: 14,
    borderRadius: 16,
    border: "none",
    background: isSubmittingStolenBike ? "#777" : "#dc2626",
    color: "white",
    fontWeight: "bold",
    opacity: isSubmittingStolenBike ? 0.7 : 1
  }}
>
  {isSubmittingStolenBike ? "جارٍ نشر البلاغ..." : "🚨 نشر البلاغ"}
</button>

      <button onClick={() => setShowStolenModal(false)} style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 16, border: "none" }}>
        إلغاء
      </button>
    </div>
  </div>
)}

{showContactModal && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.55)",
      zIndex: 9999999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      direction: "rtl",
    }}
  >
    <div
      style={{
        background: "white",
        borderRadius: 24,
        padding: 22,
        width: "100%",
        maxWidth: 380,
        boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        textAlign: "center",
      }}
    >
      <h2 style={{ marginTop: 0 }}>معلومات التواصل</h2>

      <p style={{ color: "#475569", lineHeight: 1.7, fontSize: 14 }}>
        لخدمات المساعدة فقط، نحتاج اسمك ورقم هاتفك حتى يستطيع الطرف الآخر التواصل معك عبر الاتصال أو واتساب.
        إذا كنت تريد فقط متابعة الخريطة والبلاغات، لا تحتاج لإدخال هذه المعلومات.
      </p>

      <input
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
        placeholder="الاسم"
        style={{
          width: "100%",
          padding: 14,
          borderRadius: 14,
          border: "1px solid #cbd5e1",
          marginTop: 12,
          fontSize: 16,
          boxSizing: "border-box",
        }}
      />

      <input
        value={contactPhone}
        onChange={(e) => setContactPhone(e.target.value)}
        placeholder="رقم الهاتف"
        inputMode="tel"
        style={{
          width: "100%",
          padding: 14,
          borderRadius: 14,
          border: "1px solid #cbd5e1",
          marginTop: 10,
          fontSize: 16,
          boxSizing: "border-box",
        }}
      />

      <button
        onClick={saveContactInfo}
        style={{
          width: "100%",
          padding: 14,
          borderRadius: 16,
          border: "none",
          background: "#16a34a",
          color: "white",
          fontWeight: "bold",
          fontSize: 16,
          marginTop: 16,
        }}
      >

<p
  style={{
    fontSize: 13,
    color: "#6b7280",
    marginTop: 12,
    lineHeight: 1.6,
  }}
>
  عند طلب أو قبول المساعدة، قد يتم مشاركة رقم هاتفك مع الطرف الآخر
  لتسهيل التواصل عبر الاتصال أو واتساب.
</p>



        حفظ ومتابعة
      </button>

      <button
        onClick={() => {
          setShowContactModal(false)
          setPendingAction(null)
        }}
        style={{
          width: "100%",
          padding: 14,
          borderRadius: 16,
          border: "none",
          background: "#e5e7eb",
          color: "#2563eb",
          fontWeight: "bold",
          fontSize: 16,
          marginTop: 10,
        }}
      >
        لاحقاً
      </button>
    </div>
  </div>
)}

{showCommunityCenter && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,.55)",
      zIndex: 999999,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      direction: "rtl",
    }}
  >
    <div
      style={{
        background: "white",
        width: "100%",
        maxWidth: 420,
        borderRadius: 24,
        padding: 22,
        textAlign: "center",
      }}
    >
      <h2>الإعدادات</h2>

      {(() => {
        void notifSettingsTick
        const notifState = resolveSettingsNotificationState()
        const label = settingsStateLabelAr(notifState)
        return (
          <div
            style={{
              ...communityBtnStyle,
              textAlign: "right",
              cursor: "default",
              display: "block",
              paddingTop: 14,
              paddingBottom: 14,
            }}
          >
            <div style={{ fontWeight: "bold", marginBottom: 4 }}>الإشعارات</div>
            <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
              الحالة: {label}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(notifState === "inactive" || notifState === "needs_setup") && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCommunityCenter(false)
                    openNotificationPrompt({ force: true })
                  }}
                  style={{
                    flex: 1,
                    minWidth: 110,
                    padding: "10px 8px",
                    borderRadius: 12,
                    border: "none",
                    background: "#0f172a",
                    color: "white",
                    fontWeight: "bold",
                    fontSize: 13,
                  }}
                >
                  {notifState === "needs_setup" ? "إعادة المحاولة" : "تفعيل"}
                </button>
              )}
              {notifState === "needs_install" && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCommunityCenter(false)
                    setShowInstallGuide(true)
                  }}
                  style={{
                    flex: 1,
                    minWidth: 110,
                    padding: "10px 8px",
                    borderRadius: 12,
                    border: "none",
                    background: "#0f172a",
                    color: "white",
                    fontWeight: "bold",
                    fontSize: 13,
                  }}
                >
                  فتح تعليمات التثبيت
                </button>
              )}
              {notifState === "active" && (
                <button
                  type="button"
                  onClick={async () => {
                    const { disableNotificationsLocally } = await import(
                      "./notifications/notificationSubscription"
                    )
                    disableNotificationsLocally()
                    setNotifSettingsTick((n) => n + 1)
                    alert(
                      "تم إيقاف تفضيل الإشعارات على هذا الجهاز. إلغاء الاشتراك الكامل من الخادم يأتي لاحقاً."
                    )
                  }}
                  style={{
                    flex: 1,
                    minWidth: 110,
                    padding: "10px 8px",
                    borderRadius: 12,
                    border: "none",
                    background: "#e5e7eb",
                    color: "#0f172a",
                    fontWeight: "bold",
                    fontSize: 13,
                  }}
                >
                  إيقاف محلي
                </button>
              )}
              {notifState === "denied" && (
                <div style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.5 }}>
                  فعّل الإشعارات من إعدادات المتصفح أو الجهاز ثم أعد المحاولة.
                </div>
              )}
            </div>
          </div>
        )
      })()}

      <button
  onClick={() => {
    setShowCommunityCenter(false)
    setShowContactModal(true)
  }}
  style={communityBtnStyle}
>
  📞 معلومات التواصل
</button>

      <button
        onClick={() => setShowLegalPage("privacy")}
        style={communityBtnStyle}
      >
        📜 سياسة الخصوصية
      </button>

      <button
        onClick={() => setShowLegalPage("terms")}
        style={communityBtnStyle}
      >
        📄 شروط الاستخدام
      </button>

      <button
        onClick={() => setShowLegalPage("emergency")}
        style={communityBtnStyle}
      >
        🚨 تنبيه الطوارئ
      </button>

      <button
        onClick={() => setShowLegalPage("founders")}
        style={communityBtnStyle}
      >
        👥 المؤسسون الأوائل
      </button>

<button
  onClick={handleInstallApp}
  style={{
    ...communityBtnStyle,
    position: "relative",
    zIndex: 999999,
    pointerEvents: "auto",
  }}
>
  📲 حمّل تطبيق توتيموتو
</button>

      <button
        onClick={() => setShowLegalPage("feedback")}
        style={communityBtnStyle}
      >
        💡 ساعدنا نحسن توتيموتو
      </button>

      <button
        onClick={() => setShowCommunityCenter(false)}
        style={{
          width: "100%",
          marginTop: 14,
          padding: 14,
          borderRadius: 16,
          border: "none",
          background: "#e5e7eb",
          fontWeight: "bold",
        }}
      >
        إغلاق
      </button>
    </div>
  </div>
)}

{showLegalPage && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,.55)",
      zIndex: 1000000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      direction: "rtl",
    }}
  >
    <div
      style={{
        background: "white",
        width: "100%",
        maxWidth: 430,
        maxHeight: "82vh",
        overflowY: "auto",
        borderRadius: 24,
        padding: 22,
        textAlign: "right",
        lineHeight: 1.8,
      }}
    >
      <h2 style={{ textAlign: "center" }}>
        {showLegalPage === "privacy" && "📜 سياسة الخصوصية"}
        {showLegalPage === "terms" && "📄 شروط الاستخدام"}
        {showLegalPage === "emergency" && "🚨 تنبيه الطوارئ"}
        {showLegalPage === "founders" && "👥 المؤسسون الأوائل"}
        {showLegalPage === "feedback" && "💡 ساعدنا نحسن توتيموتو"}
      </h2>

      {showLegalPage === "privacy" && (
        <>
          <p>يجمع توتيموتو فقط المعلومات الضرورية لتشغيل خدمات البلاغات والمساعدة.</p>
          <p>قد نستخدم موقعك الجغرافي لإنشاء البلاغات وعرض البلاغات القريبة منك.</p>
          <p>عند طلب أو قبول المساعدة، قد يتم مشاركة رقم هاتفك مع الطرف الآخر لتسهيل التواصل.</p>
          <p>لا نبيع معلوماتك الشخصية لأي طرف ثالث.</p>
        </>
      )}

      {showLegalPage === "terms" && (
        <>
          <p>باستخدام توتيموتو، توافق على استخدام التطبيق بطريقة مسؤولة.</p>
          <p>يمنع نشر بلاغات كاذبة أو مضللة أو مسيئة.</p>
          <p>يمنع استخدام التطبيق للمضايقة أو الاحتيال أو أي نشاط غير قانوني.</p>
          <p>قد يتم حذف البلاغات المخالفة أو تقييد المستخدمين المسيئين لاحقاً.</p>
        </>
      )}

      {showLegalPage === "emergency" && (
        <>
          <p>توتيموتو شبكة مجتمعية للدراجين وليست جهة طوارئ رسمية.</p>
          <p>في الحالات الخطيرة أو الطارئة، تواصل فوراً مع الشرطة أو الإسعاف أو الدفاع المدني.</p>
          <p>التطبيق يساعد الدراجين على مشاركة المعلومات وطلب المساعدة من المجتمع، لكنه لا يضمن وصول المساعدة أو دقة كل البلاغات.</p>
        </>
      )}

      {showLegalPage === "founders" && (
        <>
          <p>أنت من أوائل الدراجين الذين يساهمون في بناء توتيموتو.</p>
          <p>ملاحظاتك واقتراحاتك تساعدنا على تحسين التطبيق لكل مجتمع الدراجين في لبنان.</p>
          <p>قد يحصل المؤسسون الأوائل لاحقاً على شارة خاصة أو مزايا مستقبلية داخل التطبيق.</p>
        </>
      )}

      {showLegalPage === "feedback" && (
        <>
          <p>اكتب لنا أي مشكلة واجهتك أو ميزة تحب أن تراها في توتيموتو.</p>
         <textarea
  value={feedbackMessage}
  onChange={(e) => setFeedbackMessage(e.target.value)}
  placeholder="اكتب رسالتك هنا..."
  style={{
              width: "100%",
              minHeight: 120,
              borderRadius: 14,
              border: "1px solid #d1d5db",
              padding: 12,
              fontSize: 15,
              boxSizing: "border-box",
            }}
          />
          <button
  onClick={submitFeedback}
  disabled={sendingFeedback}
  style={communityBtnStyle}
>
           {sendingFeedback ? "جارٍ الإرسال..." : "إرسال الملاحظة"}
          </button>
        </>
      )}

      <button
        onClick={() => setShowLegalPage(null)}
        style={{
          width: "100%",
          marginTop: 16,
          padding: 14,
          borderRadius: 16,
          border: "none",
          background: "#e5e7eb",
          fontWeight: "bold",
        }}
      >
        إغلاق
      </button>
    </div>
  </div>
)}

{showInstallGuide && (
  <div
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,.6)",
      zIndex: 999999,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
      direction: "rtl",
    }}
  >
    <div
      style={{
        background: "#fff",
        borderRadius: 22,
        padding: 24,
        maxWidth: 420,
        width: "100%",
        textAlign: "right",
        lineHeight: 1.8,
      }}
    >
      <h2 style={{ textAlign: "center" }}>📲 حمّل تطبيق توتيموتو</h2>

      <p><strong>على iPhone:</strong></p>
      <p>1. اضغط زر المشاركة أسفل الشاشة</p>
      <p>2. اختر <strong>Add to Home Screen</strong></p>
      <p>3. اضغط <strong>Add</strong></p>
      <p style={{ fontSize: 13, color: "#64748b" }}>
        الإشعارات على iPhone تعمل فقط بعد تثبيت التطبيق على الشاشة الرئيسية وفتحه منه.
      </p>

      <hr />

      <p><strong>على Android:</strong></p>
      <p>اضغط ⋮ ثم اختر <strong>Install App</strong> أو <strong>Add to Home Screen</strong>.</p>

      <button
        onClick={() => setShowInstallGuide(false)}
        style={communityBtnStyle}
      >
        فهمت
      </button>
    </div>
  </div>
)}

<NotificationPermissionSheet
  open={showNotifPrompt}
  busy={notifPromptBusy}
  errorAr={notifPromptError}
  onEnable={() => {
    void confirmEnableNotifications()
  }}
  onDismiss={dismissNotificationPrompt}
/>

{selectedReport && (
  <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "end", justifyContent: "center" }}>
    {selectedReport.type?.includes("مسروقة") ? (
      <div style={{ background: "white", width: "100%", maxWidth: 430, borderRadius: 28, padding: 24, textAlign: "center", direction: "rtl" }}>
        <div style={{ fontSize: 52 }}>🚨</div>

        <h2 style={{ margin: 0, fontSize: 30, fontWeight: "bold" }}>
          بلاغ عن دراجة مسروقة
        </h2>

{selectedReport.stolenBikeImageUrls?.length > 0 && (
  <div style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 16, marginBottom: 16 }}>
    {selectedReport.stolenBikeImageUrls.map((url: string, index: number) => (
      <img
        key={index}
        src={url}
        alt="Stolen Bike"
        style={{
          width: 180,
          height: 140,
          objectFit: "cover",
          borderRadius: 16,
          flexShrink: 0
        }}
      />
    ))}
  </div>
)}

        <div style={{ marginTop: 18, textAlign: "right", lineHeight: 2 }}>
<div>🏍️ نوع الدراجة: <b>{selectedReport.stolenBikeType || "غير محدد"}</b></div>
<div>🎨 اللون: <b>{selectedReport.stolenBikeColor || "غير محدد"}</b></div>
<div>🔢 رقم اللوحة: <b>{selectedReport.stolenBikePlate || "غير محدد"}</b></div>
<div>📍 مكان السرقة: <b>{formatLebaneseLocationDetailed(selectedReport) || selectedReport.stolenBikePlace || "غير محدد"}</b></div>
<div>🗓️ التاريخ: <b>{selectedReport.stolenBikeDate || "غير محدد"}</b></div>
<div>⏰ الوقت: <b>{selectedReport.stolenBikeTime || "غير محدد"}</b></div>
<div>📞 رقم التواصل: <b>{selectedReport.stolenBikePhone || "غير محدد"}</b></div>
        </div>

        {renderRiderActionBar(selectedReport)}

        <div style={{ fontSize: 11, color: "red", marginTop: 8 }}>

</div>

        {selectedReport.stolenBikePhone && (
          <>
            <button
              onClick={() => window.location.href = `tel:${selectedReport.stolenBikePhone}`}
              style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 18, marginTop: 20 }}
            >
              📞 اتصال بصاحب الدراجة
            </button>

            <button
              onClick={() => window.open(`https://wa.me/${selectedReport.stolenBikePhone}`, "_blank")}
              style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", background: "#22c55e", color: "white", fontWeight: "bold", fontSize: 13, marginRight: 0 }}
            >
              💬 واتساب
            </button>
          </>
        )}



        <button
          onClick={() => window.open(`https://www.google.com/maps?q=${selectedReport.lat},${selectedReport.lng}`, "_blank")}
          style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", background: "#2563eb", color: "white", fontWeight: "bold", fontSize: 13 }}
        >
          📍 فتح الموقع
        </button>



        {selectedReport.type?.includes("مسروقة") &&
 selectedReport.ownerId === deviceId && (
  <button
    onClick={() => {
      cancelReport(selectedReport)
      setSelectedReport(null)
    }}
    style={{
      width: "100%",
      padding: 14,
      borderRadius: 16,
      border: "none",
      background: "#dc2626",
      color: "white",
      fontWeight: "bold",
      fontSize: 17,
      marginTop: 10
    }}
  >
    ✅ تم العثور على الدراجة
  </button>
)}

        <button
          onClick={() => setSelectedReport(null)}
          style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", marginTop: 6, background: "#e5e7eb", fontWeight: "bold", fontSize: 12 }}
        >
          إغلاق
        </button>
      </div>
    ) : (
      <div style={{ background: "white", width: "100%", maxWidth: 280, borderRadius: 28, padding: 12 , textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 10 }}>{selectedReport.emoji}</div>

        <h2 style={{ margin: 0, fontSize: 32, fontWeight: "bold" }}>
          {selectedReport.type}
        </h2>

        {isRoadIntelligenceReport(selectedReport) ||
        isIncidentReport(selectedReport) ? (
          <>
            {usesApproximateIncidentArea(selectedReport) ? (
              <div
                style={{
                  color: "#94a3b8",
                  marginTop: 6,
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                الموقع تقريبي
              </div>
            ) : null}
            {selectedReport.id ? (
              <ReportConfirmationPanel
                key={String(selectedReport.id)}
                db={db}
                report={{
                  ...selectedReport,
                  id: String(selectedReport.id),
                }}
                currentUid={firebaseUid}
                authReady={authStatus === "ready"}
              />
            ) : null}
          </>
        ) : null}

        <div style={{ color: "#94a3b8", marginTop: 8, fontSize: 15 }}>
          {formatLebaneseLocationDetailed(selectedReport)}
        </div>

 {selectedReport.description && (
  <div style={{
    marginTop: 12,
    fontSize: 15,
    color: "#374151",
    lineHeight: 1.6,
    background: "#f3f4f6",
    padding: 12,
    borderRadius: 14,
    textAlign: "right"
  }}>
    📝 {selectedReport.description}
  </div>
)}

        {renderRiderActionBar(selectedReport)}

{selectedReport.helperId === deviceId && selectedReport.helperComing && (
  <div
    style={{
      background: "#dcfce7",
      color: "#166534",
      padding: 12,
      borderRadius: 14,
      fontWeight: "bold",
      fontSize: 15,
      marginTop: 10,
      marginBottom: 10,
      textAlign: "center"
    }}
  >
    ✅ أنت استلمت هذا الطلب
  </div>
)}


{(selectedReport.ownerPhone || selectedReport.phone) &&
isAssistanceReport(selectedReport) && (

 <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, width: 220 }}>

<button
  onClick={() =>
   window.location.href = `tel:${
  selectedReport.ownerId === deviceId
    ? selectedReport.helperPhone
    : (selectedReport.ownerPhone || selectedReport.phone)
}`
  }
  style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 12, marginRight: 0 }}
>
  📞 اتصال
</button>

<button
onClick={() =>
  window.open(
    `https://wa.me/961${String(
      selectedReport.ownerId === deviceId
        ? selectedReport.helperPhone
        : (selectedReport.ownerPhone || selectedReport.phone || "")
    ).replace(/\D/g, "").replace(/^0/, "")}`,
    "_blank"
  )
}
  style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", background: "#22c55e", color: "white", fontWeight: "bold", fontSize: 12, marginRight: 0 }}
>
  💬 واتساب
</button>

    <button
onClick={() => {
  window.open(
    selectedReport.ownerId === deviceId
      ? `https://www.google.com/maps?q=${selectedReport.helperLat},${selectedReport.helperLng}`
      : `https://www.google.com/maps?q=${selectedReport.lat},${selectedReport.lng}`,
    "_blank"
  )
}}
      style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", background: "#2563eb", color: "white", fontWeight: "bold", fontSize: 12 }}
    >
      {selectedReport.ownerId === deviceId ? "📍 موقع المساعد" : "📍 موقع الطلب"}
    </button>

{selectedReport.ownerId === deviceId && selectedReport.helperComing && (
  <div
    style={{
      color: "#22c55e",
      fontWeight: "bold",
      fontSize: 14,
      marginTop: 10,
      marginBottom: 10,
      textAlign: "center"
    }}
  >
    🛵 المساعد في الطريق إليك
  </div>
)}

 {selectedReport.ownerId === deviceId && selectedReport.helperComing && (
  <button
    onClick={(e) => {
      e.stopPropagation()
      resolveReport(selectedReport)
      setSelectedReport(null)
    }}
    style={{
      width: "100%",
      padding: 14,
      borderRadius: 18,
      border: "none",
      marginTop: 10,
      background: "#22c55e",
      color: "white",
      fontWeight: "bold",
      fontSize: 17
    }}
  >
    ✅ تم الحل
  </button>
)}

{selectedReport.type?.includes("مسروقة") &&
 selectedReport.ownerId === deviceId && (
  <button
    onClick={() => {
      cancelReport(selectedReport)
      setSelectedReport(null)
    }}
    style={{
      width: "100%",
      padding: 14,
      borderRadius: 16,
      border: "none",
      background: "#dc2626",
      color: "white",
      fontWeight: "bold",
      fontSize: 17,
      marginTop: 10
    }}
  >
    ✅ تم العثور على الدراجة
  </button>
)}

<button
  onClick={() => {
  if (selectedReport.helperId === deviceId && selectedReport.helperComing) {
    cancelHelp(selectedReport)
  } else {
    setSelectedReport(null)
  }
}}
  style={{
    width: "100%",
    padding: 14,
    borderRadius: 16,
    border: "none",
    marginTop: 10,
    background: "#e5e7eb",
    color: "#2563eb",
    fontWeight: "bold",
    fontSize: 17
  }}
>
 {selectedReport.helperId === deviceId && selectedReport.helperComing ? "❌ إلغاء المساعدة" : "إغلاق"}
</button>

  </div>
)}

{needsHelper &&
 selectedReport.ownerId !== deviceId &&
 !selectedReport.helperComing && (
        <button
          disabled={selectedReport.joined}
          onClick={() => ensureContactInfo(() => helperRespond(selectedReport))}
          style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 18, marginTop: 20 }}
        >
          {selectedReport.joined ? "تم الانضمام ✅" : "أنا قريب"}
        </button>
)}

<button
  onClick={() =>
    window.open(
      `https://www.google.com/maps?q=${selectedReport.lat},${selectedReport.lng}`,
      "_blank"
    )
  }
  style={{
    width: "100%",
    padding: 14,
    borderRadius: 18,
    border: "none",
    marginTop: 10,
    background: "#2563eb",
    color: "white",
    fontWeight: "bold"
  }}
>
  📍 فتح الموقع
</button>

{selectedReport.ownerId === deviceId &&
 !selectedReport.helperComing &&
 canReceiveHelp(selectedReport) && (
  <div style={{ color: "#f59e0b", fontWeight: "bold", fontSize: 14, marginTop: 10 }}>
    ⏳ بانتظار شخص يستلم طلبك
  </div>
)}

{selectedReport.ownerId === deviceId && !selectedReport.helperComing && (
  <button
    onClick={() => setSelectedReport(null)}
    style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 10, background: "#e5e7eb", fontWeight: "bold" }}
  >
    إغلاق
  </button>
)}

        <button
          onClick={() => {
  if (selectedReport.ownerId === deviceId) {
    cancelReport(selectedReport)
  } else {
    setSelectedReport(null)
  }
}}
          style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 10, background: "#e5e7eb", fontWeight: "bold" }}
        >

       {selectedReport.ownerId === deviceId ? "❌ إلغاء الطلب" : "إغلاق"}
        </button>
      </div>
    )}
  </div>
)}
    </div>
</>
)
}

export default App





