/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  /** Firebase Web Push VAPID key (public). Never commit real secrets beyond this public key. */
  readonly VITE_FIREBASE_VAPID_KEY?: string
  /** Optional build label for subscription metadata. */
  readonly VITE_APP_VERSION?: string
  /** Optional local Functions emulator URL for getRiderWeather. */
  readonly VITE_WEATHER_PROXY_URL?: string
  /**
   * Bounded geo report queries (057D). Default OFF when absent.
   * Explicit "true" only — production must keep full listener.
   */
  readonly VITE_USE_BOUNDED_REPORT_QUERIES?: string
  /** DEV-only full vs bounded ID comparison. Default OFF. */
  readonly VITE_COMPARE_BOUNDED_REPORT_QUERIES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
