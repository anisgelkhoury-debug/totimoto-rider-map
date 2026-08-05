import { NOTIF_STORAGE } from "./notificationSupport"

function fallbackUuid(): string {
  return `trn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Stable per-browser installation id (localStorage only — no Firebase). */
export function getOrCreateInstallationId(): string {
  try {
    const existing = localStorage.getItem(NOTIF_STORAGE.installationId)
    if (existing && existing.trim()) return existing.trim()
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : fallbackUuid()
    localStorage.setItem(NOTIF_STORAGE.installationId, id)
    return id
  } catch {
    return fallbackUuid()
  }
}
