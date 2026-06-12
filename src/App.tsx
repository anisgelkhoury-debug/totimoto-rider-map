import { Fragment, useEffect, useState, useRef } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, useMapEvents } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L, { DivIcon } from "leaflet"
import { db } from "./firebase"
import { collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc } from "firebase/firestore"

type ReportItem = {
  id?: number
  type: string
  area: string
  distance: string
  lat: number
  lng: number
  ownerId?: string
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

}

const reportTypes = [
  { label: "بلاغ عن دراجة مسروقة", emoji: "🚨", color: "#7f1d1d", expiry: 43200, priority: "high", reportFamily: "stolen", reportCategory: "stolen" },
  { label: "زحمة", emoji: "🚗", color: "#dc2626", expiry: 15, priority: "medium", reportFamily: "intelligence", reportCategory: "traffic" },
  { label: "حادث", emoji: "⚠️", color: "#f97316", expiry: 45, priority: "high", reportFamily: "intelligence", reportCategory: "accident" },
  { label: "طريق مسكر", emoji: "⛔", color: "#1d4ed8", expiry: 45, priority: "medium", reportFamily: "intelligence", reportCategory: "road_closed" },
  { label: "طريق زلق", emoji: "🌊", color: "#06b6d4", expiry: 45, priority: "high", reportFamily: "intelligence", reportCategory: "slippery_road" },
  { label: "عطل بالدراجة", emoji: "🔧", color: "#7c3aed", expiry: 45, priority: "medium", reportFamily: "assistance", reportCategory: "bike_broken" },
  { label: "محتاج دفشي", emoji: "🛵", color: "#16a34a", expiry: 30, priority: "medium", reportFamily: "assistance", reportCategory: "push" },
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
  width:18px;
  height:18px;
  border-radius:50%;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:9px;
box-shadow:

  color === "#dc2626"
    ? "0 0 25px rgba(220,38,38,0.9)"
    : "0 0 12px rgba(0,0,0,0.4)";

animation:
  color === "#dc2626"
    ? "pulseMarker 1.2s infinite"
    : "none";
">
  ${emoji}
</div>
`,

    iconSize: [24, 24],
    iconAnchor: [22, 22],
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
  const [showReportModal, setShowReportModal] = useState(false)
const [mapZoom, setMapZoom] = useState(12)
  const [mapTarget, setMapTarget] = useState<any>(null)
  const [showStolenModal, setShowStolenModal] = useState(false)
const [showMobileDashboard, setShowMobileDashboard] = useState(true)
const [showTopInfo, setShowTopInfo] = useState(true)
const [showNearbyReports, setShowNearbyReports] = useState(true)
const [expandNearbyReports, setExpandNearbyReports] = useState(false)


const [stolenBikeType, setStolenBikeType] = useState("")
const [stolenBikeColor, setStolenBikeColor] = useState("")
const [stolenBikePlate, setStolenBikePlate] = useState("")
const [stolenBikePhone, setStolenBikePhone] = useState("")
const [stolenBikePlace, setStolenBikePlace] = useState("")
const [stolenBikeDate, setStolenBikeDate] = useState("")
const [stolenBikeTime, setStolenBikeTime] = useState("")

const [stolenBikeImage, setStolenBikeImage] = useState<any>(null)
const [stolenBikeImagePreview, setStolenBikeImagePreview] = useState<string>("")

async function submitStolenBikeReport() {
  try {

 ;(document.activeElement as HTMLElement)?.blur()   

    const reportData = {
      id: Date.now(),

      type: "بلاغ عن دراجة مسروقة",
      reportFamily: "stolen",
      reportCategory: "stolen",
      emoji: "🚨",
      priority: "high",
      ownerId: deviceId,

      area: "موقعك الحالي",
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

      lat: myLocation?.[0] || 0,
      lng: myLocation?.[1] || 0,

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

  } catch (error) {

    console.error(error)

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
helperPhone: "03211183",
helperLat: myLocation ? myLocation[0] : null,
helperLng: myLocation ? myLocation[1] : null,
helperLocationUpdatedAt: Date.now(),

helperAcceptedAt: Date.now()
    })

  setSelectedReport(null)  
   
  } catch (error) {
    console.error(error)
    alert("❌ فشل تحديث المساعدة")
  }
}

async function cancelReport(report: any) {
  try {
    await deleteDoc(doc(db, "reports", String(report.id)))
    setSelectedReport(null)
    alert("✅ تم إلغاء الطلب")
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
    type: "محتاج دفش",
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

const assistanceTypes = [
  "عطل بالدراجة",
  "ما معي بنزين",
  "محتاج دفشي",
  "وصلني معك"
]

function canReceiveHelp(report: any) {
  return assistanceTypes.includes(report.type)
}

const needsHelper =
selectedReport?.type === "حادث" ||
selectedReport?.type === "محتاج دفشة" ||
selectedReport?.type === "ما معي بنزين" ||
selectedReport?.type === "عطل بالدراجة" ||
selectedReport?.type === "وصلني معك"


async function getAddressFromCoords(lat: number, lng: number) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=ar`
    )

    const data = await response.json()
    const address = data.address || {}

  const road =
  address.road ||
  address.street ||
  address.pedestrian ||
  address.footway ||
  address.cycleway ||
  address.highway ||
  address.path ||
  ""

    const town =
      address.village ||
      address.town ||
      address.city ||
      address.suburb ||
      address.neighbourhood ||
      ""
    const district = address.county || address.state || ""

    return [road, town, district].filter(Boolean).join(" - ") || "موقع البلاغ"
  } catch (error) {
    console.error("Reverse geocoding failed:", error)
    return "موقع البلاغ"
  }
}



