/**
 * Installation ID, token hashing, and subscription registration helpers.
 * 058B: server-side disable/re-enable + preference updates (no location / no nearby send).
 */

import {
  collection,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore"
import { getToken, type Messaging } from "firebase/messaging"
import { db, requireAuthUid } from "../firebase"
import { subscriptionIdFromToken } from "./notificationCrypto"
import {
  defaultNotificationPreferences,
  mergePreferencesForReenable,
  normalizeNotificationPreferences,
  subscriptionDisableUpdateFields,
  type NotificationPreferences,
} from "./notificationPreferences"

export {
  mergePreferencesForReenable,
  subscriptionDisableUpdateFields,
} from "./notificationPreferences"
import {
  resetHeartbeatMemoryState,
  setCachedNearbyAlertsPref,
} from "./locationHeartbeatState"
import {
  evaluateNotificationSupport,
  getStoredSubscriptionId,
  hasVapidKeyConfigured,
  markPermissionDeniedLocal,
  readVapidKey,
  setLocalEnabledFlag,
  setServerRegisteredFlag,
  setStoredSubscriptionId,
  type NotificationSupportResult,
} from "./notificationSupport"
import {
  ALLOW_PRODUCTION_SUBSCRIPTION_WRITE,
  detectBrowserLabel,
  detectPlatform,
} from "./subscriptionMeta"
import { getOrCreateInstallationId } from "./installationId"

export {
  ALLOW_PRODUCTION_SUBSCRIPTION_WRITE,
  detectBrowserLabel,
  detectPlatform,
} from "./subscriptionMeta"

export { getOrCreateInstallationId } from "./installationId"

export type RegisterOutcome =
  | {
      ok: true
      mode: "firestore" | "local_pending_rules"
      subscriptionId: string | null
    }
  | {
      ok: false
      reason:
        | NotificationSupportResult["code"]
        | "permission_denied"
        | "permission_dismissed"
        | "empty_token"
        | "auth_failed"
        | "messaging_unavailable"
        | "service_worker_unavailable"
        | "get_token_failed"
        | "write_failed"
      messageAr: string
    }

export type DisableOutcome =
  | { ok: true }
  | { ok: false; reason: "auth_failed" | "no_subscription" | "write_failed"; messageAr: string }

export type PreferencesUpdateOutcome =
  | { ok: true; preferences: NotificationPreferences }
  | {
      ok: false
      reason: "auth_failed" | "no_subscription" | "write_failed"
      messageAr: string
    }

export async function waitForServiceWorkerRegistration(
  timeoutMs = 8000
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null
  }
  try {
    const ready = navigator.serviceWorker.ready
    const timed = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), timeoutMs)
    })
    const reg = await Promise.race([ready, timed])
    return reg
  } catch {
    return null
  }
}

function preferencesForFirestoreWrite(
  prefs: NotificationPreferences
): NotificationPreferences {
  // Always persist the full additive set (legacy + nearby). Rules accept legacy-only OR extended.
  return normalizeNotificationPreferences(prefs)
}

function buildSubscriptionPayload(input: {
  uid: string
  token: string
  installationId: string
  deviceId: string
  support: NotificationSupportResult
  preserveCreatedAt: boolean
  notificationPreferences: NotificationPreferences
  enabled?: boolean
}) {
  const nowFields = {
    updatedAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  }
  const base = {
    uid: input.uid,
    installationId: input.installationId,
    deviceId: input.deviceId,
    token: input.token,
    platform: detectPlatform(input.support),
    browser: detectBrowserLabel(),
    locale: "ar",
    enabled: input.enabled !== false,
    permissionState: "granted" as const,
    browserSupportState: input.support.code,
    notificationPreferences: preferencesForFirestoreWrite(input.notificationPreferences),
    appVersion: import.meta.env.VITE_APP_VERSION || "web",
    ...nowFields,
  }
  if (input.preserveCreatedAt) {
    return base
  }
  return { ...base, createdAt: serverTimestamp() }
}

