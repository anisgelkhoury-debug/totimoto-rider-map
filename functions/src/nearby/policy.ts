/**
 * TRN 058E — freshness, severity, and V1 send-capable category policy (pure).
 */

import {
  isNearbyNotificationPushCategory,
  type NearbyNotificationPushCategory,
} from "../shared/nearbyNotificationRadii"

export type NearbySeverity = "CRITICAL" | "HIGH" | "MEDIUM"

/** Max report age for send (Function retries must not push stale creates). */
export const NEARBY_REPORT_MAX_AGE_MS: Record<
  NearbyNotificationPushCategory,
  number
> = {
  checkpoint: 15 * 60 * 1000,
  accident: 10 * 60 * 1000,
  road_closed: 20 * 60 * 1000,
  slippery_road: 15 * 60 * 1000,
  fire: 15 * 60 * 1000,
  gunfire: 10 * 60 * 1000,
  explosionStrike: 10 * 60 * 1000,
  collapseDanger: 15 * 60 * 1000,
}

export const NEARBY_SEVERITY: Record<NearbyNotificationPushCategory, NearbySeverity> =
  {
    gunfire: "CRITICAL",
    explosionStrike: "CRITICAL",
    collapseDanger: "HIGH",
    accident: "HIGH",
    fire: "HIGH",
    checkpoint: "MEDIUM",
    road_closed: "MEDIUM",
    slippery_road: "MEDIUM",
  }

/**
 * Categories that may call FCM when ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND is true.
 * MEDIUM road intel deferred until trust/confirmation-trigger architecture exists.
 */
export const NEARBY_V1_SEND_CAPABLE_CATEGORIES: readonly NearbyNotificationPushCategory[] =
  [
    "gunfire",
    "explosionStrike",
    "collapseDanger",
    "accident",
    "fire",
  ]

export const NEARBY_V1_SEND_DELAYED_CATEGORIES: readonly NearbyNotificationPushCategory[] =
  ["checkpoint", "road_closed", "slippery_road"]

export function nearbySeverityForCategory(
  category: string | null | undefined
): NearbySeverity | null {
  if (!isNearbyNotificationPushCategory(category)) return null
  return NEARBY_SEVERITY[category]
}

export function isNearbyCategorySendCapable(
  category: string | null | undefined
): boolean {
  if (!isNearbyNotificationPushCategory(category)) return false
  return (NEARBY_V1_SEND_CAPABLE_CATEGORIES as readonly string[]).includes(
    category
  )
}

export function nearbyReportMaxAgeMs(
  category: string | null | undefined
): number | null {
  if (!isNearbyNotificationPushCategory(category)) return null
  return NEARBY_REPORT_MAX_AGE_MS[category]
}

export function isNearbyReportFreshEnough(input: {
  category: string | null | undefined
  createdAtMs: number | null
  nowMs: number
}): boolean {
  const maxAge = nearbyReportMaxAgeMs(input.category)
  if (maxAge == null || input.createdAtMs == null) return false
  const age = input.nowMs - input.createdAtMs
  return age >= 0 && age <= maxAge
}

/**
 * Parent-aggregate trust gates (no confirmation subcollection reads).
 * Create-time reports usually have zeros — CRITICAL/HIGH may still notify as بلاغ.
 */
export function passesNearbyTrustGate(input: {
  category: string | null | undefined
  confirmationPresentCount?: unknown
  confirmationGoneCount?: unknown
  likelyGoneSince?: unknown
}): { ok: boolean; reason?: string } {
  if (!isNearbyCategorySendCapable(input.category)) {
    return { ok: false, reason: "category_send_disabled_v1" }
  }

  if (
    input.likelyGoneSince != null &&
    input.likelyGoneSince !== "" &&
    input.likelyGoneSince !== 0
  ) {
    return { ok: false, reason: "likely_gone" }
  }

  const present =
    typeof input.confirmationPresentCount === "number" &&
    Number.isFinite(input.confirmationPresentCount)
      ? input.confirmationPresentCount
      : 0
  const gone =
    typeof input.confirmationGoneCount === "number" &&
    Number.isFinite(input.confirmationGoneCount)
      ? input.confirmationGoneCount
      : 0

  // Disputed: both sides have votes and gone is not clearly minority.
  if (present >= 1 && gone >= 1 && gone >= present) {
    return { ok: false, reason: "disputed" }
  }

  return { ok: true }
}

/**
 * Cooldown/budget: pure helpers in nearbyBudget.ts (058J).
 * Hard guarantee remains per report×subscription notificationEvents claim.
 * Rolling budget is not persisted in production send path while gate is false.
 */
export const NEARBY_COOLDOWN_POLICY = {
  mode: "hybrid_f_v1_helpers",
  hardDedupe: "nearby_report:{reportId}:{subscriptionId}",
  note: "058J pure budget + reservation helpers; production send remains gate-closed.",
} as const
