import { useCallback, useEffect, useMemo, useRef, useState, Fragment, memo, type CSSProperties } from "react"
import { CircleF, GoogleMap, MarkerF, TrafficLayer, useJsApiLoader } from "@react-google-maps/api"
import type { MapTypeMode } from "./mapChrome/mapTypes"

export type { MapTypeMode }

const DEFAULT_CENTER = { lat: 33.8938, lng: 35.5018 }
const DEFAULT_ZOOM = 12
const CIRCLE_MIN_ZOOM = 14

const mapContainerStyle: CSSProperties = {
  width: "100%",
  height: "100%",
}

/** Conservative mobile options: keep gestures, hide cluttering controls. */
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
  gestureHandling: "greedy" as const,
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
  priority?: string
  helperComing?: boolean
  helperLat?: number | null
  helperLng?: number | null
  helperLocationUpdatedAt?: number | null
  ownerId?: string
  createdAt?: number
  resolved?: boolean
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
  /** Controlled map type — layers UI lives in App chrome sheets. */
  mapTypeId?: MapTypeMode
  trafficOn?: boolean
  /**
   * Fired on map idle with current bounds (debounced upstream).
   * Used by bounded geo queries — not every pan frame.
   */
  onViewportIdle?: (bounds: {
    north: number
    south: number
    east: number
    west: number
  }) => void
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

/** Marker color/emoji choices for report markers. */
function reportVisual(report: GoogleMapReport): { emoji: string; color: string } {
  const stolen = report.type?.includes("مسروقة")
  if (stolen) return { emoji: "🚨", color: "#dc2626" }
  if (report.helperComing) return { emoji: "🟢", color: "#16a34a" }
  return {
    emoji: report.emoji || "📍",
    color: report.color || "#2563eb",
  }
}

function markerIconUrl(
  emoji: string,
  color: string,
  size: number,
  selected = false
): string {
  const stroke = selected ? "#fbbf24" : "#ffffff"
  const strokeWidth = selected ? 3 : 2
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - strokeWidth}" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
  <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-size="${Math.round(size * 0.42)}">${emoji}</text>