async function resolveSubscriptionRef(options: {
  messaging: Messaging | null
  preferStoredId?: boolean
}): Promise<{ id: string; ref: ReturnType<typeof doc> } | null> {
  const stored = options.preferStoredId !== false ? getStoredSubscriptionId() : null
  if (stored) {
    return { id: stored, ref: doc(db, "notificationSubscriptions", stored) }
  }

  if (!options.messaging) return null
  const registration = await waitForServiceWorkerRegistration()
  if (!registration || !hasVapidKeyConfigured()) return null

  let token: string
  try {
    token = await getToken(options.messaging, {
      vapidKey: readVapidKey(),
      serviceWorkerRegistration: registration,
    })
  } catch {
    return null
  }
  if (!token?.trim()) return null
  const id = await subscriptionIdFromToken(token)
  if (!id) return null
  return { id, ref: doc(db, "notificationSubscriptions", id) }
}

/**
 * Request permission (must run from a user gesture), then getToken + register.
 * Re-enable preserves existing notificationPreferences when the doc already exists.
 */
export async function enableNotificationsFromUserGesture(options: {
  messaging: Messaging | null
  deviceId: string
  requestPermission?: () => Promise<NotificationPermission>
  /** Optional prefs to apply on first create (defaults otherwise). */
  initialPreferences?: Partial<NotificationPreferences>
}): Promise<RegisterOutcome> {
  const support = evaluateNotificationSupport()

  if (support.code === "unsupported_browser") {
    return {
      ok: false,
      reason: "unsupported_browser",
      messageAr: "الإشعارات غير مدعومة على هذا المتصفح.",
    }
  }
  if (support.code === "ios_requires_install") {
    return {
      ok: false,
      reason: "ios_requires_install",
      messageAr: "فعّل الإشعارات بعد إضافة توتيموتو إلى الشاشة الرئيسية.",
    }
  }
  if (support.code === "missing_vapid_key" || !hasVapidKeyConfigured()) {
    return {
      ok: false,
      reason: "missing_vapid_key",
      messageAr: "إعداد الإشعارات غير مكتمل حالياً. يمكنك المحاولة لاحقاً من الإعدادات.",
    }
  }
  if (support.permission === "denied" || support.code === "permission_denied") {
    markPermissionDeniedLocal()
    return {
      ok: false,
      reason: "permission_denied",
      messageAr:
        "تم رفض الإشعارات من إعدادات المتصفح أو الجهاز. يمكنك تفعيلها لاحقاً من هناك.",
    }
  }

  const requestPermission =
    options.requestPermission ||
    (() => Notification.requestPermission())

  let permission: NotificationPermission
  try {
    permission = await requestPermission()
  } catch {
    return {
      ok: false,
      reason: "permission_dismissed",
      messageAr: "لم يتم تفعيل الإشعارات. يمكنك المحاولة لاحقاً.",
    }
  }

  if (permission === "denied") {
    markPermissionDeniedLocal()
    return {
      ok: false,
      reason: "permission_denied",
      messageAr:
        "تم رفض الإشعارات من إعدادات المتصفح أو الجهاز. يمكنك تفعيلها لاحقاً من هناك.",
    }
  }
  if (permission !== "granted") {
    return {
      ok: false,
      reason: "permission_dismissed",
      messageAr: "لم يتم تفعيل الإشعارات. يمكنك المحاولة لاحقاً من الإعدادات.",
    }
  }

  if (!options.messaging) {
    return {
      ok: false,
      reason: "messaging_unavailable",
      messageAr: "خدمة المراسلة غير متاحة على هذا الجهاز.",
    }
  }

  const registration = await waitForServiceWorkerRegistration()
  if (!registration) {
    return {
      ok: false,
      reason: "service_worker_unavailable",
      messageAr: "تعذّر تجهيز خدمة الخلفية. أعد فتح التطبيق ثم حاول مرة أخرى.",
    }
  }

  let token: string
  try {
    token = await getToken(options.messaging, {
      vapidKey: readVapidKey(),
      serviceWorkerRegistration: registration,
    })
  } catch {
    return {
      ok: false,
      reason: "get_token_failed",
      messageAr: "تعذّر تفعيل الإشعارات الآن. حاول مرة أخرى لاحقاً.",
    }
  }

  if (!token || !token.trim()) {
    return {
      ok: false,
      reason: "empty_token",
      messageAr: "تعذّر تفعيل الإشعارات الآن. حاول مرة أخرى لاحقاً.",
    }
  }

  let uid: string
  try {
    uid = await requireAuthUid()
  } catch {
    return {
      ok: false,
      reason: "auth_failed",
      messageAr: "تعذّر التحقق من الجلسة. أعد فتح التطبيق ثم حاول مرة أخرى.",
    }
  }

  const installationId = getOrCreateInstallationId()
  const subscriptionId = await subscriptionIdFromToken(token)
  const supportAfter = evaluateNotificationSupport()

  if (!ALLOW_PRODUCTION_SUBSCRIPTION_WRITE) {
    setLocalEnabledFlag(true)
    setServerRegisteredFlag(false)
    if (subscriptionId) setStoredSubscriptionId(subscriptionId)
    return {
      ok: true,
      mode: "local_pending_rules",
      subscriptionId,
    }
  }

  try {
    const id = subscriptionId || doc(collection(db, "notificationSubscriptions")).id
    const ref = doc(db, "notificationSubscriptions", id)

    let preserveCreatedAt = false
    let prefs = mergePreferencesForReenable(null, options.initialPreferences)

    try {
      const existing = await getDoc(ref)
      if (existing.exists()) {
        preserveCreatedAt = true
        prefs = mergePreferencesForReenable(
          existing.data().notificationPreferences,
          undefined
        )
      }
    } catch {
      /* create path if read fails */
    }

    const payload = buildSubscriptionPayload({
      uid,
      token,
      installationId,
      deviceId: options.deviceId,
      support: supportAfter,
      preserveCreatedAt,
      notificationPreferences: prefs,
      enabled: true,
    })
    await setDoc(ref, payload, { merge: true })
    setLocalEnabledFlag(true)
    setServerRegisteredFlag(true)
    setStoredSubscriptionId(id)
    setCachedNearbyAlertsPref(prefs.nearbyAlerts === true)
    return { ok: true, mode: "firestore", subscriptionId: id }
  } catch {
    setLocalEnabledFlag(true)
    setServerRegisteredFlag(false)
    return {
      ok: false,
      reason: "write_failed",
      messageAr: "تم السماح بالإشعارات لكن تعذّر حفظ الإعداد. سنكمّل التفعيل قريباً.",
    }
  }
}

