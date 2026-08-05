import { type CSSProperties } from "react"
import { GoogleMap, useJsApiLoader } from "@react-google-maps/api"

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

function MapFallback({ message }: { message: string }) {
  return (
    <div role="alert" style={fallbackStyle}>
      {message}
    </div>
  )
}

function GoogleMapCanvas({ apiKey }: { apiKey: string }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "trn-google-maps-script",
    googleMapsApiKey: apiKey,
  })

  if (loadError) {
    return (
      <MapFallback message="تعذّر تحميل خريطة Google. تحقق من الاتصال أو إعدادات المفتاح ثم أعد المحاولة." />
    )
  }

  if (!isLoaded) {
    return <MapFallback message="جارٍ تحميل الخريطة..." />
  }

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      options={mapOptions}
    />
  )
}

/**
 * Isolated Google Maps foundation for TRN Phase 2.
 * No report markers, helpers, Firebase listeners, or Leaflet coupling.
 */
export default function GoogleMapView() {
  const apiKey = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "").trim()

  if (!apiKey) {
    return (
      <MapFallback message="مفتاح Google Maps غير متوفر. أضف VITE_GOOGLE_MAPS_API_KEY محلياً لتفعيل الخريطة." />
    )
  }

  return <GoogleMapCanvas apiKey={apiKey} />
}
