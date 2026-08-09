/**
 * TRN 058D — filter geo-query candidates (pure). No FCM send.
 */

import {
  isNearbyCategoryEnabled,
  normalizeNotificationPreferences,
} from "./notificationPreferences"
import {
  isNearbyNotificationReportEligible,
} from "./nearbyNotificationRadii"

export const LOCATION_MAX_NOTIFICATION_STALENESS_MS = 30 * 60 * 1000

const GEOHASH_BASE32 = /^[0123456789bcdefghjkmnpqrstuvwxyz]+$/

export type NearbyRecipientSubscriptionDoc = {
  id: string
  uid?: unknown
  enabled?: unknown
  permissionState?: unknown
  token?: unknown
  locationGeohash?: unknown
  locationUpdatedAt?: unknown
  notificationPreferences?: unknown
}

export type NearbyRecipientReportContext = {
  id?: unknown
  ownerUid?: unknown
  reportCategory?: unknown
  reportFamily?: unknown
  resolved?: unknown
}

export type EligibleNearbyRecipient = {
  subscriptionId: string
  uid: string
  token: string
  locationGeohash: string
  locationUpdatedAtMs: number
}

export function normalizeLocationGeohash(value: unknown): string | null {
  if (typeof value !== "string") return null
  const g = value.trim().toLowerCase()
  if (g.length !== 6) return null
  if (!GEOHASH_BASE32.test(g)) return null
  return g
}

export function parseLocationUpdatedAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
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

export function isNotificationLocationFresh(input: {
  locationUpdatedAtMs: number | null | undefined
  nowMs: number
  maxAgeMs?: number
}): boolean {
  const maxAge = input.maxAgeMs ?? LOCATION_MAX_NOTIFICATION_STALENESS_MS
  const at = input.locationUpdatedAtMs
  if (at == null || !Number.isFinite(at)) return false
  const age = input.nowMs - at
  return age >= 0 && age <= maxAge
}

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

function isValidLookingToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.trim().length > 0 &&
    token.trim().length <= 4096
  )
}

export function filterNearbyNotificationRecipients(input: {
  candidates: ReadonlyArray<NearbyRecipientSubscriptionDoc>
  report: NearbyRecipientReportContext
  nowMs: number
  maxLocationAgeMs?: number
}): EligibleNearbyRecipient[] {
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

  eligible.sort((a, b) => (a.subscriptionId < b.subscriptionId ? -1 : 1))
  return eligible
}