/** Location clear fields for disable / nearby-off (no lat/lng ever written). */
export function subscriptionLocationClearFields(): {
  locationGeohash: ReturnType<typeof deleteField>
  locationUpdatedAt: ReturnType<typeof deleteField>
} {
  return {
    locationGeohash: deleteField(),
    locationUpdatedAt: deleteField(),
  }
}

/**
 * Disable notifications: set enabled:false on the subscription doc (token retained).
 * Also clears local enabled intent. Does not delete the document.
 */
export async function disableNotificationsOnServer(options: {
  messaging: Messaging | null
}): Promise<DisableOutcome> {
  try {
    await requireAuthUid()
  } catch {
    return {
      ok: false,
      reason: "auth_failed",
      messageAr: "تعذّر التحقق من الجلسة. أعد فتح التطبيق ثم حاول مرة أخرى.",
    }
  }

  if (!ALLOW_PRODUCTION_SUBSCRIPTION_WRITE) {
    setLocalEnabledFlag(false)
    setCachedNearbyAlertsPref(false)
    resetHeartbeatMemoryState()
    return { ok: true }
  }

  const resolved = await resolveSubscriptionRef({ messaging: options.messaging })
  if (!resolved) {
    setLocalEnabledFlag(false)
    setServerRegisteredFlag(false)
    setCachedNearbyAlertsPref(false)
    resetHeartbeatMemoryState()
    return {
      ok: false,
      reason: "no_subscription",
      messageAr: "ما لقينا اشتراك إشعارات على هذا الجهاز.",
    }
  }

  try {
    await updateDoc(resolved.ref, {
      ...subscriptionDisableUpdateFields(),
      ...subscriptionLocationClearFields(),
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    })
    setLocalEnabledFlag(false)
    setServerRegisteredFlag(true)
    setStoredSubscriptionId(resolved.id)
    setCachedNearbyAlertsPref(false)
    resetHeartbeatMemoryState()
    return { ok: true }
  } catch {
    // Fallback: merge write if update fails (doc missing fields edge cases).
    try {
      await setDoc(
        resolved.ref,
        {
          ...subscriptionDisableUpdateFields(),
          updatedAt: serverTimestamp(),
          lastSeenAt: serverTimestamp(),
        },
        { merge: true }
      )
      // Best-effort clear after merge fallback (deleteField needs updateDoc).
      try {
        await updateDoc(resolved.ref, {
          ...subscriptionLocationClearFields(),
        })
      } catch {
        /* ignore */
      }
      setLocalEnabledFlag(false)
      setServerRegisteredFlag(true)
      setStoredSubscriptionId(resolved.id)
      setCachedNearbyAlertsPref(false)
      resetHeartbeatMemoryState()
      return { ok: true }
    } catch {
      return {
        ok: false,
        reason: "write_failed",
        messageAr: "تعذّر إيقاف الإشعارات على الخادم. حاول مرة أخرى.",
      }
    }
  }
}

