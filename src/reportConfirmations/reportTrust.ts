/**
 * V1 trust + freshness for confirmation-eligible live reports.
 * Pure deterministic helpers — no Firestore writes, no TTL mutation.
 */

import {
  COMMUNITY_TRUST_MIN_PRESENT,
  CONFIRMATION_COPY,
  type ConfirmationCounts,
  type ConfirmationishReport,
  isConfirmationEligibleReport,
  meetsCommunityTrustThreshold,
} from "./reportConfirmations.ts"

export const TRUST_STATE = {
  default: "default",
  confirmed: "confirmed",
  disputed: "disputed",
  likelyGone: "likelyGone",
} as const

export type TrustState = (typeof TRUST_STATE)[keyof typeof TRUST_STATE]

export const FRESHNESS_STATE = {
  veryFresh: "veryFresh",
  fresh: "fresh",
  aging: "aging",
  expiringSoon: "expiringSoon",
} as const

export type FreshnessState =
  (typeof FRESHNESS_STATE)[keyof typeof FRESHNESS_STATE]

/** Rider-facing trust labels (Arabic only). */
export const TRUST_LABELS = {
  default: CONFIRMATION_COPY.trustDefault,
  confirmed: CONFIRMATION_COPY.trustCommunity,
  disputed: "مختلف عليه",
  likelyGone: "يبدو أنه لم يعد موجوداً",
} as const

/** Rider-facing freshness labels (Arabic only). */
export const FRESHNESS_LABELS = {
  veryFresh: "حديث جداً",
  fresh: "حديث",
  aging: "قديم نسبياً",
  expiringSoon: "سينتهي قريباً",
} as const

/**
 * Exact trust thresholds (V1):
 *
 * CONFIRMED:
 *   present >= 3 AND present >= 2 * gone
 *
 * LIKELY_GONE:
 *   gone >= 3 AND gone >= 2 * present
 *
 * DISPUTED:
 *   present >= 2 AND gone >= 2
 *   AND present < 2 * gone
 *   AND gone < 2 * present
 *   (neither side clearly dominates)
 *
 * DEFAULT:
 *   everything else (including a single vote)
 *
 * Priority: confirmed → likelyGone → disputed → default
 */
export const TRUST_MIN_SIDE = 2
export const LIKELY_GONE_MIN_GONE = 3

export function resolveTrustState(counts: ConfirmationCounts): TrustState {
  const { presentCount: p, goneCount: g } = counts

  if (meetsCommunityTrustThreshold(counts)) {
    return TRUST_STATE.confirmed
  }

  if (g >= LIKELY_GONE_MIN_GONE && g >= p * 2) {
    return TRUST_STATE.likelyGone
  }

  if (
    p >= TRUST_MIN_SIDE &&
    g >= TRUST_MIN_SIDE &&
    p < g * 2 &&
    g < p * 2
  ) {
    return TRUST_STATE.disputed
  }

  return TRUST_STATE.default
}

export function trustLabelForState(state: TrustState): string {
  return TRUST_LABELS[state]
}

/** Color for compact trust line (subtle, not official-looking). */
export function trustStateColor(state: TrustState): string {
  switch (state) {
    case TRUST_STATE.confirmed:
      return "#0f766e"
    case TRUST_STATE.disputed:
      return "#b45309"
    case TRUST_STATE.likelyGone:
      return "#b91c1c"
    default:
      return "#64748b"
  }
}

/**
 * Freshness vs report TTL (minutes).
 *
 * ageRatio = ageMinutes / ttlMinutes
 *   < 0.25     → حديث جداً
 *   0.25–0.60  → حديث
 *   0.60–0.85  → قديم نسبياً (inclusive of 0.85)
 *   > 0.85     → سينتهي قريباً
 *
 * No finite TTL → null (caller may fall back to timeAgo).
 */
export function resolveFreshnessState(options: {
  createdAt: unknown
  expiry?: unknown
  now?: number
}): FreshnessState | null {
  const now = options.now ?? Date.now()
  const createdAt =
    typeof options.createdAt === "number" && Number.isFinite(options.createdAt)
      ? options.createdAt
      : null
  const expiry =
    typeof options.expiry === "number" &&
    Number.isFinite(options.expiry) &&
    options.expiry > 0
      ? options.expiry
      : null

  if (createdAt == null || expiry == null) return null

  const ageMinutes = Math.max(0, (now - createdAt) / 1000 / 60)
  const ratio = ageMinutes / expiry

  if (ratio < 0.25) return FRESHNESS_STATE.veryFresh
  if (ratio < 0.6) return FRESHNESS_STATE.fresh
  if (ratio <= 0.85) return FRESHNESS_STATE.aging
  return FRESHNESS_STATE.expiringSoon
}

export function freshnessLabelForState(
  state: FreshnessState | null
): string | null {
  if (state == null) return null
  return FRESHNESS_LABELS[state]
}

/**
 * Trust applies only to confirmation-eligible families.
 * Assistance / sharedRide / stolen → no trust state (null).
 */
export function trustStateForReport(
  report: ConfirmationishReport | null | undefined,
  counts: ConfirmationCounts
): TrustState | null {
  if (!isConfirmationEligibleReport(report)) return null
  return resolveTrustState(counts)
}

/** Documented: trust layer alone does not auto-hide (lifecycle soft-hide is separate). */
export function trustLayerAutoHidesReports(): boolean {
  return false
}

/** Documented: V1 does not extend TTL on confirmation. */
export function trustLayerExtendsExpiry(): boolean {
  return false
}

/** Documented: no notification path from trust layer. */
export function trustLayerCreatesNotificationPath(): boolean {
  return false
}

/** Re-export threshold constant for tests / docs. */
export { COMMUNITY_TRUST_MIN_PRESENT }
