/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_MAPS_API_KEY?: string
  readonly VITE_USE_GOOGLE_MAPS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
