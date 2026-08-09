/**
 * TRN notification platform / permission support detection.
 * Capability-first; UA only for iOS install guidance.
 */

export type NotificationPermissionState = "default" | "granted" | "denied"

export type NotificationSupportCode =
  | "supported"
  | "unsupported_browser"
  | "ios_requires_install"
  | "permission_denied"
  | "missing_vapid_key"
  | "service_worker_unavailable"

export type NotificationSupportResult = {
  code: NotificationSupportCode
  permission: NotificationPermissionState
  isIos: boolean
  isStandalone: boolean
  hasNotificationApi: boolean
  hasServiceWorker: boolean
  hasPushManager: boolean
  hasVapidKey: boolean
}

const COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

export const NOTIF_STORAGE = {
  installationId: "trnInstallationId",
  dismissUntil: "trnNotifDismissUntil",
  deniedAt: "trnNotifDeniedAt",
  /** Local intent after successful getToken (server write may still be pending 034C). */
  localEnabled: "trnNotifLocalEnabled",
  serverRegistered: "trnNotifServerRegistered",
  promptSessionAsked: "trnNotifPromptSessionAsked",
  /** Deterministic subscription doc id (sha256 token prefix) after successful register. */
  subscriptionId: "trnNotifSubscriptionId",
  /** Cached nearbyAlerts preference for heartbeat gate (no extra Firestore reads). */
  nearbyAlertsPref: "trnNotifNearbyAlerts",
} as const

export function setStoredSubscriptionId(id: string | null): void {
  if (!id) {
    localStorage.removeItem(NOTIF_STORAGE.subscriptionId)
    return
  }
  localStorage.setItem(NOTIF_STORAGE.subscriptionId, id)
}

export function getStoredSubscriptionId(): string | null {
  const v = localStorage.getItem(NOTIF_STORAGE.subscriptionId)
  return v && v.trim() ? v.trim() : null
}

export function readVapidKey(): string {
  const key = import.meta.env.VITE_FIREBASE_VAPID_KEY
  return typeof key === "string" ? key.trim() : ""
}

export function hasVapidKeyConfigured(): boolean {
  return readVapidKey().length > 0
}

export function detectIsIos(ua = typeof navigator !== "undefined" ? navigator.userAgent : ""): boolean {
  return /iPhone|iPad|iPod/i.test(ua)
}

export function detectIsStandalone(
  win: Window & { navigator: Navigator & { standalone?: boolean } } = window as Window & {
    navigator: Navigator & { standalone?: boolean }
  }
): boolean {
  try {
    if (win.matchMedia?.("(display-mode: standalone)")?.matches) return true
    if (win.navigator?.standalone === true) return true
  } catch {
    /* ignore */
  }
  return false
}

export function readNotificationPermission(): NotificationPermissionState {
  if (typeof Notification === "undefined") return "denied"
  const p = Notification.permission
  if (p === "granted" || p === "denied" || p === "default") return p
  return "default"
}

/**
 * Pure-ish support snapshot. Pass overrides in unit tests.
 */
export function evaluateNotificationSupport(options?: {
  hasNotificationApi?: boolean
  hasServiceWorker?: boolean
  hasPushManager?: boolean
  isIos?: boolean
  isStandalone?: boolean
  permission?: NotificationPermissionState
  hasVapidKey?: boolean
}): NotificationSupportResult {
  const hasNotificationApi =
    options?.hasNotificationApi ?? typeof Notification !== "undefined"
  const hasServiceWorker =
    options?.hasServiceWorker ??
    (typeof navigator !== "undefined" && "serviceWorker" in navigator)
  const hasPushManager =
    options?.hasPushManager ??
    (typeof window !== "undefined" && "PushManager" in window)
  const isIos = options?.isIos ?? detectIsIos()
  const isStandalone = options?.isStandalone ?? detectIsStandalone()
  const permission = options?.permission ?? readNotificationPermission()
  const vapidOk = options?.hasVapidKey ?? hasVapidKeyConfigured()

  const base = {
    permission,
    isIos,
    isStandalone,
    hasNotificationApi,
    hasServiceWorker,
    hasPushManager,
    hasVapidKey: vapidOk,
  }

  if (!hasNotificationApi || !hasServiceWorker || !hasPushManager) {
    return { ...base, code: "unsupported_browser" }
  }

  if (isIos && !isStandalone) {
    return { ...base, code: "ios_requires_install" }
  }

  if (!vapidOk) {
    return { ...base, code: "missing_vapid_key" }
  }

  if (permission === "denied") {
    return { ...base, code: "permission_denied" }
  }

  return { ...base, code: "supported" }
}

