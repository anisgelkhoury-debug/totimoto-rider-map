/**
 * TRN 058B — pure nearby preference eligibility (foundation for 058E).
 * No FCM send. Mirrors client normalize/eligibility semantics for Functions later.
 */

export type NearbyPreferenceKey =
  | "nearbyAlerts"
  | "checkpoint"
  | "accident"
  | "roadClosed"
  | "slippery"
  | "importantIncidents"

export type NormalizedNotificationPreferences = {
  helperLifecycle: boolean
  ownerLifecycle: boolean
  nearbyAlerts: boolean
  checkpoint: boolean
  accident: boolean
  roadClosed: boolean
  slippery: boolean
  importantIncidents: boolean
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export function normalizeNotificationPreferences(raw: unknown): NormalizedNotificationPreferences {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    helperLifecycle: asBool(src.helperLifecycle, true),
    ownerLifecycle: asBool(src.ownerLifecycle, true),
    nearbyAlerts: asBool(src.nearbyAlerts, false),
    checkpoint: asBool(src.checkpoint, true),
    accident: asBool(src.accident, true),
    roadClosed: asBool(src.roadClosed, true),
    slippery: asBool(src.slippery, true),
    importantIncidents: asBool(src.importantIncidents, true),
  }
}

const CATEGORY_TO_PREF: Record<string, NearbyPreferenceKey | null> = {
  checkpoint: "checkpoint",
  accident: "accident",
  road_closed: "roadClosed",
  slippery_road: "slippery",
  fire: "importantIncidents",
  gunfire: "importantIncidents",
  explosionStrike: "importantIncidents",
  collapseDanger: "importantIncidents",
  traffic: null,
  otherIncident: null,
  other: null,
  stolen: null,
  marketplace: null,
}

export function isNearbyCategoryEnabled(
  prefs: NormalizedNotificationPreferences,
  reportCategory: string | null | undefined
): boolean {
  if (prefs.nearbyAlerts !== true) return false
  if (typeof reportCategory !== "string" || !reportCategory) return false
  const key = CATEGORY_TO_PREF[reportCategory]
  if (!key || key === "nearbyAlerts") return false
  return prefs[key] === true
}

export function isSubscriptionEligibleForNearbyAlert(
  subscription: {
    enabled?: unknown
    permissionState?: unknown
    notificationPreferences?: unknown
  },
  reportCategory: string | null | undefined
): boolean {
  if (subscription.enabled !== true) return false
  if (subscription.permissionState !== "granted") return false
  const prefs = normalizeNotificationPreferences(subscription.notificationPreferences)
  return isNearbyCategoryEnabled(prefs, reportCategory)
}
