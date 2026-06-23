import { Fragment, useEffect, useState, useRef } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, useMapEvents } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L, { DivIcon } from "leaflet"
/* import { GoogleMap, LoadScript, MarkerF } from "@react-google-maps/api" */
import { db, storage } from "./firebase"
import {
  collection,
  addDoc,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  writeBatch
} from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage"

type ReportItem = {
  id?: number
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
  ownerPhone?: string
  helperId?: string
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

phone?: string
helperPhone?: string
description?: string
reportImageUrl?: string

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

async function deleteReportImage(report: any) {
  try {
    if (!report?.reportImageUrl) return

    const imageRef = ref(storage, report.reportImageUrl)
    await deleteObject(imageRef)
  } catch (error) {
    console.warn("Could not delete report image:", error)
  }
}

/* const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY */

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
  { label: "عطل بالدراجة", emoji: "🔧", color: "#7c3aed", expiry: 45, priority: "medium", reportFamily: "assistance", reportCategory: "bike_broken" },
  {label: "محتاج دفشة", emoji: "🛵", color: "#16a34a", expiry: 30, priority: "medium", reportFamily: "assistance", reportCategory: "push" },
  { label: "ما معي بنزين", emoji: "⛽", color: "#eab308", expiry: 30, priority: "medium", reportFamily: "assistance", reportCategory: "fuel" },
  { label: "وصلني معك", emoji: "🤝", color: "#db2777", expiry: 10, priority: "medium", reportFamily: "sharedRide", reportCategory: "ride" },
] 

const startingReports = [
  { 
    type: "زحمة",
    area: "الحمرا",
    distance: "700 متر",
    lat: 33.8938, 
    lng: 35.5018, 
    color: "#dc2626", 
    emoji: "🚗" , 
    priority: "medium",
    createdAt: Date.now(),
  },
  { 
     type: "ما معي بنزين",
     area: "بدارو", 
     distance: "2 كم", 
     lat: 33.879, 
     lng: 35.514, 
     color: "#eab308", 
     emoji: "⛽" , 
     priority: "high",
     createdAt: Date.now(),
    },
    { 
    type: "محتاج دفشي", 
    area: "الحازمية", 
    distance: "1.1 كم",
     lat: 33.857, 
     lng: 35.535, 
     color: "#16a34a", 
     emoji: "🛵", 
     priority: "medium",
     createdAt: Date.now(),
    },
]

function makeIcon(emoji: string, color: string) {
  return L.divIcon({
    className: "",
    html: `
<div style="
  background:${color};
  width:12px;
  height:12px;
  border-radius:50%;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:0px;
box-shadow:

  color === "#dc2626"
    ? "0 0 25px rgba(220,38,38,0.9)"
    : "0 0 12px rgba(0,0,0,0.4)";

animation:
  color === "#dc2626"
    ? "pulseMarker 1.2s infinite"
    : "none";
">
  
</div>
`,

iconSize: [16, 16],
iconAnchor: [8, 8],
  })
}

function MyLocation({ position }: any) {
  const map = useMap()
  const hasCentered = useRef(false)

  useEffect(() => {
    if (position && !hasCentered.current) {
      map.flyTo(position, 14)
      hasCentered.current = true
    }
  }, [position, map])

  return null
}

function timeAgo(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 1000 / 60)

  if (minutes <= 0) return "الآن"
  if (minutes === 1) return "منذ دقيقة"
  if (minutes < 60) return `منذ ${minutes} دقائق`

  const hours = Math.floor(minutes / 60)

  if (hours === 1) return "منذ ساعة"
  return `منذ ${hours} ساعات`
}

function timeLeft(report: any) {
  const minutesPassed = Math.floor((Date.now() - report.createdAt) / 1000 / 60)
  const remaining = report.expiry - minutesPassed

  if (remaining <= 0) return "انتهى"
  if (remaining === 1) return "ينتهي خلال دقيقة"

  return `ينتهي خلال ${remaining} دقيقة`
}

function calculateDistance(from: any, to: any) {
  if (!from || !to) return null

  const R = 6371

  const dLat = ((to[0] - from[0]) * Math.PI) / 180
  const dLng = ((to[1] - from[1]) * Math.PI) / 180

  const lat1 = (from[0] * Math.PI) / 180
  const lat2 = (to[0] * Math.PI) / 180

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) *
      Math.sin(dLng / 2) *
      Math.cos(lat1) *
      Math.cos(lat2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return R * c
}

function formatDistance(km: number | null) {
  if (km === null) return "المسافة غير معروفة"

  if (km < 1) {
    return `${Math.round(km * 1000)} متر منك`
  }

  return `${km.toFixed(1)} كم منك`
}

function FlyToReport({ target }: any) {
  const map = useMap()

  useEffect(() => {
    if (target) {
      map.flyTo(target, 15, { duration: 1.2 })
    }
  }, [target, map])

  return null
}

function MapZoomTracker({ setMapZoom }: any) {
  const map = useMap()

  useEffect(() => {
    const updateZoom = () => setMapZoom(map.getZoom())

    updateZoom()
    map.on("zoomend", updateZoom)

    return () => {
      map.off("zoomend", updateZoom)
    }
  }, [map, setMapZoom])

  return null
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
  const [reports, setReports] = useState<ReportItem[]>(startingReports)
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
  const unsubscribe = onSnapshot(collection(db, "reports"), (snapshot) => {
const liveReports: any = snapshot.docs.map((doc) => ({
  ...doc.data(),
  id: doc.id,
}))


    setReports(liveReports)


  })

  return () => unsubscribe()
}, [])

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

  const [showReportModal, setShowReportModal] = useState(false)
 const [showDescriptionModal, setShowDescriptionModal] = useState(false) 
const [mapZoom, setMapZoom] = useState(12)
  const [mapTarget, setMapTarget] = useState<any>(null)
  const [showStolenModal, setShowStolenModal] = useState(false)
const [showMobileDashboard, setShowMobileDashboard] = useState(false)
const [showTopInfo, setShowTopInfo] = useState(true)
const [showNearbyReports, setShowNearbyReports] = useState(true)
const [expandNearbyReports, setExpandNearbyReports] = useState(false)
const [reportsSheetMode, setReportsSheetMode] = useState<"collapsed" | "half" | "full">("collapsed")
const [showReportsPage, setShowReportsPage] = useState(false)
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

