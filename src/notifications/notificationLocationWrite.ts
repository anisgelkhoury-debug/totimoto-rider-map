/**
 * TRN 058C — foreground coarse location heartbeat writes (no GPS API, no FCM send).
 */

import { deleteField, doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { getToken, type Messaging } from "firebase/messaging"
import { db, requireAuthUid } from "../firebase"
import { subscriptionIdFromToken } from "./notificationCrypto"
import {
  canAttemptLocationHeartbeat,
  encodeNotificationLocationGeohash,
  shouldWriteLocationHeartbeat,
  type HeartbeatGateInput,
} from "./locationHeartbeat"
import {
  getCachedNearbyAlertsPref,
  getHeartbeatMemoryState,
  markHeartbeatWriteCommitted,
  resetHeartbeatMemoryState,
  setCachedNearbyAlertsPref,
} from "./locationHeartbeatState"
import {
  getStoredSubscriptionId,
  hasVapidKeyConfigured,
  isLocalEnabledFlag,
  isServerRegisteredFlag,
  readVapidKey,
  setStoredSubscriptionId,
} from "./notificationSupport"
import { ALLOW_PRODUCTION_SUBSCRIPTION_WRITE } from "./subscriptionMeta"

let nearbyPrefHydrate: Promise<boolean> | null = null

async function resolveNearbyAlertsPref(
  messaging: Messaging | null,
  override?: boolean
): Promise<boolean> {
  if (typeof override === "boolean") return override
  const cached = getCachedNearbyAlertsPref()
  if (cached !== null) return cached
  if (!ALLOW_PRODUCTION_SUBSCRIPTION_WRITE) return false
  if (!isLocalEnabledFlag() || !isServerRegisteredFlag()) return false
  if (!nearbyPrefHydrate) {
    nearbyPrefHydrate = import("./notificationSubscription")
      .then(({ loadNotificationPreferences }) =>
        loadNotificationPreferences({ messaging })
      )
      .then((prefs) => {
        setCachedNearbyAlertsPref(prefs.nearbyAlerts === true)
        return prefs.nearbyAlerts === true
      })
      .catch(() => false)
      .finally(() => {
        nearbyPrefHydrate = null
      })
  }
  return nearbyPrefHydrate
}

export type HeartbeatWriteResult =
  | { ok: true; wrote: boolean; reason?: string; geohash?: string }
  | { ok: false; wrote: false; reason: string }

let inflight: Promise<HeartbeatWriteResult> | null = null

async function waitForSw(
  timeoutMs = 8000
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null
  }
  try {
    const timed = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), timeoutMs)
    })
    return await Promise.race([navigator.serviceWorker.ready, timed])
  } catch {
    return null
  }
}

async function resolveSubscriptionId(
  messaging: Messaging | null
): Promise<string | null> {
  const stored = getStoredSubscriptionId()
  if (stored) return stored
  if (!messaging || !hasVapidKeyConfigured()) return null
  const registration = await waitForSw()
  if (!registration) return null
  try {
    const token = await getToken(messaging, {
      vapidKey: readVapidKey(),
      serviceWorkerRegistration: registration,
    })
    if (!token?.trim()) return null
    const id = await subscriptionIdFromToken(token)
    if (id) setStoredSubscriptionId(id)
    return id
  } catch {
    return null
  }
}

/**
 * Clear coarse location fields (privacy). Does not touch preferences/token.
 */
export async function clearNotificationLocationFields(options: {
  messaging: Messaging | null
}): Promise<{ ok: boolean; reason?: string }> {
  if (!ALLOW_PRODUCTION_SUBSCRIPTION_WRITE) {
    resetHeartbeatMemoryState()
    return { ok: true }
  }
  try {
    await requireAuthUid()
  } catch {
    return { ok: false, reason: "auth_failed" }
  }
  const id = await resolveSubscriptionId(options.messaging)
  if (!id) return { ok: false, reason: "no_subscription" }
  try {
    await updateDoc(doc(db, "notificationSubscriptions", id), {
      locationGeohash: deleteField(),
      locationUpdatedAt: deleteField(),
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    })
    resetHeartbeatMemoryState()
    return { ok: true }
  } catch {
    return { ok: false, reason: "write_failed" }
  }
}

