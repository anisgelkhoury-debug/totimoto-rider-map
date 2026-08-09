/**
 * TRN 058D — V1 nearby-notification radius policy (pure). Mirrors client module.
 */

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