/** @deprecated Prefer disableNotificationsOnServer — local-only leaves server enabled. */
export function disableNotificationsLocally(): void {
  setLocalEnabledFlag(false)
  setServerRegisteredFlag(false)
}

/** Load normalized preferences from the current subscription (or defaults). */
export async function loadNotificationPreferences(options: {
  messaging: Messaging | null
}): Promise<NotificationPreferences> {
  const defaults = defaultNotificationPreferences()
  if (!ALLOW_PRODUCTION_SUBSCRIPTION_WRITE) return defaults

  try {
    await requireAuthUid()
  } catch {
    return defaults
  }

  const resolved = await resolveSubscriptionRef({ messaging: options.messaging })
  if (!resolved) return defaults

  try {
    const snap = await getDoc(resolved.ref)
    if (!snap.exists()) return defaults
    const prefs = normalizeNotificationPreferences(
      snap.data().notificationPreferences
    )
    setCachedNearbyAlertsPref(prefs.nearbyAlerts === true)
    return prefs
  } catch {
    return defaults
  }
}

/** Persist preference object; preserves token / enabled / ownership fields. */
export async function updateNotificationPreferencesOnServer(options: {
  messaging: Messaging | null
  preferences: NotificationPreferences
}): Promise<PreferencesUpdateOutcome> {
  const prefs = preferencesForFirestoreWrite(options.preferences)

  try {
    await requireAuthUid()
  } catch {
    return {
      ok: false,
      reason: "auth_failed",
      messageAr: "تعذّر التحقق من الجلسة. أعد فتح التطبيق ثم حاول مرة أخرى.",
    }
  }

  if (!ALLOW_PRODUCTION_SUBSCRIPTION_WRITE) {
    setCachedNearbyAlertsPref(prefs.nearbyAlerts === true)
    if (!prefs.nearbyAlerts) resetHeartbeatMemoryState()
    return { ok: true, preferences: prefs }
  }

  const resolved = await resolveSubscriptionRef({ messaging: options.messaging })
  if (!resolved) {
    return {
      ok: false,
      reason: "no_subscription",
      messageAr: "فعّل الإشعارات أولاً قبل حفظ التفضيلات.",
    }
  }

  try {
    const patch: Record<string, unknown> = {
      notificationPreferences: prefs,
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    }
    if (prefs.nearbyAlerts !== true) {
      Object.assign(patch, subscriptionLocationClearFields())
      resetHeartbeatMemoryState()
    }
    await updateDoc(resolved.ref, patch)
    setStoredSubscriptionId(resolved.id)
    setCachedNearbyAlertsPref(prefs.nearbyAlerts === true)
    return { ok: true, preferences: prefs }
  } catch {
    return {
      ok: false,
      reason: "write_failed",
      messageAr: "تعذّر حفظ التفضيلات. حاول مرة أخرى.",
    }
  }
}