export type MaybeHeartbeatInput = {
  messaging: Messaging | null
  lat: unknown
  lng: unknown
  /** Override visibility; default document.visibilityState === "visible" */
  documentVisible?: boolean
  /** Override nearbyAlerts; default cached local pref */
  nearbyAlerts?: boolean
  /** Override subscription enabled; default local+server flags */
  subscriptionEnabled?: boolean
  nowMs?: number
}

/**
 * Evaluate gates + throttle, then optionally overwrite locationGeohash/locationUpdatedAt.
 * Concurrent callers share one inflight promise (StrictMode-safe).
 */
export function maybeUpdateNotificationLocationHeartbeat(
  input: MaybeHeartbeatInput
): Promise<HeartbeatWriteResult> {
  if (inflight) return inflight
  inflight = runHeartbeat(input).finally(() => {
    inflight = null
  })
  return inflight
}

async function runHeartbeat(input: MaybeHeartbeatInput): Promise<HeartbeatWriteResult> {
  const nowMs = input.nowMs ?? Date.now()
  const documentVisible =
    input.documentVisible ??
    (typeof document !== "undefined" ? document.visibilityState === "visible" : false)
  const subscriptionEnabled =
    input.subscriptionEnabled ??
    (isLocalEnabledFlag() && isServerRegisteredFlag())
  const nearbyAlerts = await resolveNearbyAlertsPref(
    input.messaging,
    input.nearbyAlerts
  )

  const gate: HeartbeatGateInput = {
    subscriptionEnabled,
    nearbyAlerts,
    documentVisible,
    lat: input.lat,
    lng: input.lng,
  }

  if (!canAttemptLocationHeartbeat(gate)) {
    return {
      ok: true,
      wrote: false,
      reason: !subscriptionEnabled
        ? "subscription_disabled"
        : !nearbyAlerts
          ? "nearby_off"
          : !documentVisible
            ? "document_hidden"
            : "invalid_location",
    }
  }

  const geohash = encodeNotificationLocationGeohash(input.lat, input.lng)
  if (!geohash) {
    return { ok: true, wrote: false, reason: "invalid_location" }
  }

  const mem = getHeartbeatMemoryState()
  if (
    !shouldWriteLocationHeartbeat({
      candidateGeohash: geohash,
      lastWrittenGeohash: mem.lastGeohash,
      lastWrittenAtMs: mem.lastWrittenAtMs,
      nowMs,
    })
  ) {
    return { ok: true, wrote: false, reason: "throttled", geohash }
  }

  if (!ALLOW_PRODUCTION_SUBSCRIPTION_WRITE) {
    markHeartbeatWriteCommitted(geohash, nowMs)
    return { ok: true, wrote: true, reason: "local_only", geohash }
  }

  try {
    await requireAuthUid()
  } catch {
    return { ok: false, wrote: false, reason: "auth_failed" }
  }

  const id = await resolveSubscriptionId(input.messaging)
  if (!id) {
    return { ok: false, wrote: false, reason: "no_subscription" }
  }

  try {
    await updateDoc(doc(db, "notificationSubscriptions", id), {
      locationGeohash: geohash,
      locationUpdatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    })
    markHeartbeatWriteCommitted(geohash, nowMs)
    setStoredSubscriptionId(id)
    return { ok: true, wrote: true, geohash }
  } catch {
    return { ok: false, wrote: false, reason: "write_failed" }
  }
}

/** Test helper — expose whether a write is in flight. */
export function isLocationHeartbeatInflightForTests(): boolean {
  return inflight != null
}
