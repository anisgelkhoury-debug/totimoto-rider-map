/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Firebase Web Push VAPID key (public). Never commit real secrets beyond this public key. */
  readonly VITE_FIREBASE_VAPID_KEY?: string
  /** Optional build label for subscription metadata. */
  readonly VITE_APP_VERSION?: string
  /** Optional local Functions emulator URL for getRiderWeather. */
  readonly VITE_WEATHER_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
