/**
 * TRN 058C — coarse location heartbeat pure helpers (no Firestore / no GPS API).
 *
 * Precision 6 ≈ 1.2 km × 0.61 km cells — enough for future recipient-cell queries
 * across V1 notification radii (1.5–10 km) without storing street-level location.
 */

import { geohashForLocation } from "geofire-common"
import { isValidGeoCoordinate } from "../geo/coordinates.ts"

/** Stored coarse geohash length on notificationSubscriptions. */
export const NOTIFICATION_LOCATION_GEOHASH_PRECISION = 6

/**
 * Max interval between heartbeat writes while app is foreground/active
 * and the rider remains in the same coarse cell.
 */
export const LOCATION_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000

/**
 * Future ordinary nearby-alert eligibility: locationUpdatedAt must be ≤ this age.
 * Not used for delivery in 058C — constant for 058D/E.
 */
export const LOCATION_MAX_NOTIFICATION_STALENESS_MS = 30 * 60 * 1000

export const NOTIFICATION_LOCATION_CELL_NOTE =
  "precision 6 ≈ ~1.2 km × 0.61 km at equator; Lebanon-scale coarse area for recipient cells"

const GEOHASH_BASE32 = /^[0123456789bcdefghjkmnpqrstuvwxyz]+$/

export type HeartbeatGateInput = {
  subscriptionEnabled: boolean
  nearbyAlerts: boolean
  documentVisible: boolean
  lat: unknown
  lng: unknown
}

export type HeartbeatWriteDecisionInput = {
  candidateGeohash: string
  lastWrittenGeohash: string | null
  lastWrittenAtMs: number | null
  nowMs: number
  intervalMs?: number
}

/** Validate stored / candidate notification location geohash. */
export function normalizeLocationGeohash(value: unknown): string | null {
  if (typeof value !== "string") return null
  const g = value.trim().toLowerCase()
  if (g.length !== NOTIFICATION_LOCATION_GEOHASH_PRECISION) return null
  if (!GEOHASH_BASE32.test(g)) return null
  return g
}

export function encodeNotificationLocationGeohash(
  lat: unknown,
  lng: unknown
): string | null {
  if (!isValidGeoCoordinate(lat, lng)) return null
  try {
    const geohash = geohashForLocation(
      [lat, lng],
      NOTIFICATION_LOCATION_GEOHASH_PRECISION
    )
    return normalizeLocationGeohash(geohash)
  } catch {
    return null
  }
}

/** Gate: may we even consider a heartbeat attempt? */
export function canAttemptLocationHeartbeat(input: HeartbeatGateInput): boolean {
  if (input.subscriptionEnabled !== true) return false
  if (input.nearbyAlerts !== true) return false
  if (input.documentVisible !== true) return false
  return isValidGeoCoordinate(input.lat, input.lng)
}

export function isHeartbeatDue(input: {
  lastWrittenAtMs: number | null
  nowMs: number
  intervalMs?: number
}): boolean {
  const interval = input.intervalMs ?? LOCATION_HEARTBEAT_INTERVAL_MS
  if (input.lastWrittenAtMs == null || !Number.isFinite(input.lastWrittenAtMs)) {
    return true
  }
  return input.nowMs - input.lastWrittenAtMs >= interval
}

/**
 * Write when first time, coarse cell changed, or interval elapsed in same cell.
 */
export function shouldWriteLocationHeartbeat(
  input: HeartbeatWriteDecisionInput
): boolean {
  const candidate = normalizeLocationGeohash(input.candidateGeohash)
  if (!candidate) return false

  const last = input.lastWrittenGeohash
    ? normalizeLocationGeohash(input.lastWrittenGeohash)
    : null

  if (!last || input.lastWrittenAtMs == null) return true
  if (candidate !== last) return true
  return isHeartbeatDue({
    lastWrittenAtMs: input.lastWrittenAtMs,
    nowMs: input.nowMs,
    intervalMs: input.intervalMs,
  })
}

/** Future 058E helper — ordinary nearby targeting freshness. */
export function isLocationFresh(input: {
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

export type NearbyLocationStatus =
  | "inactive"
  | "need_location"
  | "ready"
  | "stale_local"

export function resolveNearbyLocationStatusAr(input: {
  nearbyAlerts: boolean
  hasMyLocation: boolean
  lastHeartbeatAtMs: number | null
  nowMs?: number
}): NearbyLocationStatus {
  if (!input.nearbyAlerts) return "inactive"
  if (!input.hasMyLocation) return "need_location"
  const now = input.nowMs ?? Date.now()
  if (
    input.lastHeartbeatAtMs != null &&
    !isLocationFresh({
      locationUpdatedAtMs: input.lastHeartbeatAtMs,
      nowMs: now,
    })
  ) {
    return "stale_local"
  }
  return "ready"
}

export const LOCATION_HEARTBEAT_COPY_AR = {
  locationReady: "الموقع جاهز للتنبيهات",
  needLocation: "فعّل الموقع حتى توصلك التنبيهات القريبة",
  locationStale: "آخر موقع للتنبيهات قديم — افتح التطبيق بالموقع",
  nearbyNotLiveYet:
    "مشاركة آخر موقع تقريبي تصير لما التطبيق مفتوح. إرسال التنبيهات القريبة لسا بالمرحلة الجاية.",
} as const

export function nearbyLocationStatusLabelAr(status: NearbyLocationStatus): string {
  switch (status) {
    case "need_location":
      return LOCATION_HEARTBEAT_COPY_AR.needLocation
    case "stale_local":
      return LOCATION_HEARTBEAT_COPY_AR.locationStale
    case "ready":
      return LOCATION_HEARTBEAT_COPY_AR.locationReady
    default:
      return ""
  }
}
