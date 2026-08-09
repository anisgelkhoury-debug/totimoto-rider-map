/**
 * TRN 058D — V1 nearby-notification radius policy (pure).
 * Source: 058A architecture; locked for recipient targeting foundation.
 * No FCM. No Firestore.
 */

/** Categories that may receive a nearby push in V1 (structural). */
export const NEARBY_NOTIFICATION_PUSH_CATEGORIES = [
  "checkpoint",
  "accident",
  "road_closed",
  "slippery_road",
  "fire",
  "gunfire",
  "explosionStrike",
  "collapseDanger",
] as const

export type NearbyNotificationPushCategory =
  (typeof NEARBY_NOTIFICATION_PUSH_CATEGORIES)[number]

/** Explicit no-push categories for nearby V1. */
export const NEARBY_NOTIFICATION_NO_PUSH_CATEGORIES = [
  "traffic",
  "otherIncident",
  "other",
  "stolen",
  "marketplace",
  "weather",
  "assistance",
  "sharedRide",
] as const

/**
 * Notification radius (km) — more conservative than map Nearby radii.
 * Coarse geohash targeting may include riders slightly outside these values.
 */
export const NEARBY_NOTIFICATION_RADIUS_KM: Record<
  NearbyNotificationPushCategory,
  number
> = {
  checkpoint: 2,
  accident: 1.5,
  road_closed: 3,
  slippery_road: 1.5,
  fire: 3,
  gunfire: 6,
  explosionStrike: 10,
  collapseDanger: 6,
}

export function isNearbyNotificationPushCategory(
  category: string | null | undefined
): category is NearbyNotificationPushCategory {
  if (typeof category !== "string" || !category) return false
  return (NEARBY_NOTIFICATION_PUSH_CATEGORIES as readonly string[]).includes(
    category
  )
}

/** Radius in km, or null if category is not a V1 nearby-push type. */
export function nearbyNotificationRadiusKm(
  category: string | null | undefined
): number | null {
  if (!isNearbyNotificationPushCategory(category)) return null
  return NEARBY_NOTIFICATION_RADIUS_KM[category]
}

export function nearbyNotificationRadiusMeters(
  category: string | null | undefined
): number | null {
  const km = nearbyNotificationRadiusKm(category)
  if (km == null) return null
  return km * 1000
}

/** Structural report eligibility for nearby push (no freshness/trust yet). */
export function isNearbyNotificationReportEligible(input: {
  reportCategory?: unknown
  reportFamily?: unknown
  resolved?: unknown
}): boolean {
  if (input.resolved === true) return false
  const family =
    typeof input.reportFamily === "string" ? input.reportFamily : null
  if (
    family === "assistance" ||
    family === "sharedRide" ||
    family === "stolen"
  ) {
    return false
  }
  return isNearbyNotificationPushCategory(
    typeof input.reportCategory === "string" ? input.reportCategory : null
  )
}
