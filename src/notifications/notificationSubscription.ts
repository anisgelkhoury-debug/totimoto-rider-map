/**
 * Installation ID, token hashing, and subscription registration helpers.
 * Production Firestore writes stay disabled until Task 034C rules ship.
 */

import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore"
import { getToken, type Messaging } from "firebase/messaging"
import { db, requireAuthUid } from "../firebase"
import { subscriptionIdFromToken } from "./notificationCrypto"
import {
  evaluateNotificationSupport,
  hasVapidKeyConfigured,
  markPermissionDeniedLocal,
  readVapidKey,
  setLocalEnabledFlag,
  setServerRegisteredFlag,
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

function buildSubscriptionPayload(input: {
  uid: string
  token: string
  installationId: string
  deviceId: string
  support: NotificationSupportResult
  preserveCreatedAt: boolean
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
    enabled: true,
    permissionState: "granted" as const,
    browserSupportState: input.support.code,
    notificationPreferences: {
      helperLifecycle: true,
      ownerLifecycle: true,
      stolenNearby: false,
      criticalRoads: false,
      sharedRides: false,
      communityRides: false,
      announcements: false,
      marketing: false,
    },
    appVersion: import.meta.env.VITE_APP_VERSION || "web",
    ...nowFields,
  }
  if (input.preserveCreatedAt) {
    return base
  }
  return { ...base, createdAt: serverTimestamp() }
}

/**
 * Request permission (must run from a user gesture), then getToken + register.
 * Does not send notifications. Does not write production Firestore until allowed.
 */
export async function enableNotificationsFromUserGesture(options: {
  messaging: Messaging | null
  deviceId: string
  requestPermission?: () => Promise<NotificationPermission>
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
    // Token acquired; do not persist token outside Firestore. Re-getToken in 034C.
    setLocalEnabledFlag(true)
    setServerRegisteredFlag(false)
    return {
      ok: true,
      mode: "local_pending_rules",
      subscriptionId,
    }
  }

  try {
    const id = subscriptionId || doc(collection(db, "notificationSubscriptions")).id
    const ref = doc(db, "notificationSubscriptions", id)
    const payload = buildSubscriptionPayload({
      uid,
      token,
      installationId,
      deviceId: options.deviceId,
      support: supportAfter,
      preserveCreatedAt: false,
    })
    await setDoc(ref, payload, { merge: true })
    setLocalEnabledFlag(true)
    setServerRegisteredFlag(true)
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

/** Local-only disable intent until server delete is available in 034C/I. */
export function disableNotificationsLocally(): void {
  setLocalEnabledFlag(false)
  setServerRegisteredFlag(false)
}