export function getSoftDismissUntil(): number {
  const raw = localStorage.getItem(NOTIF_STORAGE.dismissUntil)
  const n = raw ? Number(raw) : 0
  return Number.isFinite(n) ? n : 0
}

export function setSoftDismiss(now = Date.now()): void {
  localStorage.setItem(NOTIF_STORAGE.dismissUntil, String(now + COOLDOWN_MS))
}

export function isInSoftDismissCooldown(now = Date.now()): boolean {
  return now < getSoftDismissUntil()
}

export function markPermissionDeniedLocal(now = Date.now()): void {
  localStorage.setItem(NOTIF_STORAGE.deniedAt, String(now))
}

export function wasMarkedDeniedLocally(): boolean {
  return Boolean(localStorage.getItem(NOTIF_STORAGE.deniedAt))
}

export function setLocalEnabledFlag(enabled: boolean): void {
  localStorage.setItem(NOTIF_STORAGE.localEnabled, enabled ? "1" : "0")
}

export function isLocalEnabledFlag(): boolean {
  return localStorage.getItem(NOTIF_STORAGE.localEnabled) === "1"
}

export function setServerRegisteredFlag(registered: boolean): void {
  localStorage.setItem(NOTIF_STORAGE.serverRegistered, registered ? "1" : "0")
}

export function isServerRegisteredFlag(): boolean {
  return localStorage.getItem(NOTIF_STORAGE.serverRegistered) === "1"
}

export function markPromptAskedThisSession(): void {
  try {
    sessionStorage.setItem(NOTIF_STORAGE.promptSessionAsked, "1")
  } catch {
    /* ignore */
  }
}

export function wasPromptAskedThisSession(): boolean {
  try {
    return sessionStorage.getItem(NOTIF_STORAGE.promptSessionAsked) === "1"
  } catch {
    return false
  }
}

/**
 * Whether to auto-offer the explanation modal after a meaningful create.
 */
export function shouldOfferNotificationPromptAfterCreate(options?: {
  reportFamily?: string
  now?: number
  support?: NotificationSupportResult
}): boolean {
  const family = options?.reportFamily
  if (family !== "assistance" && family !== "sharedRide") return false
  if (wasPromptAskedThisSession()) return false
  if (isInSoftDismissCooldown(options?.now)) return false
  if (isLocalEnabledFlag() && isServerRegisteredFlag()) return false

  const support = options?.support ?? evaluateNotificationSupport()
  if (support.code === "unsupported_browser") return false
  if (support.code === "permission_denied") return false
  if (support.permission === "denied") return false
  if (isLocalEnabledFlag() && support.permission === "granted") return false

  return true
}

export type SettingsNotificationState =
  | "unsupported"
  | "needs_install"
  | "inactive"
  | "active"
  | "denied"
  | "needs_setup"

export function resolveSettingsNotificationState(
  support = evaluateNotificationSupport()
): SettingsNotificationState {
  if (support.code === "unsupported_browser") return "unsupported"
  if (support.code === "ios_requires_install") return "needs_install"
  if (support.code === "permission_denied" || support.permission === "denied") {
    return "denied"
  }
  if (support.code === "missing_vapid_key" || support.code === "service_worker_unavailable") {
    return "needs_setup"
  }
  if (isLocalEnabledFlag() && isServerRegisteredFlag() && support.permission === "granted") {
    return "active"
  }
  if (isLocalEnabledFlag() && support.permission === "granted" && !isServerRegisteredFlag()) {
    // Token acquired locally; production write blocked until 034C.
    return "needs_setup"
  }
  return "inactive"
}

export function settingsStateLabelAr(state: SettingsNotificationState): string {
  switch (state) {
    case "unsupported":
      return "غير مدعومة"
    case "needs_install":
      return "تحتاج تثبيت التطبيق"
    case "inactive":
      return "غير مفعّلة"
    case "active":
      return "مفعّلة"
    case "denied":
      return "مرفوضة من المتصفح"
    case "needs_setup":
      return "تحتاج إعداد"
    default:
      return "غير مفعّلة"
  }
}

export const NOTIFICATION_COOLDOWN_MS = COOLDOWN_MS
