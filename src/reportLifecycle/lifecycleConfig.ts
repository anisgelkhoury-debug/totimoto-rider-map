/**
 * Smart Report Lifecycle — V1 soft-hide policy constants.
 * Soft-hide shortens default map/list visibility; never extends TTL.
 */

/** Minutes after first likely-gone entry before default visibility soft-hides. */
export const LIFECYCLE_LIKELY_GONE_GRACE_MINUTES = 5

export const LIFECYCLE_LIKELY_GONE_GRACE_MS =
  LIFECYCLE_LIKELY_GONE_GRACE_MINUTES * 60 * 1000

/** Parent-report aggregate field names (server-maintained). */
export const LIFECYCLE_AGGREGATE_FIELDS = {
  presentCount: "confirmationPresentCount",
  goneCount: "confirmationGoneCount",
  updatedAt: "confirmationUpdatedAt",
  likelyGoneSince: "likelyGoneSince",
} as const

/** Optional subtle copy when a soft-hidden report is still open in detail. */
export const LIFECYCLE_COPY = {
  softHiddenHint: "تم إخفاؤه من الخريطة مؤقتاً",
} as const
