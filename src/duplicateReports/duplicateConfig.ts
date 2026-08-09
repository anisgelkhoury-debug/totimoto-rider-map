/**
 * V1 Duplicate Report Intelligence — distance thresholds & copy.
 * Hypotheses, not permanent product rules. Keep numbers here only.
 */

/** Max meters for same-category duplicate nudge. */
export const DUPLICATE_DISTANCE_METERS_BY_CATEGORY: Readonly<
  Record<string, number>
> = {
  traffic: 250,
  accident: 300,
  slippery_road: 250,
  road_closed: 350,
  checkpoint: 300,
  fire: 400,
  gunfire: 500,
  explosionStrike: 700,
  collapseDanger: 500,
  otherIncident: 300,
} as const

/**
 * Duplicate age rule (V1):
 * candidate ageMinutes / expiryMinutes must be <= this ratio.
 * Keeps nearly-expired reports from nudging as strong duplicates.
 */
export const DUPLICATE_MAX_AGE_RATIO = 0.75

export const DUPLICATE_COPY = {
  title: "يمكن هيدا البلاغ موجود",
  confirmPresent: "لسا موجود",
  viewReport: "عرض البلاغ",
  createAnyway: "إضافة بلاغ جديد على كل حال",
  ownReport: "هيدا بلاغك",
  confirmFailed: "ما قدرنا نسجّل التأكيد — حاول مرة تانية",
  candidateGone: "هالبلاغ ما عاد ظاهر — فيك تنشر جديد",
  authNotReady: "ثوانٍ… عم نجهّز الحساب",
} as const

export function duplicateDistanceMetersForCategory(
  category: string | null | undefined
): number | null {
  if (typeof category !== "string" || !category) return null
  const m = DUPLICATE_DISTANCE_METERS_BY_CATEGORY[category]
  return typeof m === "number" ? m : null
}
