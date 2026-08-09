/**
 * TRN 058D — coarse recipient geo-cell / range planning (pure).
 *
 * Strategy: geohash range bounds (geofire-common) over precision-6
 * notificationSubscriptions.locationGeohash fields.
 *
 * Privacy: server has only coarse cells — candidates may include riders
 * slightly outside the nominal notification radius. No lat/lng on subscriptions.
 */

import { geohashQueryBounds } from "geofire-common"
import { isSafeQueryLatitude, isValidGeoCoordinate } from "../geo/coordinates.ts"
import { NOTIFICATION_LOCATION_GEOHASH_PRECISION } from "./locationHeartbeat.ts"
import { nearbyNotificationRadiusMeters } from "./nearbyNotificationRadii.ts"

export const RECIPIENT_GEO_STRATEGY = "geohash_range_bounds_precision_6" as const

/** Max geohashQueryBounds ranges we expect; reject pathological results. */
export const MAX_RECIPIENT_GEO_RANGES = 12

export type RecipientGeohashRange = {
  start: string
  end: string
}

/**
 * Planned Admin SDK query (not executed here):
 * notificationSubscriptions
 *   where enabled == true
 *   where locationGeohash >= start
 *   where locationGeohash <= end
 */
export type NearbyRecipientSubscriptionQueryPlan = {
  collection: "notificationSubscriptions"
  equality: { field: "enabled"; value: true }
  range: { field: "locationGeohash"; start: string; end: string }
}

export type PlanNotificationRecipientCellsResult =
  | {
      ok: true
      strategy: typeof RECIPIENT_GEO_STRATEGY
      precision: number
      radiusMeters: number
      lat: number
      lng: number
      ranges: RecipientGeohashRange[]
      queries: NearbyRecipientSubscriptionQueryPlan[]
      queryCount: number
    }
  | { ok: false; reason: string }

function dedupeRanges(
  ranges: ReadonlyArray<RecipientGeohashRange>
): RecipientGeohashRange[] {
  const seen = new Set<string>()
  const out: RecipientGeohashRange[] = []
  for (const r of ranges) {
    if (
      !r ||
      typeof r.start !== "string" ||
      typeof r.end !== "string" ||
      r.start.length === 0 ||
      r.end.length === 0
    ) {
      continue
    }
    const key = `${r.start}\0${r.end}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ start: r.start, end: r.end })
  }
  return out
}

/**
 * Plan precision-aware geohash ranges for a report location + radius.
 * Pure — no Firestore.
 */
export function planNotificationRecipientCells(input: {
  reportLat: unknown
  reportLng: unknown
  radiusMeters: unknown
}): PlanNotificationRecipientCellsResult {
  const { reportLat: lat, reportLng: lng, radiusMeters } = input
  if (!isValidGeoCoordinate(lat, lng)) {
    return { ok: false, reason: "invalid_coordinates" }
  }
  if (!isSafeQueryLatitude(lat)) {
    return { ok: false, reason: "unsafe_latitude" }
  }
  if (
    typeof radiusMeters !== "number" ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0 ||
    radiusMeters > 50_000
  ) {
    return { ok: false, reason: "invalid_radius" }
  }

  try {
    const raw = geohashQueryBounds([lat, lng], radiusMeters)
    const mapped: RecipientGeohashRange[] = raw.map(([start, end]) => ({
      start,
      end,
    }))
    const ranges = dedupeRanges(mapped)
    if (ranges.length === 0) {
      return { ok: false, reason: "empty_ranges" }
    }
    if (ranges.length > MAX_RECIPIENT_GEO_RANGES) {
      return { ok: false, reason: "too_many_ranges" }
    }

    const queries: NearbyRecipientSubscriptionQueryPlan[] = ranges.map((r) => ({
      collection: "notificationSubscriptions",
      equality: { field: "enabled", value: true },
      range: { field: "locationGeohash", start: r.start, end: r.end },
    }))

    return {
      ok: true,
      strategy: RECIPIENT_GEO_STRATEGY,
      precision: NOTIFICATION_LOCATION_GEOHASH_PRECISION,
      radiusMeters,
      lat,
      lng,
      ranges,
      queries,
      queryCount: queries.length,
    }
  } catch {
    return { ok: false, reason: "bounds_threw" }
  }
}

/** Plan using V1 category → radius mapping. */
export function planNotificationRecipientCellsForCategory(input: {
  reportLat: unknown
  reportLng: unknown
  reportCategory: string | null | undefined
}): PlanNotificationRecipientCellsResult {
  const meters = nearbyNotificationRadiusMeters(input.reportCategory)
  if (meters == null) {
    return { ok: false, reason: "category_ineligible" }
  }
  return planNotificationRecipientCells({
    reportLat: input.reportLat,
    reportLng: input.reportLng,
    radiusMeters: meters,
  })
}

/**
 * Composite index required for planned queries (local firestore.indexes.json).
 * Not deployed by 058D.
 */
export const NEARBY_RECIPIENT_SUBSCRIPTION_INDEX = {
  collectionGroup: "notificationSubscriptions",
  queryScope: "COLLECTION",
  fields: [
    { fieldPath: "enabled", order: "ASCENDING" },
    { fieldPath: "locationGeohash", order: "ASCENDING" },
  ],
} as const