async function submitStolenBikeReport() {
  try {
if (isSubmittingStolenBike) return
setIsSubmittingStolenBike(true)


 ;(document.activeElement as HTMLElement)?.blur()   

const reportLat = 33.8938
const reportLng = 35.5018

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

alert(JSON.stringify(reportData, null, 2))

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
catch (error) {
  

  console.error(error)

  setIsSubmittingStolenBike(false)

  alert("❌ فشل نشر البلاغ")

}
}
  
async function helperRespond(report: any) {


  try {
   await updateDoc(doc(db, "reports", (report.id)), {
helperComing: true,
helperStatus: "مساعد بالطريق",
helpers: 1,
joined: true,
helperId: deviceId,
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
    await updateDoc(doc(db, "reports", String(report.id)), {
      helperComing: false,
      helperStatus: "",
      helpers: 0,
      joined: false,
      helperId: "",
      helperAcceptedAt: null
    })

setSelectedReport({
  ...report,
  helperComing: false,
  helperStatus: "",
  helpers: 0,
  joined: false,
  helperId: "",
  helperPhone: "",
  helperLat: null,
  helperLng: null,
  helperAcceptedAt: null
})

  
  } catch (error) {
    console.error(error)
    alert("❌ فشل إلغاء المساعدة")
  }
}

  useEffect(() => {
  const timer = setInterval(() => {
    setReports((prev: any) =>
      prev.map((item: any) => {
        if (!item.moving) return item

return {
  ...item,
  lat: item.lat + (item.targetLat - item.lat) * 0.35,
  lng: item.lng + (item.targetLng - item.lng) * 0.35,
}
      })
    )
  }, 1000)

  return () => clearInterval(timer)
}, [])


const [, forceUpdate] = useState(0)

const fakeReports = [
  {
    type: "زحمة",
    area: "الحمرا",
    distance: "400 متر",
    lat: 33.895,
    lng: 35.482,
    color: "#dc2626",
    emoji: "🚗",
    priority: "medium",
    expiry: 45,
    helperComing: false,
    helperArrived: false,
    helperStatus: "",
    helpers: 0,
  },

  {
    type: "حادث",
    area: "الروشة",
    distance: "1 كم",
    lat: 33.889,
    lng: 35.471,
    color: "#f97316",
    emoji: "⚠️",
    priority: "high",
    expiry: 60,
    helperComing: false,
    helperArrived: false,
    helperStatus: "",
    helpers: 0,
  },

  {
    type: "محتاج دفشة",
    area: "الأشرفية",
    distance: "2 كم",
    lat: 33.882,
    lng: 35.521,
    color: "#16a34a",
    emoji: "🛵",
    priority: "medium",
    expiry: 35,
    helperComing: false,
    helperArrived: false,
    resolved: false,
    helperStatus: "",
    helpers: 0,
  },
]

async function generateTestReports(count: number) {
  try {
    const batch = writeBatch(db)

    for (let i = 0; i < count; i++) {
      const template =
        fakeReports[Math.floor(Math.random() * fakeReports.length)]

      const reportRef = doc(collection(db, "reports"))

      batch.set(reportRef, {
        ...template,

        isTest: true,

        createdAt: Date.now(),

        ownerId: "load-test",

        resolved: false,

        lat: 33.85 + Math.random() * 0.12,
        lng: 35.45 + Math.random() * 0.15,
      })
    }

    await batch.commit()

    alert(`✅ ${count} test reports created`)
  } catch (error) {
    console.error(error)
    alert("❌ Failed creating test reports")
  }
}

async function deleteTestReports() {
  try {
    const q = query(
      collection(db, "reports"),
      where("isTest", "==", true)
    )

    const snapshot = await getDocs(q)

    if (snapshot.empty) {
      alert("No test reports found")
      return
    }

    const batch = writeBatch(db)

    snapshot.docs.forEach((testDoc) => {
      batch.delete(testDoc.ref)
    })

    await batch.commit()

    alert(`🧹 Deleted ${snapshot.docs.length} test reports`)
  } catch (error) {
    console.error(error)
    alert("❌ Failed deleting test reports")
  }
}

  useEffect(() => {
  const interval = setInterval(() => {

    const randomReport =
      fakeReports[Math.floor(Math.random() * fakeReports.length)]

const newReport = {
  ...randomReport,
  createdAt: Date.now(),
  resolved: false,
  expiry: randomReport.expiry || 45,
  lat: randomReport.lat + (Math.random() - 0.5) * 0.01,
  lng: randomReport.lng + (Math.random() - 0.5) * 0.01,
}

   addDoc(collection(db, "reports"), newReport)

  }, 9999999)

  return () => clearInterval(interval)

  const timer = setInterval(() => {

   

    forceUpdate(prev => prev + 1)

setReports(prev =>
  prev
    .map((r: any) => {

      

      if (!r.helperMoving) return r
      if (!r.helperLat || !r.helperLng || !r.helperTargetLat || !r.helperTargetLng) return r

      const nextLat = r.helperLat + (r.helperTargetLat - r.helperLat) * 0.18
      const nextLng = r.helperLng + (r.helperTargetLng - r.helperLng) * 0.18

    

      const closeEnough =
        Math.abs(nextLat - r.helperTargetLat) < 0.00015 &&
        Math.abs(nextLng - r.helperTargetLng) < 0.00015

      return {
        ...r,
        helperLat: nextLat,
        helperLng: nextLng,
        helperMoving: !closeEnough,
        helperArrived: closeEnough ? true : r.helperArrived,
        helperStatus: closeEnough ? "وصل للموقع" : r.helperStatus,
      }
    })
    .filter((r: any) => {
      const minutesPassed =
        Math.floor((Date.now() - r.createdAt) / 1000 / 60)

      if (r.resolved && r.solvedAt) {
        const solvedMinutes =
          Math.floor((Date.now() - r.solvedAt) / 1000 / 60)

        if (solvedMinutes >= 1) return false
      }

      return minutesPassed < (r.expiry || 45)
    })
)

  }, 1000)

  return () => clearInterval(timer)
}, [])

function canReceiveHelp(report: any) {
  return isAssistanceReport(report)
}

const needsHelper = selectedReport ? isAssistanceReport(selectedReport) : false

const showBottomActionBar =
  !showMobileDashboard &&
  !showReportsPage &&
  !showReportModal &&
  !showStolenModal &&
  !selectedReport;

async function getAddressFromCoords(lat: number, lng: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`
    )

    const data = await response.json()
    const address = data.address || {}

    const street =
      address.road ||
      address.street ||
      address.pedestrian ||
      address.footway ||
      address.cycleway ||
      address.highway ||
      address.path ||
      ""

    const area =
      address.neighbourhood ||
      address.suburb ||
      address.quarter ||
      address.city_district ||
      address.hamlet ||
      ""

    const city =
      address.city ||
      address.town ||
      address.village ||
      address.municipality ||
      ""

    const district =
      address.county ||
      address.state ||
      address.region ||
      ""

    const locationName =
      [street, area, city, district].filter(Boolean).join(" - ") ||
      data.display_name ||
      "موقع البلاغ"

    return {
      street,
      area: area || city || district || locationName,
      city,
      district,
      locationName
    }
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

  const [myLocation, setMyLocation] = useState<any>(null)

  useEffect(() => {
  const interval = setInterval(() => {
    setReports((currentReports: any) =>
      currentReports.filter((report: any) => {
        const minutesPassed =
          (Date.now() - report.createdAt) / 1000 / 60

        return minutesPassed < report.expiry
      })
    )
  }, 1000)

  return () => clearInterval(interval)
}, [])

useEffect(() => {
  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      setMyLocation([
        position.coords.latitude,
        position.coords.longitude,
      ])
    },
(error) => {
  console.log("GPS error:", error)
},
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 10000,
    }
  )

  return () => navigator.geolocation.clearWatch(watchId)
}, [])

/*  useEffect(() => {
  if (!myLocation) return

  const activeHelp = reports.find((r: any) =>
    r.helperId === deviceId &&
    r.helperComing &&
    !r.resolved
  )

  if (!activeHelp) return

  const updateHelperLocation = async () => {
    try {
      await updateDoc(doc(db, "reports", String(activeHelp.id)), {
        helperLat: myLocation[0],
        helperLng: myLocation[1],
        helperLocationUpdatedAt: Date.now()
      })
    } catch (error) {
      console.error("Failed to update helper live location", error)
    }
  }

  updateHelperLocation()
}, [myLocation, reports, deviceId])
*/

  useEffect(() => {
  const moveInterval = setInterval(() => {
    setReports((currentReports: any) =>
      currentReports.map((r: any) => {
        if (!r.isHelper) return r

        const nextLat = r.lat + (r.targetLat - r.lat) * 0.08
        const nextLng = r.lng + (r.targetLng - r.lng) * 0.08

        return {
          ...r,
          lat: nextLat,
          lng: nextLng,
          distance: "يقترب الآن",
        }
      })
    )
  }, 1000)

  return () => clearInterval(moveInterval)
}, [])

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

async function createUserReport(type: any) {
const lat = myLocation ? myLocation[0] : 33.8938
const lng = myLocation ? myLocation[1] : 35.5018
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

console.log("REPORT OWNER PHONE TEST:", {
  contactPhone,
  contactName,
  savedPhone: localStorage.getItem("contactPhone"),
  savedName: localStorage.getItem("contactName"),
})

  const newReport = {
    ownerId: deviceId,
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
    createdAt: Date.now(),
  }

addDoc(collection(db, "reports"), newReport)

setReportImage(null)
setReportImagePreview("")
setIsSubmittingReport(false)


setShowReportModal(false)
setReportDescription("")
}

const intelligenceCount =
  reports.filter((r: any) => !r.resolved && r?.reportFamily === "intelligence").length

const assistanceCount =
  reports.filter((r: any) => !r.resolved && r?.reportFamily === "assistance").length

const sharedRideCount =
  reports.filter((r: any) => !r.resolved && r?.reportFamily === "sharedRide").length

const stolenCount =
  reports.filter((r: any) => !r.resolved && r?.reportFamily === "stolen").length


const visibleReports = reports.filter((r: any) => {


  if (r.resolved) return false

  if (activeReportFamily !== "all" && r.reportFamily !== activeReportFamily) return false

  const isHelpRequest = canReceiveHelp(r)


return true

}).sort((a: any, b: any) => {
  if (a.ownerId === deviceId && b.ownerId !== deviceId) return -1
  if (a.ownerId !== deviceId && b.ownerId === deviceId) return 1
  return 0
})

  return (
    <>
<style>{`
@keyframes pulseMarker {
  0% { transform: scale(1); }
  50% { transform: scale(1.18); }
  100% { transform: scale(1); }
}
`}</style>
    <div style={{ height: "100dvh", width: "100%", background: "#020617", direction: "rtl", fontFamily: "Arial", position: "relative", overflow: "auto" }}>
{/* 
    {googleMapsApiKey && (
  <div
    style={{
      position: "fixed",
      top: 100,
      left: 10,
      width: "calc(100vw - 20px)",
      height: "60vh",
      zIndex: 999998,
      borderRadius: 14,
      overflow: "hidden",
      border: "3px solid #22c55e"
    }}
  >
    <LoadScript googleMapsApiKey={googleMapsApiKey}>
<GoogleMap
mapContainerStyle={{ width: "100%", height: "100%" }}
 center={{ lat: 33.8938, lng: 35.5018 }}
zoom={12}
>
  <MarkerF position={{ lat: 33.8938, lng: 35.5018 }} />
</GoogleMap>
    </LoadScript>
  </div>
)}   */}



      <MapContainer center={[33.8938, 35.5018]} zoom={12} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <FlyToReport target={mapTarget} />
        <MapZoomTracker setMapZoom={setMapZoom} />

        <MyLocation position={myLocation} />


{showBottomActionBar && (
        <button
  onClick={() => setShowReportModal(true)}
style={{
  position: "fixed",
  bottom: 10,
  left: 18,
  zIndex: 3000,
  width: 125,
  height: 46,
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: 999,
  fontWeight: "bold",
  fontSize: 13,
  cursor: "pointer",
  boxShadow: "0 8px 22px rgba(0,0,0,.35)"
}}
>
  🚨 تبليغ مباشر
</button>
)}

{myLocation && (
  <Marker position={myLocation} icon={makeIcon("🔵", "#2563eb")}>
    <Popup>موقعك الحالي</Popup>
  </Marker>
)}

{visibleReports.map((r: any) =>
  r.helperComing && r.helperLat && r.helperLng && !r.resolved ? (
    <Marker
      key={`helper-${r.id}`}
      position={[r.helperLat, r.helperLng]}
      icon={makeIcon("🏍️", "#2563eb")}
    >
      <Popup>المساعد في الطريق إليك</Popup>
    </Marker>
  ) : null
)}

{[...visibleReports]
  .sort((a, b) => {
  const priorityOrder: any = { high: 3, medium: 2, low: 1 }

  if (priorityOrder[b.priority] !== priorityOrder[a.priority]) {
    return priorityOrder[b.priority] - priorityOrder[a.priority]
  }

  const distanceA = calculateDistance(myLocation, [a.lat, a.lng]) ?? 999999
const distanceB = calculateDistance(myLocation, [b.lat, b.lng]) ?? 999999

if (distanceA !== distanceB) {
  return distanceA - distanceB
}

return b.createdAt - a.createdAt

  })

  .map((r, index) => (

<Fragment key={r.id || `${r.lat}-${r.lng}-${r.createdAt}-${index}`}>
<Marker

  key={r.id || `${r.lat}-${r.lng}-${r.createdAt}`}
  position={[r.lat, r.lng]}
icon={makeIcon(
  r.type?.includes("مسروقة") ? "🚨" : r.helperComing ? "🟢" : r.emoji,
  r.type?.includes("مسروقة") ? "#dc2626" : r.helperComing ? "#16a34a" : r.color
)}
eventHandlers={{
  click: () => {
    if (
      r.type === "زحمة" ||
      r.type === "حادث" ||
      r.type === "طريق مسكر" ||
      r.type === "طريق زلق"
    ) {
      return
    }

    if (r.ownerId === deviceId && !r.helperComing) {
  return
}

    setSelectedReport(r)
  },
}}
>
    <Popup>
      <div style={{ textAlign: "right", direction: "rtl" }}>
<b>{r.emoji} {r.type}</b>
<br />
📍 المنطقة: {r.area || "موقعك الحالي"}
<br />
🕒 وقت البلاغ: {new Date(r.createdAt || Date.now()).toLocaleTimeString("ar-LB", {
  hour: "2-digit",
  minute: "2-digit"
})}
<br />
⌛ ينتهي خلال: {Math.max(0, Math.ceil((((r.createdAt || Date.now()) + ((r.expiry || 0) * 1000) - Date.now()) / 60000)))} دقيقة
<br />

        <button
  onClick={() =>
    window.open(
      `https://www.google.com/maps?q=${r.lat},${r.lng}`,
      "_blank"
    )
  }
  style={{
    marginTop: 8,
    padding: "6px 10px",
    borderRadius: 8,
    border: "none",
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold"
  }}
>
  📍 إفتح موقع الحدث
</button>
{canReceiveHelp(r) && r.ownerId !== deviceId && (
<button
  onClick={() => setSelectedReport(r)}
  style={{
    marginTop: 8,
    padding: "6px 10px",
    borderRadius: 8,
    border: "none",
    background: "#16a34a",
    color: "white",
    cursor: "pointer",
    fontWeight: "bold",
    display: "block",
    width: "100%"
  }}
>
 {r.helperComing ? "✅ المساعدة بالطريق" : "🚑 أنا جاي أساعدك"}
</button>
)}

{r.helperComing && !r.type?.includes("مسروقة") && (
  <div style={{ marginTop: 8 }}>
    <div style={{ color: "#22c55e", fontWeight: "bold", marginBottom: 8 }}>
      ✅ مساعد بالطريق
    </div>

    <button
      onClick={() =>
        window.open(`https://www.google.com/maps?q=${r.lat},${r.lng}`, "_blank")
      }
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "none",
        background: "#2563eb",
        color: "white",
        cursor: "pointer",
        fontWeight: "bold",
        display: "block",
        width: "100%",
        marginBottom: 6
      }}
    >
      📍 فتح الموقع
    </button>
  </div>
)}


        <p style={{ color: "#94a3b8", marginTop: 6 }}>
          {timeAgo(r.createdAt)}
          <span style={{
  color: "#ffcc70",
  fontSize: 12,
  marginTop: 4
}}>
  ⏳ {timeLeft(r)}
