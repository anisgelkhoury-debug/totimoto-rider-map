import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { GoogleMap, MarkerF, useJsApiLoader } from "@react-google-maps/api"

const DEFAULT_CENTER = { lat: 33.8938, lng: 35.5018 }
const DEFAULT_ZOOM = 12

const mapContainerStyle: CSSProperties = {
  width: "100%",
  height: "100%",
}

const mapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  rotateControl: false,
  scaleControl: false,
  clickableIcons: false,
  keyboardShortcuts: false,
}

const fallbackStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "#0b1220",
  color: "#e2e8f0",
  textAlign: "center",
  padding: 24,
  direction: "rtl",
  fontFamily: "Arial, sans-serif",
  fontSize: 16,
  lineHeight: 1.6,
}

/** Minimal report shape needed for map markers (from App visibleReports). */
export type GoogleMapReport = {
  id?: string | number
  lat?: number
  lng?: number
  type?: string
  emoji?: string
  color?: string
  helperComing?: boolean
  ownerId?: string
  createdAt?: number
  reportFamily?: string
  reportCategory?: string
}

export type GoogleMapViewProps = {
  userLocation: [number, number] | null
  reports: GoogleMapReport[]
  selectedReportId?: string | number | null
  mapTarget: [number, number] | null
  mapZoom: number
  onReportSelect: (report: GoogleMapReport) => void
}

function MapFallback({ message }: { message: string }) {
  return (
    <div role="alert" style={fallbackStyle}>
      {message}
    </div>
  )
}

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

/** Mirrors Leaflet makeIcon color/emoji choices for report markers. */
function reportVisual(report: GoogleMapReport): { emoji: string; color: string } {
  const stolen = report.type?.includes("مسروقة")
  if (stolen) return { emoji: "🚨", color: "#dc2626" }
  if (report.helperComing) return { emoji: "🟢", color: "#16a34a" }
  return {
    emoji: report.emoji || "📍",
    color: report.color || "#2563eb",
  }
}

function markerIconUrl(emoji: string, color: string, size: number): string {
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}" fill="${color}" stroke="#ffffff" stroke-width="2"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-size="${Math.round(size * 0.45)}">${emoji}</text>
</svg>`.trim()
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function reportMarkerKey(report: GoogleMapReport, index: number): string {
  if (report.id != null && report.id !== "") return `report-${report.id}`
  return `report-${report.lat}-${report.lng}-${report.createdAt ?? "x"}-${index}`
}

function GoogleMapCanvas({
  apiKey,
  userLocation,
  reports,
  selectedReportId,
  mapTarget,
  mapZoom,
  onReportSelect,
}: GoogleMapViewProps & { apiKey: string }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "trn-google-maps-script",
    googleMapsApiKey: apiKey,
  })

  const [map, setMap] = useState<google.maps.Map | null>(null)
  const hasCenteredOnUser = useRef(false)
  const mapZoomRef = useRef(mapZoom)
  mapZoomRef.current = mapZoom

  const onLoad = useCallback((nextMap: google.maps.Map) => {
    setMap(nextMap)
  }, [])

  const onUnmount = useCallback(() => {
    setMap(null)
    hasCenteredOnUser.current = false
  }, [])

  // Recenter / fly-to: only when mapTarget changes (not on every render/zoom).
  useEffect(() => {
    if (!map || !mapTarget) return
    const lat = mapTarget[0]
    const lng = mapTarget[1]
    if (!isValidLatLng(lat, lng)) return
    map.panTo({ lat, lng })
    const zoom = mapZoomRef.current
    map.setZoom(typeof zoom === "number" && zoom > 0 ? zoom : 15)
  }, [map, mapTarget])

  // First GPS fix — match Leaflet MyLocation one-shot fly.
  useEffect(() => {
    if (!map || !userLocation || hasCenteredOnUser.current) return
    const [lat, lng] = userLocation
    if (!isValidLatLng(lat, lng)) return
    map.panTo({ lat, lng })
    map.setZoom(14)
    hasCenteredOnUser.current = true
  }, [map, userLocation])

  const validReports = useMemo(() => {
    return reports.filter((r) => isValidLatLng(r.lat, r.lng))
  }, [reports])

  const userIcon = useMemo(() => {
    if (!isLoaded || typeof google === "undefined") return undefined
    const size = 28
    return {
      url: markerIconUrl("🔵", "#2563eb", size),
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(size / 2, size / 2),
    }
  }, [isLoaded])

  const reportIcons = useMemo(() => {
    const cache = new Map<string, google.maps.Icon>()
    if (!isLoaded || typeof google === "undefined") return cache
    for (const report of validReports) {
      const { emoji, color } = reportVisual(report)
      const selected =
        selectedReportId != null &&
        report.id != null &&
        String(report.id) === String(selectedReportId)
      const size = selected ? 34 : 28
      const key = `${emoji}|${color}|${size}`
      if (!cache.has(key)) {
        cache.set(key, {
          url: markerIconUrl(emoji, color, size),
          scaledSize: new google.maps.Size(size, size),
          anchor: new google.maps.Point(size / 2, size / 2),
        })
      }
    }
    return cache
  }, [isLoaded, validReports, selectedReportId])

  if (loadError) {
    return (
      <MapFallback message="تعذّر تحميل خريطة Google. تحقق من الاتصال أو إعدادات المفتاح ثم أعد المحاولة." />
    )
  }

  if (!isLoaded) {
    return <MapFallback message="جارٍ تحميل الخريطة..." />
  }

  const userPos =
    userLocation && isValidLatLng(userLocation[0], userLocation[1])
      ? { lat: userLocation[0], lng: userLocation[1] }
      : null

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      options={mapOptions}
      onLoad={onLoad}
      onUnmount={onUnmount}
    >
      {userPos && (
        <MarkerF
          position={userPos}
          icon={userIcon}
          title="موقعك الحالي"
          zIndex={1000}
        />
      )}

      {validReports.map((report, index) => {
        const { emoji, color } = reportVisual(report)
        const selected =
          selectedReportId != null &&
          report.id != null &&
          String(report.id) === String(selectedReportId)
        const size = selected ? 34 : 28
        const icon = reportIcons.get(`${emoji}|${color}|${size}`)
        return (
          <MarkerF
            key={reportMarkerKey(report, index)}
            position={{ lat: report.lat as number, lng: report.lng as number }}
            icon={icon}
            title={report.type || "بلاغ"}
            zIndex={selected ? 900 : 100}
            onClick={() => onReportSelect(report)}
          />
        )
      })}
    </GoogleMap>
  )
}

/**
 * Google Maps view for TRN Phase 2 — user GPS + visible report markers.
 * Data/callbacks come from App; no Firebase access here.
 */
export default function GoogleMapView(props: GoogleMapViewProps) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim()

  if (!apiKey) {
    return (
      <MapFallback message="مفتاح Google Maps غير متوفر. أضف VITE_GOOGLE_MAPS_API_KEY محلياً لتفعيل الخريطة." />
    )
  }

  return <GoogleMapCanvas apiKey={apiKey} {...props} />
}
