import { Fragment, memo, useEffect, useMemo, useRef } from "react"
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  Circle,
} from "react-leaflet"
import "leaflet/dist/leaflet.css"
import L from "leaflet"
import { formatLebaneseLocationConcise } from "../utils/formatLebaneseLocation"
import { distanceKm } from "../utils/reportsRenderStability"
import { timeAgo, timeLeft } from "../utils/reportTimeLabels"

type LatLng = [number, number]

type LeafletReport = {
  id?: string | number
  type?: string
  lat: number
  lng: number
  color: string
  emoji: string
  priority?: string
  createdAt?: number
  expiry?: number
  ownerId?: string
  helperComing?: boolean
  helperLat?: number
  helperLng?: number
  resolved?: boolean
}

type Props = {
  userLocation: LatLng | null
  reports: LeafletReport[]
  mapTarget: LatLng | null
  mapZoom: number
  deviceId: string
  onReportSelect: (report: LeafletReport) => void
  onMapZoomChange: (zoom: number) => void
  canReceiveHelp: (report: LeafletReport) => boolean
}

const iconCache = new Map<string, L.DivIcon>()

function makeIcon(_emoji: string, color: string) {
  const cached = iconCache.get(color)
  if (cached) return cached
  const icon = new L.DivIcon({
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
  ${
    color === "#dc2626"
      ? "0 0 25px rgba(220,38,38,0.9)"
      : "0 0 12px rgba(0,0,0,0.4)"
  };
animation:
  ${color === "#dc2626" ? "pulseMarker 1.2s infinite" : "none"};
">
</div>
`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
  iconCache.set(color, icon)
  return icon
}

function MyLocation({ position }: { position: LatLng | null }) {
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

function FlyToReport({ target }: { target: LatLng | null }) {
  const map = useMap()

  useEffect(() => {
    if (target) {
      map.flyTo(target, 15, { duration: 1.2 })
    }
  }, [target, map])

  return null
}

function MapZoomTracker({
  onMapZoomChange,
}: {
  onMapZoomChange: (zoom: number) => void
}) {
  const map = useMap()

  useEffect(() => {
    const updateZoom = () => onMapZoomChange(map.getZoom())

    updateZoom()
    map.on("zoomend", updateZoom)

    return () => {
      map.off("zoomend", updateZoom)
    }
  }, [map, onMapZoomChange])

  return null
}

function distanceKmPair(from: LatLng | null, to: LatLng) {
  if (!from) return null
  return distanceKm(from[0], from[1], to[0], to[1])
}

function LeafletMapView({
  userLocation,
  reports,
  mapTarget,
  mapZoom,
  deviceId,
  onReportSelect,
  onMapZoomChange,
  canReceiveHelp,
}: Props) {
  const sortedReports = useMemo(() => {
    const priorityOrder: Record<string, number> = {
      high: 3,
      medium: 2,
      low: 1,
    }

    return [...reports].sort((a, b) => {
      const pa = priorityOrder[a.priority || ""] ?? 0
      const pb = priorityOrder[b.priority || ""] ?? 0

      if (pb !== pa) return pb - pa

      const distanceA =
        userLocation && a.lat && a.lng
          ? distanceKmPair(userLocation, [a.lat, a.lng]) ?? 999999
          : 999999

      const distanceB =
        userLocation && b.lat && b.lng
          ? distanceKmPair(userLocation, [b.lat, b.lng]) ?? 999999
          : 999999

      if (distanceA !== distanceB) return distanceA - distanceB

      return (b.createdAt || 0) - (a.createdAt || 0)
    })
  }, [reports, userLocation])

  return (
    <>
      <style>{`
@keyframes pulseMarker {
  0% { transform: scale(1); }
  50% { transform: scale(1.18); }
  100% { transform: scale(1); }
}
`}</style>
      <MapContainer
        center={userLocation || [33.875, 35.512]}
        zoom={userLocation ? 16 : 13}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FlyToReport target={mapTarget} />
        <MapZoomTracker onMapZoomChange={onMapZoomChange} />
        <MyLocation position={userLocation} />

        {userLocation && (
          <Marker position={userLocation} icon={makeIcon("🔵", "#2563eb")}>
            <Popup>موقعك الحالي</Popup>
          </Marker>
        )}

        {reports.map((r) =>
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

        {sortedReports.map((r, index) => (
          <Fragment
            key={r.id || `${r.lat}-${r.lng}-${r.createdAt}-${index}`}
          >
            <Marker
              key={r.id || `${r.lat}-${r.lng}-${r.createdAt}`}
              position={[r.lat, r.lng]}
              icon={makeIcon(
                r.type?.includes("مسروقة")
                  ? "🚨"
                  : r.helperComing
                    ? "🟢"
                    : r.emoji,
                r.type?.includes("مسروقة")
                  ? "#dc2626"
                  : r.helperComing
                    ? "#16a34a"
                    : r.color
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

                  onReportSelect(r)
                },
              }}
            >
              <Popup>
                <div style={{ textAlign: "right", direction: "rtl" }}>
                  <b>
                    {r.emoji} {r.type}
                  </b>
                  <br />
                  📍 المنطقة: {formatLebaneseLocationConcise(r)}
                  <br />
                  🕒 وقت البلاغ:{" "}
                  {new Date(r.createdAt || Date.now()).toLocaleTimeString(
                    "ar-LB",
                    {
                      hour: "2-digit",
                      minute: "2-digit",
                    }
                  )}
                  <br />
                  ⌛ ينتهي خلال:{" "}
                  {Math.max(
                    0,
                    Math.ceil(
                      ((r.createdAt || Date.now()) +
                        (r.expiry || 0) * 1000 -
                        Date.now()) /
                        60000
                    )
                  )}{" "}
                  دقيقة
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
                      fontWeight: "bold",
                    }}
                  >
                    📍 إفتح موقع الحدث
                  </button>
                  {canReceiveHelp(r) && r.ownerId !== deviceId && (
                    <button
                      onClick={() => onReportSelect(r)}
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
                        width: "100%",
                      }}
                    >
                      {r.helperComing
                        ? "✅ المساعدة بالطريق"
                        : "🚑 أنا جاي أساعدك"}
                    </button>
                  )}
                  {r.helperComing && !r.type?.includes("مسروقة") && (
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          color: "#22c55e",
                          fontWeight: "bold",
                          marginBottom: 8,
                        }}
                      >
                        ✅ مساعد بالطريق
                      </div>
                      <button
                        onClick={() =>
                          window.open(
                            `https://www.google.com/maps?q=${r.lat},${r.lng}`,
                            "_blank"
                          )
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
                          marginBottom: 6,
                        }}
                      >
                        📍 فتح الموقع
                      </button>
                    </div>
                  )}
                  <p style={{ color: "#94a3b8", marginTop: 6 }}>
                    {timeAgo(r.createdAt || Date.now())}
                    <span
                      style={{
                        color: "#ffcc70",
                        fontSize: 12,
                        marginTop: 4,
                      }}
                    >
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
                    fillOpacity: r.priority === "high" ? 0.1 : 0.05,
                    weight: r.priority === "high" ? 3 : 1,
                  }}
                />
                <Circle
                  center={[r.lat, r.lng]}
                  radius={60}
                  pathOptions={{
                    color: r.color,
                    fillColor: r.color,
                    fillOpacity: r.priority === "high" ? 0.05 : 0.02,
                    weight: r.priority === "high" ? 2 : 1,
                  }}
                />
              </Fragment>
            )}
          </Fragment>
        ))}
      </MapContainer>
    </>
  )
}

export default memo(LeafletMapView)