</span>
        </p>
      </div>
    </Popup>
  </Marker>
{r.priority === "high" && mapZoom >= 14 && (
 <Fragment key={`circle-${r.id || r.createdAt}-${index}`}>



  <Circle
    center={[r.lat, r.lng]}
    radius={40}
    pathOptions={{
      color: r.color,
      fillColor: r.color,
      fillOpacity: r.priority === "high" ? 0.10 : 0.05,
      weight: r.priority === "high" ? 3 : 1
    }}
  />

  <Circle
    center={[r.lat, r.lng]}
    radius={60}
    pathOptions={{
      color: r.color,
      fillColor: r.color,
      fillOpacity: r.priority === "high" ? 0.05 : 0.02,
      weight: r.priority === "high" ? 2 : 1
    }}
  />
</Fragment>
)}
</Fragment>
))}

</MapContainer>

<button
  onClick={() => setShowTopInfo(!showTopInfo)}
  style={{
    position: "absolute",
    top: 18,
    left: 45,
    zIndex: 1001,
    background: "white",
    border: "none",
    borderRadius: 12,
    padding: "8px 12px",
    fontWeight: "bold"
  }}
>
  {showTopInfo ? "👁️" : "📊"}
</button>

{showTopInfo && (
<div style={{ position: "absolute", top: 8, right: 18, left: 85, zIndex: 1000, display: "flex", justifyContent: "space-between" }}>

<div style={{
  color: "#020617",
  fontWeight: "bold",
  fontSize: 24,
  textAlign: "center",
  textShadow: "0 1px 4px rgba(255,255,255,0.95)",
  lineHeight: 1.1
}}>
  🔴 {visibleReports.length}
  <div style={{
    fontSize: 16,
    marginTop: 4
  }}>
    بلاغات
  </div>

        </div>

        <button

onClick={(e) => {
  e.stopPropagation()

  if (myLocation) {
    setMapTarget([myLocation[0] + Math.random() * 0.000001, myLocation[1]])
    setMapZoom(16)
  }
}}

          style={{
           background: "transparent",
           color: "#020617",
           padding: "4px 6px",
           borderRadius: 0,
           textShadow: "0 1px 4px rgba(255,255,255,0.95)",
            border: "none",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          📍 موقعي GPS ✅
        </button>
      </div>
)}
<button
onClick={() => setShowCommunityCenter(true)}
style={{
  position: "fixed",
  top: 80,
  left: 10,
  zIndex: 999999,
  width: 32,
  height: 32,
  border: "none",
  background: "transparent",
  boxShadow: "none",
  padding: 0,
  cursor: "pointer",
  fontSize: 22,
  color: "#333"
}}
>
  ⚙️
</button>


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
    ["⚠️", "حادث", reports.filter((r:any) => r.type === "حادث").length],
    ["🚗", "زحمة", reports.filter((r:any) => r.type === "زحمة").length],
    ["⛔", "مسكر", reports.filter((r:any) => r.type === "طريق مسكر").length],
    ["🌊", "زلق", reports.filter((r:any) => r.type === "طريق زلق").length],
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

{/* Area / Street / City Search */}
<input
  value={reportsSearch}
  onChange={(e) => setReportsSearch(e.target.value)}
  placeholder="🔎 ابحث بالمنطقة، الشارع، المدينة..."
  style={{
    width: "100%",
    padding: "12px 14px",
    borderRadius: 14,
    border: "1px solid #e5e7eb",
    marginBottom: 14,
    fontSize: 14,
    direction: "rtl",
    outline: "none",
    boxShadow: "0 2px 8px rgba(0,0,0,.05)"
  }}
/>


    {/* Reports List */}
    {/* TEMP NEW REPORT CARDS - WILL BE REPLACED BY OLD WORKING ENGINE */}
    
    <div
style={{
  maxHeight: "calc(100vh - 240px)",
  overflowY: "scroll",
  overflowX: "hidden",
  touchAction: "pan-y",
  paddingBottom: 80
}}
>

{visibleReports
  .filter((r: any) => {
    if (activeReportFamily !== "all" && r.reportFamily !== activeReportFamily) return false

    const q = reportsSearch.trim().toLowerCase()
    if (!q) return true

    return `${r.area || ""} ${r.street || ""} ${r.locationName || ""} ${r.city || ""} ${r.type || ""}`
      .toLowerCase()
      .includes(q)
  })
  .map((r, index) => (


<div
  key={r.id || `${r.type}-${r.lat}-${r.lng}-${r.createdAt}`}

onClick={() => {
  setSelectedReport(r)
  setMapTarget([r.lat + Math.random() * 0.000001, r.lng])
  setShowReportsPage(false)
  setShowNearbyReports(false)
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
    padding: "4px 10px",
    borderRadius: 999,
    background:
      r.type.includes("مسروقة")
        ? "#fee2e2"
        : r.type.includes("حادث")
        ? "#fef3c7"
        : r.type.includes("بنزين")
        ? "#fff7ed"
        : r.type.includes("عطل")
        ? "#f3e8ff"
        : r.type.includes("وصلني")
        ? "#fce7f3"
        : "#e0f2fe",
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
      📍 {r.locationName || `${r.area || ""}${r.street ? " - " + r.street : ""}`}
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
  📍 {r.area}

{r.description && (
  <div style={{ marginTop: 4, color: "#e5e7eb", fontSize: 11, lineHeight: 1.25 }}>
    📝 {r.description}
  </div>
)}

{r.reportImageUrl && (
  <img
    src={r.reportImageUrl}
    alt="Report"
    loading="lazy"
    style={{
      width: "100%",
      maxHeight: 120,
      objectFit: "cover",
      borderRadius: 10,
      marginTop: 6
    }}
  />
)}

</div>

<div
  style={{
    color:
      Math.floor((Date.now() - (r.createdAt || Date.now())) / 60000) < 10
        ? "#22c55e"
        : Math.floor((Date.now() - (r.createdAt || Date.now())) / 60000) < 30
        ? "#f59e0b"
        : "#ef4444",
    fontSize: 10,
    marginTop: 2,
    fontWeight: "bold"
  }}
>
  ⏱️ منذ {Math.floor((Date.now() - (r.createdAt || Date.now())) / 60000)} دقيقة
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


{false && showNearbyReports && (
  <button
    onClick={() => setShowNearbyReports(false)}
    style={{
      position: "fixed",
      bottom: 80,
      left: 18,
      zIndex: 2500,
      background: "#020617",
      color: "white",
      border: "none",
      borderRadius: 999,
      padding: "10px 14px",
      fontWeight: "bold",
      boxShadow: "0 4px 14px rgba(0,0,0,.35)"
    }}
  >
    👁️ إخفاء البلاغات
  </button>
)}

{showBottomActionBar && (
<button
  onClick={() => {
    setShowReportsPage(true)
    setShowNearbyReports(false)
  }}
style={{
  position: "fixed",
  bottom: 10,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 3000,
  width: 125,
  height: 46,
  background: "#020617",
  color: "white",
  border: "none",
  borderRadius: 999,
  fontWeight: "bold",
  fontSize: 13,
  cursor: "pointer",
  boxShadow: "0 8px 22px rgba(0,0,0,.35)"
}}
  >


    👁️ إظهار البلاغات
  </button>
)}

      {showMobileDashboard && (
<div style={{ position: window.innerWidth <= 600 ? "fixed" : "absolute", bottom: 0, right: 0, left: 0, zIndex: 1500, background: "rgba(2,6,23,.96)", padding: window.innerWidth <= 600 ? 8 : 12, display: window.innerWidth <= 600 ? "grid" : "flex", gridTemplateColumns: window.innerWidth <= 600 ? "repeat(3, 1fr)" : undefined, gap: 10, overflowX: window.innerWidth <= 600 ? "hidden" : "auto" }}>
        <button
  onClick={() => setShowMobileDashboard(false)}
  style={{
position: "fixed",
bottom: 185,
right: 12,
display: window.innerWidth <= 600 ? "block" : "none",
    background: "#111827",
    color: "white",
    border: "none",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: "bold",
    zIndex: 2001
  }}
>
  👁️ إخفاء
</button>
        {reportTypes.map((btn) => (
          <button key={btn.label} onClick={() => {

  if (btn.label.includes("مسروقة")) {
    setShowStolenModal(true)
    return
  }

  
if (btn.reportFamily === "assistance" || btn.reportFamily === "sharedRide") {
  ensureContactInfo(() => {
    setPendingReportType(btn)
    setShowDescriptionModal(true)
    setShowMobileDashboard(false)
  })
  return
}

setPendingReportType(btn)
setShowDescriptionModal(true)
setShowMobileDashboard(false)

}} style={{ minWidth: window.innerWidth <= 600 ? 0 : 108, border: "none", borderRadius: 1, padding: "1px 1px", background: btn.color, color: "white", fontWeight: "bold", fontSize: 12 }}>
            <div style={{ fontSize: 23 }}>{btn.emoji}</div>
            {btn.label}
          </button>
        ))}
      </div>
)}
     {false && selectedType && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "end", justifyContent: "center", padding: 20 }}>
          <div style={{
  background: "linear-gradient(180deg,#071226,#0b1d3a)",
  width: "100%",
  maxWidth: 430,
  borderRadius: 32,
  padding: 26,
  boxShadow: "0 0 40px rgba(0,0,0,.45)",
  border: "1px solid rgba(255,255,255,.08)",
  color: "white",
  animation: "popupShow .25s ease"
}}>
            <h2>إرسال البلاغ؟</h2>

            <button onClick={sendReport} style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 18 }}>
              إرسال
            </button>

            <button onClick={() => setSelectedType(null)} style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 10, background: "#e5e7eb", fontWeight: "bold" }}>
              إلغاء
            </button>
          </div>
        </div>
      )}