async function addReport(type: any) {
 

if (type.label.includes("مسروقة")) {
  setShowReportModal(false)
  setShowStolenModal(true)
  return
}

  if (!myLocation) return

  const locationName = await getAddressFromCoords(myLocation[0], myLocation[1])

  const newReport = {
    ownerId: deviceId,
    type: type.label,
    area: locationName,
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
const locationName = await getAddressFromCoords(lat, lng)
  const newReport = {
    ownerId: deviceId,
      phone: "03211183",
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

    area: locationName,
    distance: "مباشر",
   lat,
   lng,
    createdAt: Date.now(),
  }

addDoc(collection(db, "reports"), newReport)
setShowReportModal(false)
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

  if (isHelpRequest && myLocation) {
    const distanceKm = calculateDistance(myLocation, [r.lat, r.lng])

    if (distanceKm !== null && distanceKm > 10) {
      return false
    }
  }

  if (mapZoom >= 14) return true

  if (mapZoom >= 12) return r.priority !== "low"

  return r.priority === "high"
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
      <MapContainer center={[33.8938, 35.5018]} zoom={12} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <FlyToReport target={mapTarget} />
        <MapZoomTracker setMapZoom={setMapZoom} />

        <MyLocation position={myLocation} />



        <button
  onClick={() => setShowReportModal(true)}
  style={{
position: "fixed",
bottom: 10,
left: 12,
    zIndex: 2000,

    display: showMobileDashboard && window.innerWidth <= 600 ? "none" : "block",

    background: "#dc2626",
    color: "white",
    border: "none",
    borderRadius: "16px",
    padding: "12px 16px",
    fontSize: "15px",
    fontWeight: "bold",
    cursor: "pointer",
    boxShadow: "0 6px 20px rgba(0,0,0,0.4)"
  }}
>
  🚨 تبليغ مباشر
</button>

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
{r.priority === "high" && (
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
    left: 18,
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
<div style={{ position: "absolute", top: 18, right: 18, left: 18, zIndex: 1000, display: "flex", justifyContent: "space-between" }}>

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
      {showNearbyReports && (
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
maxHeight: expandNearbyReports ? "40vh" : "22vh",
overflowY: "auto",
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
    paddingBottom: 4
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
    onClick={() => setShowNearbyReports(false)}
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
    onClick={() => setExpandNearbyReports(!expandNearbyReports)}
    style={{
      background: "transparent",
      color: "#020617",
      border: "none",
      fontSize: 18,
      cursor: "pointer"
    }}
  >
    {expandNearbyReports ? "🔽" : "🔼"}
  </button>

</div>
</div>

<div style={{
maxHeight: expandNearbyReports ? "38vh" : "22vh",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch"
}}>

  
    
{visibleReports.map((r, index) => (

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

  if (r.ownerId === deviceId && !r.helperComing) {
  return
}

  setSelectedReport(r)
  setMapTarget([r.lat + Math.random() * 0.000001, r.lng])
}}

  style={{
    background: "#111827",
    borderRadius: 12,
    padding: 6,
    marginBottom: 6,
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  }}
>

    <div style={{ background: r.color, width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {r.emoji}
    </div>

<div style={{ flex: 1, color: "white", lineHeight: 1.25 }}>
  <div
  style={{
    fontSize: 14,
    fontWeight: "bold"
  }}
>
{r.emoji} {r.type}
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

  {r.helperComing && (
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
      onClick={() => helperRespond(r)}
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
           window.open(`https://wa.me/961${String(r.phone || "").replace(/^0/, "")}`, "_blank")
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


{showNearbyReports && (
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

{!showNearbyReports && (
  <button
    onClick={() => setShowNearbyReports(true)}
    style={{
      position: "absolute",
      bottom: 115,
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

  
  addReport(btn)

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
  createUserReport(type)
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
  onChange={(e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setStolenBikeImage(file)
    setStolenBikeImagePreview(URL.createObjectURL(file))
  }}
  style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14, background: "white", color: "black" }}
/>

{stolenBikeImagePreview && (
  <img
    src={stolenBikeImagePreview}
    style={{
      width: "100%",
      maxHeight: 180,
      objectFit: "cover",
      borderRadius: 16,
      marginTop: 10
    }}
  />
)}

      <button onClick={submitStolenBikeReport} style={{ width: "100%", padding: 15, marginTop: 14, borderRadius: 16, border: "none", background: "#dc2626", color: "white", fontWeight: "bold" }}>
        🚨 نشر البلاغ
      </button>

      <button onClick={() => setShowStolenModal(false)} style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 16, border: "none" }}>
        إلغاء
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

        <div style={{ marginTop: 18, textAlign: "right", lineHeight: 2 }}>
<div>🏍️ نوع الدراجة: <b>{selectedReport.stolenBikeType || "غير محدد"}</b></div>
<div>🎨 اللون: <b>{selectedReport.stolenBikeColor || "غير محدد"}</b></div>
<div>🔢 رقم اللوحة: <b>{selectedReport.stolenBikePlate || "غير محدد"}</b></div>
<div>📍 مكان السرقة: <b>{selectedReport.stolenBikePlace || selectedReport.area || "غير محدد"}</b></div>
<div>🗓️ التاريخ: <b>{selectedReport.stolenBikeDate || "غير محدد"}</b></div>
<div>⏰ الوقت: <b>{selectedReport.stolenBikeTime || "غير محدد"}</b></div>
<div>📞 رقم التواصل: <b>{selectedReport.stolenBikePhone || "غير محدد"}</b></div>
        </div>

        <div style={{ fontSize: 11, color: "red", marginTop: 8 }}>
  owner: {selectedReport.ownerId || "none"} <br />
  device: {deviceId}
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

{selectedReport.helperPhone &&
[
  "وصلني معك",
  "ما معي بنزين",
  "عطل بالدراجة",
  "محتاج دفشة"
].includes(selectedReport.type) && (

 <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, width: 220 }}>
    <button
      onClick={() =>window.location.href = `tel:${selectedReport.helperPhone}` }
     style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 12, marginRight: 0 }}
    >
      📞 اتصال
    </button>

    <button
      onClick={() => window.open(`https://wa.me/961${selectedReport.helperPhone.replace(/^0/, "")}`, "_blank")}
      style={{ width: "100%", padding: 8, borderRadius: 10, border: "none", background: "#22c55e", color: "white", fontWeight: "bold", fontSize: 12 , marginRight: 0 }}
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

  </div>
)}

{!selectedReport.type?.includes("مسروقة") &&
 !selectedReport.helperComing && (
        <button
          disabled={selectedReport.joined}
          onClick={() => helperRespond(selectedReport)}
          style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 18, marginTop: 20 }}
        >
          {selectedReport.joined ? "تم الانضمام ✅" : "أنا قريب"}
        </button>
)}



        <button
          onClick={() => setSelectedReport(null)}
          style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 10, background: "#e5e7eb", fontWeight: "bold" }}
        >

          إلغاء
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
