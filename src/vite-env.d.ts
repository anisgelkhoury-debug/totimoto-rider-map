/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Emergency fallback only. When exactly "true", use Leaflet instead of Google Maps. */
  readonly VITE_USE_LEAFLET?: string
  /** Firebase Web Push VAPID key (public). Never commit real secrets beyond this public key. */
  readonly VITE_FIREBASE_VAPID_KEY?: string
  /** Optional build label for subscription metadata. */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