{false && !showMobileDashboard && window.innerWidth <= 600 && (
  <button
    onClick={() => setShowMobileDashboard(true)}
style={{
  position: "fixed",
  bottom: 10,
  right: 18,
  zIndex: 3000,
  width: 125,
  height: 46,
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: 999,
  fontWeight: "bold",
  fontSize: 13,
  cursor: "pointer",
  boxShadow: "0 8px 22px rgba(0,0,0,.35)"
}}
  >
    👁️ إظهار الأدوات
  </button>
 )}

  </div>


      {false && showNearbyReports && !showReportsPage && (
<div style={{
  position: "fixed",
  bottom: 155,
  right: 14,
  left: 14,
  zIndex: 1000,
background: "transparent",
color: "white",
borderRadius: 0,
padding: 0,
height:
  reportsSheetMode === "collapsed"
    ? "22vh"
    : reportsSheetMode === "half"
    ? "55vh"
    : "82vh",
transition: "height .25s ease",
overflow: "visible",
overscrollBehavior: "contain",
WebkitOverflowScrolling: "touch",
touchAction: "pan-y",
paddingBottom: 12
}}>

<div
  style={{
    display: "flex",
    gap: 6,
    overflowX: "auto",
    marginBottom: 10,
    paddingBottom: 8,
  }}
>

<button
  onClick={() => setActiveReportFamily("all")}
  style={{
    background: activeReportFamily === "all" ? "#020617" : "#f1f5f9",
    color: activeReportFamily === "all" ? "white" : "#020617",
    border: activeReportFamily === "all" ? "2px solid #94a3b8" : "1px solid white",
    borderRadius: 999,
    padding: "8px 12px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
    boxShadow: activeReportFamily === "all"
      ? "0 0 14px rgba(148,163,184,.6)"
      : "none",
    transform: activeReportFamily === "all"
      ? "scale(1.05)"
      : "scale(1)",
    transition: "all .2s ease"
  }}
>
  🌍 الكل
</button>

<button
onClick={() => setActiveReportFamily("intelligence")}
style={{
  background: activeReportFamily === "intelligence" ? "#020617" : "#f1f5f9",
  color: activeReportFamily === "intelligence" ? "white" : "#2563eb",
  border: activeReportFamily === "intelligence" ? "2px solid #38bdf8" : "1px solid white",
  borderRadius: 999,
  padding: "8px 12px",
  fontWeight: "bold",
  whiteSpace: "nowrap",
  boxShadow: activeReportFamily === "intelligence"
    ? "0 0 14px rgba(56,189,248,.6)"
    : "none",
  transform: activeReportFamily === "intelligence"
    ? "scale(1.05)"
    : "scale(1)",
  transition: "all .2s ease"
}}
>
  🛣️ حالة الطرق ({intelligenceCount})
</button>

<button
  onClick={() => setActiveReportFamily("assistance")}
  style={{
    background: activeReportFamily === "assistance" ? "#052e16" : "#f1f5f9",
    color: activeReportFamily === "assistance" ? "white" : "#16a34a",
    border: activeReportFamily === "assistance" ? "2px solid #22c55e" : "1px solid white",
    borderRadius: 999,
    padding: "8px 12px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
    boxShadow: activeReportFamily === "assistance"
      ? "0 0 14px rgba(34,197,94,.6)"
      : "none",
    transform: activeReportFamily === "assistance"
      ? "scale(1.05)"
      : "scale(1)",
    transition: "all .2s ease"
  }}
>
  🤝 طلبات المساعدة ({assistanceCount})
</button>

<button
  onClick={() => setActiveReportFamily("sharedRide")}
  style={{
    background: activeReportFamily === "sharedRide" ? "#3b0764" : "#f1f5f9",
    color: activeReportFamily === "sharedRide" ? "white" : "#9333ea",
    border: activeReportFamily === "sharedRide" ? "2px solid #c084fc" : "1px solid white",
    borderRadius: 999,
    padding: "8px 12px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
    boxShadow: activeReportFamily === "sharedRide"
      ? "0 0 14px rgba(192,132,252,.6)"
      : "none",
    transform: activeReportFamily === "sharedRide"
      ? "scale(1.05)"
      : "scale(1)",
    transition: "all .2s ease"
  }}
>
  🏍️ وصلني معك ({sharedRideCount})
</button>

<button
  onClick={() => setActiveReportFamily("stolen")}
  style={{
    background: activeReportFamily === "stolen" ? "#450a0a" : "#f1f5f9",
    color: activeReportFamily === "stolen" ? "white" : "#dc2626",
    border: activeReportFamily === "stolen" ? "2px solid #ef4444" : "1px solid white",
    borderRadius: 999,
    padding: "8px 12px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
    boxShadow: activeReportFamily === "stolen"
      ? "0 0 14px rgba(239,68,68,.6)"
      : "none",
    transform: activeReportFamily === "stolen"
      ? "scale(1.05)"
      : "scale(1)",
    transition: "all .2s ease"
  }}
>
 🚨 الدراجات المسروقة ({stolenCount})
</button>
</div>



<div
  style={{
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,

  }}
>

<div style={{
  
color:
  activeReportFamily === "intelligence" ? "#2563eb" :
  activeReportFamily === "assistance" ? "#16a34a" :
  activeReportFamily === "sharedRide" ? "#ea580c" :
  activeReportFamily === "stolen" ? "#dc2626" :
  "#020617",

  fontWeight: "bold",
  textShadow: "0 1px 3px rgba(255,255,255,.9)"
}}>

{activeReportFamily === "intelligence" ? "🛣️ حالة الطرق القريبة" :
 activeReportFamily === "assistance" ? "🤝 طلبات المساعدة القريبة" :
 activeReportFamily === "sharedRide" ? "🏍️ وصلني معك قريباً" :
 activeReportFamily === "stolen" ? "🚨 الدراجات المسروقة القريبة" :
 "بلاغات قريبة"}

  </div>

  <div>
  <button
  onClick={() => setShowReportsPage(true)}
    style={{
      background: "transparent",
      color: "#020617",
      textShadow: "0 1px 3px rgba(255,255,255,.9)",
      border: "none",
      fontSize: 14,
      cursor: "pointer",
      marginRight: 8
    }}
  >
    👁️ إخفاء
  </button>

  <button
    onClick={() => {
  if (reportsSheetMode === "collapsed") {
    setReportsSheetMode("half")
  } else if (reportsSheetMode === "half") {
    setReportsSheetMode("full")
  } else {
    setReportsSheetMode("collapsed")
  }
}}
    style={{
      background: "transparent",
      color: "#020617",
      border: "none",
      fontSize: 18,
      cursor: "pointer"
    }}
  >
    {reportsSheetMode === "collapsed"
  ? "⬆️ نصف الشاشة"
  : reportsSheetMode === "half"
  ? "⬆️ شاشة كاملة"
  : "⬇️ تصغير"}
  </button>

</div>
</div>

<div style={{
height:
  reportsSheetMode === "collapsed"
    ? "22vh"
    : reportsSheetMode === "half"
    ? "55vh"
    : "82vh",

transition: "height .25s ease",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch"
}}>


    
{false && visibleReports.map((r, index) => (

<div
  key={r.id || `${r.type}-${r.lat}-${r.lng}-${r.createdAt}`}

onClick={() => {
  if (
    r.type === "زحمة" ||
    r.type === "حادث" ||
    r.type === "طريق مسكر" ||
    r.type === "طريق زلق"
  ) {
    return
  }

if (
  r.ownerId === deviceId &&
  !r.helperComing &&
  !r.type?.includes("مسروقة")
) {
  return
}

  setSelectedReport(r)
  setMapTarget([r.lat + Math.random() * 0.000001, r.lng])
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
<div>

<>


  {r.emoji} {r.type}

{(r.locationName || r.area || r.street) && (
  <div
    style={{
      marginTop: 4,
      fontSize: 12,
      fontWeight: "800",
      color: "#ffffff",
      lineHeight: 1.4,
      direction: "rtl",
    }}
  >
    📍 {r.locationName || `${r.area || ""}${r.street ? " - " + r.street : ""}`}
  </div>
)}

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
📍 {(r as any).street
  ? `${(r as any).street} - ${r.area}`
  : r.area || "موقع البلاغ"}

{r.description && (
  <div style={{ marginTop: 4, color: "#e5e7eb", fontSize: 11, lineHeight: 1.25 }}>
    📝 {r.description}
  </div>
)}

</div>

<div
  style={{
    color:
      Math.floor((Date.now() - (r.createdAt || Date.now())) / 60000) < 10
        ? "#22c55e"
        : Math.floor((Date.now() - (r.createdAt || Date.now())) / 60000) < 30
        ? "#f59e0b"
        : "#ef4444",
    fontSize: 10,
    marginTop: 2,
    fontWeight: "bold"
  }}
>
  ⏱️ منذ {Math.floor((Date.now() - (r.createdAt || Date.now())) / 60000)} دقيقة
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
           window.open(`https://wa.me/961${String(r.ownerPhone || r.phone || "").replace(/^0/, "")}`, "_blank")
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


{false && showNearbyReports && (
  <button
    onClick={() => setShowNearbyReports(false)}
    style={{
      position: "fixed",
      bottom: 80,
      left: 18,
      zIndex: 2500,
      background: "#020617",
      color: "white",
      border: "none",
      borderRadius: 999,
      padding: "10px 14px",
      fontWeight: "bold",
      boxShadow: "0 4px 14px rgba(0,0,0,.35)"
    }}
  >
    👁️ إخفاء البلاغات
  </button>
)}


{false && (
<button
  onClick={() => {
    setShowReportsPage(true)
    setShowNearbyReports(false)
  }}
  style={{
    position: "absolute",
    bottom: 10,
    right: 14,
    zIndex: 1200,
    background: "#020617",
    color: "white",
    border: "none",
    borderRadius: 999,
    padding: "12px 18px",
    fontWeight: "bold",
    cursor: "pointer"
  }}
>
  👁️ إظهار البلاغات
</button>
)}



      {showMobileDashboard && (
<div style={{ position: window.innerWidth <= 600 ? "fixed" : "absolute", bottom: 0, right: 0, left: 0, zIndex: 1500, background: "rgba(2,6,23,.96)", padding: window.innerWidth <= 600 ? 8 : 12, display: window.innerWidth <= 600 ? "grid" : "flex", gridTemplateColumns: window.innerWidth <= 600 ? "repeat(3, 1fr)" : undefined, gap: 10, overflowX: window.innerWidth <= 600 ? "hidden" : "auto" }}>
        <button
  onClick={() => setShowMobileDashboard(false)}
  style={{
position: "fixed",
bottom: 185,
right: 12,
display: window.innerWidth <= 600 ? "block" : "none",
    background: "#111827",
    color: "white",
    border: "none",
    borderRadius: 999,
    padding: "10px 14px",
    fontWeight: "bold",
    zIndex: 2001
  }}
>
  👁️ إخفاء
</button>
        {reportTypes.map((btn) => (
          <button key={btn.label} onClick={() => {

  if (btn.label.includes("مسروقة")) {
    setShowStolenModal(true)
    return
  }

 setPendingReportType(btn)
setShowDescriptionModal(true)
setShowMobileDashboard(false) 

}} style={{ minWidth: window.innerWidth <= 600 ? 0 : 108, border: "none", borderRadius: 1, padding: "1px 1px", background: btn.color, color: "white", fontWeight: "bold", fontSize: 12 }}>
            <div style={{ fontSize: 23 }}>{btn.emoji}</div>
            {btn.label}
          </button>
        ))}
      </div>
)}
      {selectedType && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,.35)", display: "flex", alignItems: "end", justifyContent: "center", padding: 20 }}>
          <div style={{
  background: "linear-gradient(180deg,#071226,#0b1d3a)",
  width: "100%",
  maxWidth: 430,
  borderRadius: 32,
  padding: 26,
  boxShadow: "0 0 40px rgba(0,0,0,.45)",
  border: "1px solid rgba(255,255,255,.08)",
  color: "white",
  animation: "popupShow .25s ease"
}}>
            <h2>إرسال البلاغ؟</h2>

            <button onClick={sendReport} style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 18 }}>
              إرسال
            </button>

            <button onClick={() => setSelectedType(null)} style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 10, background: "#e5e7eb", fontWeight: "bold" }}>
              إلغاء
            </button>
          </div>
        </div>
      )}

{!showMobileDashboard && window.innerWidth <= 600 && (
  <button
    onClick={() => setShowMobileDashboard(true)}
    style={{
      position: "fixed",
      bottom: 10,
      right: 12,
      zIndex: 2000,
      background: "#dc2626",
      color: "white",
      border: "none",
      borderRadius: 999,
      padding: "14px 24px",
      fontWeight: "bold"
    }}
  >
    👁️ إظهار الأدوات
  </button>
)}    

{showReportModal && (
  <div style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div style={{ background: "white", width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto", borderRadius: 28, padding: 24, textAlign: "center", direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>شو بدك تبلّغ؟</h2>

  

<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 18 }}>
  {reportTypes.map((type) => (
    <button
      key={type.label}



      onClick={() => {
  if (type.label.includes("مسروقة")) {
    setShowReportModal(false)
    setShowStolenModal(true)
    return
  }
if (type.reportFamily === "assistance" || type.reportFamily === "sharedRide") {
  ensureContactInfo(() => {
    setShowReportModal(false)
    setPendingReportType(type)
    setShowDescriptionModal(true)
    setShowMobileDashboard(false)
  })
  return
}

setShowReportModal(false)
setPendingReportType(type)
setShowDescriptionModal(true)
setShowMobileDashboard(false)
}}
      style={{
        padding: "14px 8px",
        borderRadius: 18,
        border: "none",
        background: type.color,
        color: "white",
        fontWeight: "bold",
        fontSize: 18,
        cursor: "pointer"
      }}
    >
      <div style={{ fontSize: 22 }}>{type.emoji}</div>
      {type.label}
    </button>
  ))}
</div>

<button
  onClick={() => setShowReportModal(false)}
  style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 12 }}
>
  إغلاق
</button>
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
        إضافة ملاحظة (اختياري)
      </h3>

      <textarea
        value={reportDescription}
        onChange={(e) => setReportDescription(e.target.value)}
        placeholder="مثال: زحمة قوية بسبب حادث"
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

    setIsSubmittingReport(true)

    const finalDescription = reportDescription

const submitAction = async () => {
  await createUserReport({
    ...pendingReportType,
    description: finalDescription
  })

  setReportDescription("")
  setShowDescriptionModal(false)
  setShowReportModal(false)
}

if (
  pendingReportType?.reportFamily === "assistance" ||
  pendingReportType?.reportFamily === "sharedRide"
) {
  ensureContactInfo(submitAction)
  return
}

await submitAction()
 
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
    <div style={{ background: "#020617", width: "100%", maxWidth: 430, borderRadius: 28, padding: 22, textAlign: "center", direction: "rtl", color: "white" }}>
      <h2>🚨 الإبلاغ عن دراجة مسروقة</h2>

      <p style={{ color: "#fca5a5", fontSize: 13 }}>
        صورة الدراجة إلزامية لتجنب أي التباس أو مشاكل مع الآخرين
      </p>

<input value={stolenBikeType} onChange={(e) => setStolenBikeType(e.target.value)} placeholder="🏍️ نوع الدراجة" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<input value={stolenBikeColor} onChange={(e) => setStolenBikeColor(e.target.value)} placeholder="🎨 اللون" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<input value={stolenBikePlate} onChange={(e) => setStolenBikePlate(e.target.value)} placeholder="🔢 رقم اللوحة إذا موجود" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<input value={stolenBikePhone} onChange={(e) => setStolenBikePhone(e.target.value)} placeholder="📞 رقم التواصل" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16}} />
<input value={stolenBikePlace} onChange={(e) => setStolenBikePlace(e.target.value)} placeholder="📍 مكان السرقة" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16 }} />
<input value={stolenBikeDate} onChange={(e) => setStolenBikeDate(e.target.value)} type="date" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16}} />
<input value={stolenBikeTime} onChange={(e) => setStolenBikeTime(e.target.value)} type="time" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 , fontSize: 16}} />

    <input
  type="file"
  accept="image/*"
   multiple
  onChange={(e) => {
const files = Array.from(e.target.files || []).slice(0, 5)
if (files.length === 0) return

setStolenBikeImages(files)
setStolenBikeImagePreviews(files.map((file) => URL.createObjectURL(file)))
  }}
  style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14, background: "white", color: "black" }}
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
      <h2>⚙️ توتيموتو</h2>

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
          <button style={communityBtnStyle}>
            إرسال الملاحظة
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
<div>📍 مكان السرقة: <b>{selectedReport.street || selectedReport.area || selectedReport.stolenBikePlace || "غير محدد"}</b></div>
<div>🗓️ التاريخ: <b>{selectedReport.stolenBikeDate || "غير محدد"}</b></div>
<div>⏰ الوقت: <b>{selectedReport.stolenBikeTime || "غير محدد"}</b></div>
<div>📞 رقم التواصل: <b>{selectedReport.stolenBikePhone || "غير محدد"}</b></div>
        </div>

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

        <div style={{ color: "#94a3b8", marginTop: 8, fontSize: 15 }}>
          {selectedReport.area}
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
</>
)
}

export default App





