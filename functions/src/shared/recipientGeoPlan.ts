/**
 * TRN 058D — recipient geohash range planning for Admin SDK queries (pure).
 */

import { geohashQueryBounds } from "geofire-common"
import { nearbyNotificationRadiusMeters } from "./nearbyNotificationRadii"

export const RECIPIENT_GEO_STRATEGY = "geohash_range_bounds_precision_6" as const
export const NOTIFICATION_LOCATION_GEOHASH_PRECISION = 6
export const MAX_RECIPIENT_GEO_RANGES = 12

export type RecipientGeohashRange = {
  start: string
  end: string
}

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

function asLatLng(
  lat: unknown,
  lng: unknown
): { lat: number; lng: number } | null {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return null
  }
  return { lat, lng }
}

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

export function planNotificationRecipientCells(input: {
  reportLat: unknown
  reportLng: unknown
  radiusMeters: unknown
}): PlanNotificationRecipientCellsResult {
  const coords = asLatLng(input.reportLat, input.reportLng)
  if (!coords) {
    return { ok: false, reason: "invalid_coordinates" }
  }
  if (Math.abs(coords.lat) > 85) {
    return { ok: false, reason: "unsafe_latitude" }
  }
  if (
    typeof input.radiusMeters !== "number" ||
    !Number.isFinite(input.radiusMeters) ||
    input.radiusMeters <= 0 ||
    input.radiusMeters > 50_000
  ) {
    return { ok: false, reason: "invalid_radius" }
  }

  const radius = input.radiusMeters
  const centerLat = coords.lat
  const centerLng = coords.lng

  try {
    const raw = geohashQueryBounds([centerLat, centerLng], radius)
    const ranges = dedupeRanges(
      raw.map(([start, end]) => ({ start, end }))
    )
    if (ranges.length === 0) return { ok: false, reason: "empty_ranges" }
    if (ranges.length > MAX_RECIPIENT_GEO_RANGES) {
      return { ok: false, reason: "too_many_ranges" }
    }

    const queries: NearbyRecipientSubscriptionQueryPlan[] = ranges.map((r) => ({
      collection: "notificationSubscriptions",
      equality: { field: "enabled" as const, value: true as const },
      range: { field: "locationGeohash" as const, start: r.start, end: r.end },
    }))

    return {
      ok: true,
      strategy: RECIPIENT_GEO_STRATEGY,
      precision: NOTIFICATION_LOCATION_GEOHASH_PRECISION,
      radiusMeters: radius,
      lat: centerLat,
      lng: centerLng,
      ranges,
      queries,
      queryCount: queries.length,
    }
  } catch {
    return { ok: false, reason: "bounds_threw" }
  }
}

export function planNotificationRecipientCellsForCategory(input: {
  reportLat: unknown
  reportLng: unknown
  reportCategory: string | null | undefined
}): PlanNotificationRecipientCellsResult {
  const meters = nearbyNotificationRadiusMeters(input.reportCategory)
  if (meters == null) return { ok: false, reason: "category_ineligible" }
  return planNotificationRecipientCells({
    reportLat: input.reportLat,
    reportLng: input.reportLng,
    radiusMeters: meters,
  })
}

export const NEARBY_RECIPIENT_SUBSCRIPTION_INDEX = {
  collectionGroup: "notificationSubscriptions",
  queryScope: "COLLECTION",
  fields: [
    { fieldPath: "enabled", order: "ASCENDING" },
    { fieldPath: "locationGeohash", order: "ASCENDING" },
  ],
} as const
