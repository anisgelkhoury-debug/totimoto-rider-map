import { useEffect, useState } from "react"
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"

const reportTypes = [
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
  { type: "زحمة", area: "الحمرا", distance: "700 متر", lat: 33.8938, lng: 35.5018, color: "#dc2626", emoji: "🚗" , priority: "high", },
  { type: "ما معي بنزين", area: "بدارو", distance: "2 كم", lat: 33.879, lng: 35.514, color: "#eab308", emoji: "⛽" , priority: "high", },
  { type: "محتاج دفشي", area: "الحازمية", distance: "1.1 كم", lat: 33.857, lng: 35.535, color: "#16a34a", emoji: "🛵", priority: "medium", },
]

function makeIcon(emoji: string, color: string) {
  return L.divIcon({
    className: "",
    html: `
<div style="
  background:${color};
  width:44px;
  height:44px;
  border-radius:50%;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:22px;
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

    iconSize: [44, 44],
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

function App() {
  const [selectedType, setSelectedType] = useState<any>(null)
  const [selectedReport, setSelectedReport] = useState<any>(null)
  const [reports, setReports] = useState(
  startingReports.map((r) => ({
    ...r,
    createdAt: Date.now(),
    expiry: 45,
  }))
)

const [, forceUpdate] = useState(0)

useEffect(() => {
  const timer = setInterval(() => {

    forceUpdate(prev => prev + 1)

    setReports(prev =>
      prev.filter(r => {
        const minutesPassed =
          Math.floor((Date.now() - r.createdAt) / 1000 / 60)

        return minutesPassed < r.expiry
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
    expiry: 45,
    helpers: 0,
    helpersList: [],
helperComing: false,
  }

  setReports((prev: any) => [newReport, ...prev])
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
    navigator.geolocation.getCurrentPosition((position) => {
      setMyLocation([
        position.coords.latitude,
        position.coords.longitude,
      ])
    })
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
      createdAt: Date.now(),
      expiry: selectedType.expiry,
    }

    setReports([newReport, ...reports])
    setSelectedType(null)
  }

  function helperRespond(report: any) {
const helperMarker = {
  type: "أنا قريب",
  area: "مساعد قريب منك",
  distance: "يتجه للمساعدة",
  lat: report.lat + 0.02,
  lng: report.lng + 0.02,
  targetLat: report.lat,
  targetLng: report.lng,
  isHelper: true,
  color: "#22c55e",
  emoji: "🛵",
  createdAt: Date.now(),
  expiry: 20,
}

    setReports([
  helperMarker,
  ...reports.map((r: any) =>
    r === report
      ? { ...r, helperComing: true }
      : r
  ),
])
    setSelectedReport(null)
  }

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

        <MyLocation position={myLocation} />

        {myLocation && (
          <Marker position={myLocation} icon={makeIcon("🔵", "#2563eb")}>
            <Popup>موقعك الحالي</Popup>
          </Marker>
        )}


{[...reports]
  .sort((a, b) => {
    const priorityOrder: any = { high: 3, medium: 2, low: 1 }
    return priorityOrder[b.priority] - priorityOrder[a.priority]
  })
  .map((r, index) => (


<Marker
  key={index}
  position={[r.lat, r.lng]}
  icon={makeIcon(r.emoji, r.color)}
  eventHandlers={{
    click: () => setSelectedReport(r),
  }}
>
    <Popup>
      <div style={{ textAlign: "right", direction: "rtl" }}>
        <b>{r.type}</b>
        <br />
        {r.area}
        <br />
        {r.distance}
        <br />

        <p style={{ color: "#94a3b8", marginTop: 6 }}>
          {timeAgo(r.createdAt)}
          <div style={{
  color: "#ffcc70",
  fontSize: 12,
  marginTop: 4
}}>
  ⏳ {timeLeft(r)}
</div>
        </p>
      </div>
    </Popup>
  </Marker>
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
              alert("تم تحديد موقعك")
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
  <div key={index} style={{ background: "#111827", borderRadius: 16, padding: 12, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
    <div style={{ background: r.color, width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {r.emoji}
    </div>

<div style={{ flex: 1, color: "white" }}>
  <b>{r.type}</b>

  <div style={{ color: "#94a3b8", fontSize: 13 }}>
    {r.area} • {r.distance}
  </div>

  {r.helperComing && (
    <span style={{ color: "#22c55e", marginRight: 8, fontWeight: "bold" }}>
      🛵 مساعد بالطريق
    </span>
  )}
</div>

<button onClick={() => setSelectedReport(r)} style={{ background: "white", border: "none", borderRadius: 12, padding: "9px 12px", fontWeight: "bold" }}>
  أنا قريب
</button>
          </div>
     ))}
     </div>

      <div style={{ position: "absolute", bottom: 0, right: 0, left: 0, zIndex: 1000, background: "rgba(2,6,23,.96)", padding: 12, display: "flex", gap: 10, overflowX: "auto" }}>
        {reportTypes.map((btn) => (
          <button key={btn.label} onClick={() => {
  setSelectedType(btn)
  addReport(btn.label, btn.color, btn.emoji)
}} style={{ minWidth: 108, border: "none", borderRadius: 18, padding: "13px 10px", background: btn.color, color: "white", fontWeight: "bold", fontSize: 14 }}>
            <div style={{ fontSize: 23 }}>{btn.emoji}</div>
            {btn.label}
          </button>
        ))}
      </div>

      {selectedType && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "end", justifyContent: "center", padding: 20 }}>
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

      {selectedReport && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "end", justifyContent: "center", padding: 20 }}>
          <div style={{ background: "white", width: "100%", maxWidth: 420, borderRadius: 28, padding: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 20 }}>
  <div style={{
    fontSize: 52,
    marginBottom: 10
  }}>
    {selectedReport.emoji}
  </div>

  <h2 style={{
    margin: 0,
    fontSize: 32,
    fontWeight: "bold"
  }}>
    {selectedReport.type}
  </h2>

  <div style={{
    color: "#94a3b8",
    marginTop: 8,
    fontSize: 15
  }}>
    {selectedReport.area}

<div style={{
  marginTop: 10,
  display: "inline-block",
  padding: "6px 12px",
  borderRadius: 999,
  background:
    selectedReport.priority === "high" ? "#dc2626" :
    selectedReport.priority === "medium" ? "#f97316" :
    "#2563eb",
  color: "white",
  fontWeight: "bold",
  fontSize: 13
}}>
  {selectedReport.priority === "high" ? "خطورة عالية" :
   selectedReport.priority === "medium" ? "متوسط الخطورة" :
   "منخفض الخطورة"}
</div>

  </div>

  <div style={{
    marginTop: 10,
    display: "inline-block",
    background: "rgba(255,255,255,.08)",
    padding: "8px 14px",
    borderRadius: 999
  }}>
    {selectedReport.distance}
    <div style={{
  marginTop: 10,
  color: "#facc15",
  fontWeight: "bold",
  fontSize: 14
}}>
  ⏳ {timeLeft(selectedReport)}
</div>
    {needsHelper && (
<div style={{
  marginTop: 14,
  fontWeight: "bold",
  color: "#16a34a",
  fontSize: 16
}}>
  👥 {selectedReport.helpers} أشخاص قادمين للمساعدة
<div style={{
  marginTop: 8,
  color: "#64748b",
  fontSize: 14
}}>
  {selectedReport.helpersList?.join(" • ")}
</div>
</div>
)}
  </div>
</div>

            <button
disabled={selectedReport.joined}
onClick={() => setSelectedReport({
  ...selectedReport,
  helperComing: true,
  joined: true,
  helpers: (selectedReport.helpers || 0) + 1,
  helpersList: [...(selectedReport.helpersList || []), "أنت"],
})} style={{ width: "100%", padding: 16, borderRadius: 18, border: "none", background: "#16a34a", color: "white", fontWeight: "bold", fontSize: 18 }}>
             {selectedReport.joined ? "تم الانضمام ✅" : "أنا قريب"}
            </button>

            <button

onClick={() => setSelectedReport(null)} style={{ width: "100%", padding: 14, borderRadius: 18, border: "none", marginTop: 10, background: "#e5e7eb", fontWeight: "bold" }}>
              إغلاق
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  )
}

export default App