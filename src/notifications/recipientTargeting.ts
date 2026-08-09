/**
 * TRN 058D — filter candidate notificationSubscriptions for nearby alerts.
 * Pure. No FCM. No Firestore. No GPS.
 *
 * Multi-device: each subscription id is independently eligible.
 * Self-reporter: exclude when subscription.uid === report.ownerUid.
 */

import {
  LOCATION_MAX_NOTIFICATION_STALENESS_MS,
  isLocationFresh,
  normalizeLocationGeohash,
} from "./locationHeartbeat.ts"
import {
  isNearbyCategoryEnabled,
  normalizeNotificationPreferences,
} from "./notificationPreferences.ts"
import { isNearbyNotificationReportEligible } from "./nearbyNotificationRadii.ts"

export {
  isNearbyNotificationReportEligible,
  nearbyNotificationRadiusKm,
  nearbyNotificationRadiusMeters,
  NEARBY_NOTIFICATION_RADIUS_KM,
} from "./nearbyNotificationRadii.ts"

export {
  planNotificationRecipientCells,
  planNotificationRecipientCellsForCategory,
  NEARBY_RECIPIENT_SUBSCRIPTION_INDEX,
  RECIPIENT_GEO_STRATEGY,
} from "./recipientGeoPlan.ts"

export type NearbyRecipientSubscriptionDoc = {
  id: string
  uid?: unknown
  enabled?: unknown
  permissionState?: unknown
  token?: unknown
  locationGeohash?: unknown
  locationUpdatedAt?: unknown
  notificationPreferences?: unknown
  installationId?: unknown
  deviceId?: unknown
}

export type NearbyRecipientReportContext = {
  id?: unknown
  ownerUid?: unknown
  reportCategory?: unknown
  reportFamily?: unknown
  resolved?: unknown
  lat?: unknown
  lng?: unknown
}

export type EligibleNearbyRecipient = {
  subscriptionId: string
  uid: string
  token: string
  locationGeohash: string
  locationUpdatedAtMs: number
}

export function isNotificationLocationFresh(input: {
  locationUpdatedAtMs: number | null | undefined
  nowMs: number
  maxAgeMs?: number
}): boolean {
  return isLocationFresh({
    locationUpdatedAtMs: input.locationUpdatedAtMs,
    nowMs: input.nowMs,
    maxAgeMs: input.maxAgeMs ?? LOCATION_MAX_NOTIFICATION_STALENESS_MS,
  })
}

/** Parse Firestore Timestamp / millis / seconds into epoch ms. */
export function parseLocationUpdatedAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: seconds vs millis
    if (value > 0 && value < 1e12) return Math.floor(value * 1000)
    return Math.floor(value)
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    try {
      const ms = (value as { toMillis: () => number }).toMillis()
      return Number.isFinite(ms) ? ms : null
    } catch {
      return null
    }
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const seconds = (value as { seconds: number; nanoseconds?: number }).seconds
    const nanos =
      typeof (value as { nanoseconds?: number }).nanoseconds === "number"
        ? (value as { nanoseconds: number }).nanoseconds
        : 0
    return Math.floor(seconds * 1000 + nanos / 1e6)
  }
  return null
}

function isValidLookingToken(token: unknown): token is string {
  return typeof token === "string" && token.trim().length > 0 && token.trim().length <= 4096
}

/**
 * Deduplicate query merge by subscription document id (keeps first-seen order).
 * Does NOT collapse multiple devices for the same uid.
 */
export function dedupeSubscriptionsById(
  docs: ReadonlyArray<NearbyRecipientSubscriptionDoc>
): NearbyRecipientSubscriptionDoc[] {
  const seen = new Set<string>()
  const out: NearbyRecipientSubscriptionDoc[] = []
  for (const doc of docs) {
    if (!doc || typeof doc.id !== "string" || !doc.id) continue
    if (seen.has(doc.id)) continue
    seen.add(doc.id)
    out.push(doc)
  }
  return out
}

/**
 * Identity rule: never notify the report creator on any of their devices.
 * Uses Auth uid only (ownerUid). deviceId is not used for exclusion.
 */
export function isSelfReporterSubscription(
  subscription: NearbyRecipientSubscriptionDoc,
  report: NearbyRecipientReportContext
): boolean {
  const ownerUid =
    typeof report.ownerUid === "string" ? report.ownerUid.trim() : ""
  const subUid = typeof subscription.uid === "string" ? subscription.uid.trim() : ""
  if (!ownerUid || !subUid) return false
  return ownerUid === subUid
}

export type FilterNearbyRecipientsInput = {
  candidates: ReadonlyArray<NearbyRecipientSubscriptionDoc>
  report: NearbyRecipientReportContext
  nowMs: number
  /** Default LOCATION_MAX_NOTIFICATION_STALENESS_MS */
  maxLocationAgeMs?: number
}

/**
 * Apply preference / freshness / self-exclusion filters to geo-query candidates.
 * Deterministic. No FCM.
 */
export function filterNearbyNotificationRecipients(
  input: FilterNearbyRecipientsInput
): EligibleNearbyRecipient[] {
  const reportCategory =
    typeof input.report.reportCategory === "string"
      ? input.report.reportCategory
      : null

  if (
    !isNearbyNotificationReportEligible({
      reportCategory,
      reportFamily: input.report.reportFamily,
      resolved: input.report.resolved,
    })
  ) {
    return []
  }

  const deduped = dedupeSubscriptionsById(input.candidates)
  const eligible: EligibleNearbyRecipient[] = []

  for (const doc of deduped) {
    if (doc.enabled !== true) continue
    if (doc.permissionState !== "granted") continue
    if (!isValidLookingToken(doc.token)) continue
    if (isSelfReporterSubscription(doc, input.report)) continue

    const geohash = normalizeLocationGeohash(doc.locationGeohash)
    if (!geohash) continue

    const updatedAtMs = parseLocationUpdatedAtMs(doc.locationUpdatedAt)
    if (
      !isNotificationLocationFresh({
        locationUpdatedAtMs: updatedAtMs,
        nowMs: input.nowMs,
        maxAgeMs: input.maxLocationAgeMs,
      })
    ) {
      continue
    }

    const prefs = normalizeNotificationPreferences(doc.notificationPreferences)
    if (!isNearbyCategoryEnabled(prefs, reportCategory)) continue

    const uid = typeof doc.uid === "string" ? doc.uid.trim() : ""
    if (!uid) continue

    eligible.push({
      subscriptionId: doc.id,
      uid,
      token: doc.token.trim(),
      locationGeohash: geohash,
      locationUpdatedAtMs: updatedAtMs as number,
    })
  }

  // Stable order by subscriptionId
  eligible.sort((a, b) => (a.subscriptionId < b.subscriptionId ? -1 : 1))
  return eligible
}
