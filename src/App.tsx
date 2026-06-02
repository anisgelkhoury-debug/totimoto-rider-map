import { Fragment, useEffect, useState } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, useMapEvents } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L, { DivIcon } from "leaflet"
import { db } from "./firebase"
import { collection, addDoc, onSnapshot, doc, updateDoc } from "firebase/firestore"

type ReportItem = {
  id?: number
  type: string
  area: string
  distance: string
  lat: number
  lng: number
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
}

const reportTypes = [
  { label: "بلاغ عن دراجة مسروقة", emoji: "🚨", color: "#7f1d1d", expiry: 43200, priority: "high" },
  { label: "زحمة", emoji: "🚗", color: "#dc2626", expiry: 15, priority: "high" },
  { label: "حادث", emoji: "⚠️", color: "#f97316", expiry: 45, priority: "high" },
  { label: "طريق مسكر", emoji: "⛔", color: "#1d4ed8", expiry: 45, priority: "high" },
  { label: "طريق زلق", emoji: "🌊", color: "#06b6d4", expiry: 45, priority: "high" },
  { label: "عطل بالدراجة", emoji: "🔧", color: "#7c3aed", expiry: 45, priority: "medium" },
  { label: "محتاج دفشي", emoji: "🛵", color: "#16a34a", expiry: 30, priority: "medium" },
  { label: "ما معي بنزين", emoji: "⛽", color: "#eab308", expiry: 30, priority: "medium" },
  { label: "وصلني معك", emoji: "🤝", color: "#db2777", expiry: 20, priority: "low" },
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
    priority: "high",
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

  useEffect(() => {
    if (position) {
      map.flyTo(position, 14)
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

useEffect(() => {
  const unsubscribe = onSnapshot(collection(db, "reports"), (snapshot) => {
   const liveReports: any = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }))

    console.log("LIVE REPORTS")
    console.log(liveReports)


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

    const reportData = {
      id: Date.now(),

      type: "بلاغ عن دراجة مسروقة",
      emoji: "🚨",
      priority: "high",

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

    alert("✅ تم نشر البلاغ")

  } catch (error) {

    console.error(error)

    alert("❌ فشل نشر البلاغ")

  }
}
  
async function helperRespond(report: any) {
  if (report.helperComing) {
    alert("✅ المساعدة قادمة بالفعل")
    return
  }

  try {
   await updateDoc(doc(db, "reports", String(report.id)), {
      helperComing: true,
      resolved: false,
      helperStatus: "بالطريق",
      helpers: 1,
      joined: true,
      helperLat: report.lat + 0.02,
      helperLng: report.lng + 0.02,
      helperTargetLat: report.lat,
      helperTargetLng: report.lng,
      helperMoving: true
    })

    alert("✅ أنت قريب - المساعدة بالطريق")
  } catch (error) {
    console.error(error)
    alert("❌ فشل تحديث المساعدة")
  }
}

function helperArrived(report: any) {
  setReports((prev: any[]) =>
    prev.map((r) =>
      r.id === report.id
        ? {
            ...r,
            helperArrived: true,
            helperStatus: "وصل للموقع",
          }
        : r
    )
  )

  alert("📍 تم تسجيل وصول المساعدة للموقع")
}

function resolveReport(report: any) {
  setReports((prev: any[]) =>
    prev.map((r) =>
      r.id === report.id
        ? {
            ...r,
            resolved: true,
solvedAt: Date.now(),
helperStatus: "تم حل المشكلة",
          }
        : r
    )
  )

  alert("✅ تم تسجيل حل المشكلة")
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
    priority: "high",
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

    console.log("TIMER RUNNING")

    forceUpdate(prev => prev + 1)

setReports(prev =>
  prev
    .map((r: any) => {

      console.log("CHECK REPORT", r.type, r.helperMoving, r.helperLat, r.helperLng)

      if (!r.helperMoving) return r
      if (!r.helperLat || !r.helperLng || !r.helperTargetLat || !r.helperTargetLng) return r

      const nextLat = r.helperLat + (r.helperTargetLat - r.helperLat) * 0.18
      const nextLng = r.helperLng + (r.helperTargetLng - r.helperLng) * 0.18

      console.log("HELPER MOVING", nextLat, nextLng)

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


const needsHelper =
  selectedReport?.type === "حادث" ||
  selectedReport?.type === "محتاج دفشة" ||
  selectedReport?.type === "ما معي بنزين" ||
  selectedReport?.type === "عطل بالدراجة"

function addReport(type: string, color: string, emoji: string) {
  console.log("TYPE RECEIVED:", type)

if (type.includes("مسروقة")) {
  setShowReportModal(false)
  setShowStolenModal(true)
  return
}

  if (!myLocation) return

  const newReport = {
    type,
    area: "موقع مباشر",
    distance: "الآن",
    lat: myLocation[0],
    lng: myLocation[1],
    color,
    emoji,
    createdAt: Date.now(),
    expiry:
  type === "زحمة" ? 30 :
  type === "حادث" ? 60 :
  type === "طريق مسكر" ? 120 :
  type === "ما معي بنزين" ? 20 :
  type === "محتاج دفشة" ? 45 :
  type === "عطل بالدراجة" ? 60 :
  type === "وصّلني معك" ? 20 :
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

function createUserReport(type: any) {
  const newReport = {
    ...type,
    area: "موقعك الحالي",
    distance: "مباشر",
    lat: myLocation ? myLocation[0] : 33.8938,
    lng: myLocation ? myLocation[1] : 35.5018,
    createdAt: Date.now(),
  }

  setReports(prev => [newReport, ...prev])
  setShowReportModal(false)
}


const visibleReports = reports.filter((r: any) => {
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
    <div style={{ height: "100vh", width: "100%", background: "#020617", direction: "rtl", fontFamily: "Arial", position: "relative", overflow: "hidden" }}>
      <MapContainer center={[33.8938, 35.5018]} zoom={12} style={{ height: "100%", width: "100%" }}>
        <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        <FlyToReport target={mapTarget} />
        <MapZoomTracker setMapZoom={setMapZoom} />

        <MyLocation position={myLocation} />

        {myLocation && (
  <div
    style={{
      position: "absolute",
      top: "95px",
      left: "20px",
      zIndex: 9999,
      background: "#00c853",
      color: "white",
      padding: "8px 12px",
      borderRadius: "12px",
      fontWeight: "bold",
      fontSize: "13px",
      boxShadow: "0 4px 10px rgba(0,0,0,0.3)"
    }}
  >
    GPS مباشر ✅
  </div>
)}

        <button
  onClick={() => setShowReportModal(true)}
  style={{
    position: "absolute",
    bottom: "30px",
    left: "28px",
    zIndex: 2000,
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
      icon={makeIcon("🟢", "#00ff00")}
    >
      <Popup>HELPER MARKER HERE</Popup>
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

<>
<Marker

  key={r.id || `${r.lat}-${r.lng}-${r.createdAt}`}
  position={[r.lat, r.lng]}
icon={makeIcon(
  r.type?.includes("مسروقة") ? "🚨" : r.helperComing ? "🟢" : r.emoji,
  r.type?.includes("مسروقة") ? "#dc2626" : r.helperComing ? "#16a34a" : r.color
)}
  eventHandlers={{
    click: () => {
 
  setSelectedReport(r)
},
  }}
>
    <Popup>
      <div style={{ textAlign: "right", direction: "rtl" }}>
        <b>{r.type}</b>
        <br />
        {r.area}
        <br />
        {formatDistance(calculateDistance(myLocation, [r.lat, r.lng]))}
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
  📍 افتح الطريق
</button>
{!r.type?.includes("مسروقة") && (
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
  <button
    onClick={() => helperArrived(r)}
    style={{
      marginTop: 8,
      padding: "6px 10px",
      borderRadius: 8,
      border: "none",
      background: "#0f766e",
      color: "white",
      cursor: "pointer",
      fontWeight: "bold",
      display: "block",
      width: "100%"
    }}
  >
  {r.helperArrived ? "✅ المساعدة وصلت" : "📍 وصلت للموقع"}
  </button>
)}

{r.helperArrived && !r.resolved && (
  <button
    onClick={() => resolveReport(r)}
    style={{
      marginTop: 8,
      padding: "6px 10px",
      borderRadius: 8,
      border: "none",
      background: "#22c55e",
      color: "white",
      cursor: "pointer",
      fontWeight: "bold",
      display: "block",
      width: "100%"
    }}
  >
    {r.resolved ? "✅ تم حل المشكلة" : "🛠️ تم حل المشكلة"}
  </button>
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
<></>
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
</>
))}

</MapContainer>
      <div style={{ position: "absolute", top: 18, right: 18, left: 18, zIndex: 1000, display: "flex", justifyContent: "space-between" }}>
        <div style={{ background: "#020617", color: "white", padding: "12px 18px", borderRadius: 20, fontWeight: "bold" }}>
          🔴 {reports.length} بلاغ مباشر
        <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
  آخر تحديث الآن
</div>
        </div>

        <button
onClick={() => {
  if (myLocation) {
    setMapTarget(myLocation)
  }
}}
          style={{
            background: "white",
            color: "#020617",
            padding: "12px 18px",
            borderRadius: 20,
            border: "none",
            fontWeight: "bold",
            cursor: "pointer"
          }}
        >
          📍 موقعي
        </button>
      </div>

      <div style={{ position: "absolute", bottom: 115, right: 14, left: 14, zIndex: 1000, background: "rgba(2,6,23,.92)", borderRadius: 26, padding: 14, maxHeight: 210, overflowY: "auto" }}>
        <div style={{ color: "white", fontWeight: "bold", marginBottom: 10 }}>بلاغات قريبة</div>

{reports.map((r, index) => (

<div
  key={r.id || `${r.type}-${r.lat}-${r.lng}-${r.createdAt}`}

onClick={() => {


  console.log("NEARBY CLICK REPORT:", r)

  setSelectedReport(r)

  setMapTarget([r.lat + Math.random() * 0.000001, r.lng])

}}

  style={{
    background: "#111827",
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    gap: 10
  }}
>

    <div style={{ background: r.color, width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {r.emoji}
    </div>

<div style={{ flex: 1, color: "white" }}>
  <b>{r.type}</b>

  <div style={{ color: "#94a3b8", fontSize: 13 }}>
    {r.area} • {r.distance}
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
  <>🟢 {r.helpers || 1} مساعد بالطريق • يصل خلال 3 دقائق</>
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
) : r.helperArrived ? (
  <button
    onClick={() => resolveReport(r)}
    style={{
      background: "#22c55e",
      color: "white",
      border: "none",
      borderRadius: 12,
      padding: "9px 12px",
      fontWeight: "bold"
    }}
  >
    🛠️ تم حل المشكلة
  </button>
) : r.helperComing ? (
  <button
    onClick={() => helperArrived(r)}
    style={{
      background: "#0f766e",
      color: "white",
      border: "none",
      borderRadius: 12,
      padding: "9px 12px",
      fontWeight: "bold"
    }}
  >
    📍 وصلت للموقع
  </button>
) : (
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
)}
          </div>
     ))}
     </div>

      <div style={{ position: "absolute", bottom: 0, right: 0, left: 0, zIndex: 1500, background: "rgba(2,6,23,.96)", padding: 12, display: "flex", gap: 10, overflowX: "auto" }}>
        {reportTypes.map((btn) => (
          <button key={btn.label} onClick={() => {

  if (btn.label.includes("مسروقة")) {
    setShowStolenModal(true)
    return
  }

  setSelectedType(btn)
  addReport(btn.label, btn.color, btn.emoji)

}} style={{ minWidth: 108, border: "none", borderRadius: 18, padding: "13px 10px", background: btn.color, color: "white", fontWeight: "bold", fontSize: 14 }}>
            <div style={{ fontSize: 23 }}>{btn.emoji}</div>
            {btn.label}
          </button>
        ))}
      </div>

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

{showReportModal && (
  <div style={{ position: "fixed", inset: 0, zIndex: 2500, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
    <div style={{ background: "white", width: "100%", maxWidth: 420, maxHeight: "80vh", overflowY: "auto", borderRadius: 28, padding: 24, textAlign: "center", direction: "rtl" }}>
      <h2 style={{ marginTop: 0 }}>شو بدك تبلّغ؟</h2>

<div style={{ display: "grid", gap: 10, marginTop: 18 }}>
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
        padding: "14px",
        borderRadius: 18,
        border: "none",
        background: type.color,
        color: "white",
        fontWeight: "bold",
        fontSize: 16,
        cursor: "pointer"
      }}
    >
      <div style={{ fontSize: 24 }}>{type.emoji}</div>
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

<input value={stolenBikeType} onChange={(e) => setStolenBikeType(e.target.value)} placeholder="🏍️ نوع الدراجة" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 }} />
<input value={stolenBikeColor} onChange={(e) => setStolenBikeColor(e.target.value)} placeholder="🎨 اللون" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 }} />
<input value={stolenBikePlate} onChange={(e) => setStolenBikePlate(e.target.value)} placeholder="🔢 رقم اللوحة إذا موجود" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 }} />
<input value={stolenBikePhone} onChange={(e) => setStolenBikePhone(e.target.value)} placeholder="📞 رقم التواصل" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 }} />
<input value={stolenBikePlace} onChange={(e) => setStolenBikePlace(e.target.value)} placeholder="📍 مكان السرقة" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 }} />
<input value={stolenBikeDate} onChange={(e) => setStolenBikeDate(e.target.value)} type="date" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 }} />
<input value={stolenBikeTime} onChange={(e) => setStolenBikeTime(e.target.value)} type="time" style={{ width: "100%", padding: 14, marginTop: 10, borderRadius: 14 }} />

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
              style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#22c55e", color: "white", fontWeight: "bold", fontSize: 18, marginTop: 10 }}
            >
              💬 واتساب
            </button>
          </>
        )}



        <button
          onClick={() => window.open(`https://www.google.com/maps?q=${selectedReport.lat},${selectedReport.lng}`, "_blank")}
          style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#2563eb", color: "white", fontWeight: "bold", fontSize: 18, marginTop: 10 }}
        >
          📍 فتح الموقع
        </button>

        <button
          onClick={() => setSelectedReport(null)}
          style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 10, background: "#e5e7eb", fontWeight: "bold" }}
        >
          إغلاق
        </button>
      </div>
    ) : (
      <div style={{ background: "white", width: "100%", maxWidth: 420, borderRadius: 28, padding: 24, textAlign: "center" }}>
        <div style={{ fontSize: 52, marginBottom: 10 }}>{selectedReport.emoji}</div>

        <h2 style={{ margin: 0, fontSize: 32, fontWeight: "bold" }}>
          {selectedReport.type}
        </h2>

        <div style={{ color: "#94a3b8", marginTop: 8, fontSize: 15 }}>
          {selectedReport.area}
        </div>
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
