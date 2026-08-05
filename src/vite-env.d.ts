/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Emergency fallback only. When exactly "true", use Leaflet instead of Google Maps. */
  readonly VITE_USE_LEAFLET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