</svg>`.trim()
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function reportMarkerKey(report: GoogleMapReport, index: number): string {
  if (report.id != null && report.id !== "") return `report-${report.id}`
  return `report-${report.lat}-${report.lng}-${report.createdAt ?? "x"}-${index}`
}

function helperMarkerKey(report: GoogleMapReport, index: number): string {
  if (report.id != null && report.id !== "") return `helper-${report.id}`
  return `helper-${report.helperLat}-${report.helperLng}-${index}`
}

function buildIcon(
  emoji: string,
  color: string,
  size: number,
  selected = false
): google.maps.Icon {
  return {
    url: markerIconUrl(emoji, color, size, selected),
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  }
}

function GoogleMapCanvas({
  apiKey,
  userLocation,
  reports,
  selectedReportId,
  mapTarget,
  mapZoom,
  onReportSelect,
  mapTypeId = "roadmap",
  trafficOn = false,
  onViewportIdle,
}: GoogleMapViewProps & { apiKey: string }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "trn-google-maps-script",
    googleMapsApiKey: apiKey,
  })

  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM)
  const hasCenteredOnUser = useRef(false)
  const mapZoomRef = useRef(mapZoom)
  useEffect(() => {
    mapZoomRef.current = mapZoom
  }, [mapZoom])

  const onLoad = useCallback(
    (nextMap: google.maps.Map) => {
      setMap(nextMap)
      setCurrentZoom(nextMap.getZoom() ?? DEFAULT_ZOOM)
      nextMap.setMapTypeId(mapTypeId)
    },
    [mapTypeId]
  )

  const onUnmount = useCallback(() => {
    setMap(null)
    hasCenteredOnUser.current = false
  }, [])

  // Apply map type without remounting the map instance.
  useEffect(() => {
    if (!map) return
    map.setMapTypeId(mapTypeId)
  }, [map, mapTypeId])

  // Track zoom for high-priority circle visibility (show when zoom >= 14).
  // Only commit React state when the integer zoom changes to avoid pinch thrash.
  useEffect(() => {
    if (!map) return
    let raf = 0
    const syncZoom = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const next = Math.round(map.getZoom() ?? DEFAULT_ZOOM)
        setCurrentZoom((prev) => (prev === next ? prev : next))
      })
    }
    syncZoom()
    const listener = map.addListener("zoom_changed", syncZoom)
    return () => {
      cancelAnimationFrame(raf)
      listener.remove()
    }
  }, [map])

  // Smooth camera focus when the selected report changes.
  useEffect(() => {
    if (!map || selectedReportId == null) return
    const selected = reports.find(
      (r) => r.id != null && String(r.id) === String(selectedReportId)
    )
    if (!selected || !isValidLatLng(selected.lat, selected.lng)) return
    map.panTo({ lat: selected.lat, lng: selected.lng })
  }, [map, selectedReportId, reports])

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

  // First GPS fix — one-shot pan/zoom to user location.
  useEffect(() => {
    if (!map || !userLocation || hasCenteredOnUser.current) return
    const [lat, lng] = userLocation
    if (!isValidLatLng(lat, lng)) return
    map.panTo({ lat, lng })
    map.setZoom(14)
    hasCenteredOnUser.current = true
  }, [map, userLocation])

  // Idle viewport bounds for bounded geo subscriptions (no per-frame emits).
  useEffect(() => {
    if (!map || !onViewportIdle) return
    const emit = () => {
      const b = map.getBounds()
      if (!b) return
      const ne = b.getNorthEast()
      const sw = b.getSouthWest()
      onViewportIdle({
        north: ne.lat(),
        east: ne.lng(),
        south: sw.lat(),
        west: sw.lng(),
      })
    }
    emit()
    const listener = map.addListener("idle", emit)
    return () => {
      listener.remove()
    }
  }, [map, onViewportIdle])

  const validReports = useMemo(() => {
    return reports.filter((r) => !r.resolved && isValidLatLng(r.lat, r.lng))
  }, [reports])

  const helperReports = useMemo(() => {
    return reports.filter(
      (r) =>
        !r.resolved &&
        r.helperComing === true &&
        isValidLatLng(r.helperLat, r.helperLng)
    )
  }, [reports])

  const warningReports = useMemo(() => {
    if (currentZoom < CIRCLE_MIN_ZOOM) return []
    return validReports.filter((r) => r.priority === "high" || r.priority === "critical")
  }, [validReports, currentZoom])

  const approximateAreaReports = useMemo(() => {
    if (currentZoom < CIRCLE_MIN_ZOOM) return []
    return validReports.filter(
      (r) =>
        r.reportFamily === "incident" &&
        (r.reportCategory === "gunfire" ||
          r.reportCategory === "explosionStrike")
    )
  }, [validReports, currentZoom])

  const userIcon = useMemo(() => {
    if (!isLoaded || typeof google === "undefined") return undefined
    return buildIcon("🔵", "#2563eb", 28)
  }, [isLoaded])

  const helperIcon = useMemo(() => {
    if (!isLoaded || typeof google === "undefined") return undefined
    return buildIcon("🏍️", "#2563eb", 30)
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
      const size = selected ? 36 : 28
      const key = `${emoji}|${color}|${size}|${selected ? "s" : "n"}`
      if (!cache.has(key)) {
        cache.set(key, buildIcon(emoji, color, size, selected))
      }
    }
    return cache
  }, [isLoaded, validReports, selectedReportId])

  const warningCircleModels = useMemo(() => {
    return warningReports.map((report, index) => {
      const color = report.color || "#dc2626"
      const center = { lat: report.lat as number, lng: report.lng as number }
      return {
        keyBase: reportMarkerKey(report, index),
        center,
        innerOptions: {
          strokeColor: color,
          strokeOpacity: 0.85,
          strokeWeight: 3,
          fillColor: color,
          fillOpacity: 0.1,
          clickable: false,
          zIndex: 1,
        },
        outerOptions: {
          strokeColor: color,
          strokeOpacity: 0.7,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.05,
          clickable: false,
          zIndex: 1,
        },
      }
    })
  }, [warningReports])

  const approximateCircleModels = useMemo(() => {
    return approximateAreaReports.map((report, index) => {
      const color = report.color || "#7f1d1d"
      const center = { lat: report.lat as number, lng: report.lng as number }
      return {
        keyBase: `approx-${reportMarkerKey(report, index)}`,
        center,
        options: {
          strokeColor: color,
          strokeOpacity: 0.45,
          strokeWeight: 2,
          fillColor: color,
          fillOpacity: 0.12,
          clickable: false,
          zIndex: 2,
        },
      }
    })
  }, [approximateAreaReports])

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
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        options={mapOptions}
        onLoad={onLoad}
        onUnmount={onUnmount}
      >
        {trafficOn ? <TrafficLayer /> : null}

        {warningCircleModels.map((model) => (
          <Fragment key={`circles-${model.keyBase}`}>
            <CircleF
              center={model.center}
              radius={40}
              options={model.innerOptions}
            />
            <CircleF
              center={model.center}
              radius={60}
              options={model.outerOptions}
            />
          </Fragment>
        ))}

        {approximateCircleModels.map((model) => (
          <CircleF
            key={model.keyBase}
            center={model.center}
            radius={180}
            options={model.options}
          />
        ))}

        {validReports.map((report, index) => {
          const { emoji, color } = reportVisual(report)
          const selected =
            selectedReportId != null &&
            report.id != null &&
            String(report.id) === String(selectedReportId)
          const size = selected ? 36 : 28
          const icon = reportIcons.get(
            `${emoji}|${color}|${size}|${selected ? "s" : "n"}`
          )
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

        {helperReports.map((report, index) => (
          <MarkerF
            key={helperMarkerKey(report, index)}
            position={{
              lat: report.helperLat as number,
              lng: report.helperLng as number,
            }}
            icon={helperIcon}
            title="مساعد بالطريق"
            zIndex={800}
            clickable={false}
          />
        ))}

        {userPos && (
          <MarkerF
            position={userPos}
            icon={userIcon}
            title="موقعك الحالي"
            zIndex={1000}
          />
        )}
      </GoogleMap>
    </div>
  )
}

/**
 * Google Maps view for TRN — markers, helper live updates,
 * warning circles; map type / traffic controlled by App chrome.
 * Memoized so App UI state (sheets/modals) does not re-reconcile markers.
 */
function GoogleMapView(props: GoogleMapViewProps) {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim()

  if (!apiKey) {
    return (
      <MapFallback message="مفتاح Google Maps غير متوفر. أضف VITE_GOOGLE_MAPS_API_KEY محلياً لتفعيل الخريطة." />
    )
  }

  return <GoogleMapCanvas apiKey={apiKey} {...props} />
}

export default memo(GoogleMapView)
