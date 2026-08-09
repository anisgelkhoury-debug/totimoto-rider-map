/**
 * V1 Nearby Rider Intelligence — relevance radii by reportCategory.
 *
 * These are PRODUCT HYPOTHESES for V1, not permanent product rules.
 * Tune later with rider feedback; keep all magic numbers here.
 */

export const NEARBY_MAX_RESULTS = 5

/** Kilometers — keyed by reportCategory slug. */
export const NEARBY_RADIUS_KM_BY_CATEGORY: Readonly<Record<string, number>> = {
  // Road intelligence
  traffic: 3,
  accident: 5,
  slippery_road: 5,
  road_closed: 7,
  checkpoint: 5,
  // Incident
  fire: 5,
  gunfire: 8,
  explosionStrike: 15,
  collapseDanger: 10,
  otherIncident: 5,
} as const

/**
 * Severity band for ranking (lower = more severe / higher priority).
 * Applied AFTER radius filtering.
 */
export const NEARBY_SEVERITY_BAND: Readonly<Record<string, number>> = {
  gunfire: 0,
  explosionStrike: 0,
  collapseDanger: 1,
  fire: 1,
  accident: 2,
  road_closed: 2,
  slippery_road: 2,
  checkpoint: 3,
  otherIncident: 3,
  traffic: 4,
} as const

export const NEARBY_COPY = {
  chipSingular: "بلاغ قريب منك",
  chipPlural: (n: number) => `${n} بلاغات قريبة منك`,
  sheetTitle: "قريب منك",
  sheetHint: "أشياء ممكن تأثر على طريقك",
  moreOnMap: "عرض المزيد على الخريطة",
} as const

export function nearbyRadiusKmForCategory(
  category: string | null | undefined
): number | null {
  if (typeof category !== "string" || !category) return null
  const km = NEARBY_RADIUS_KM_BY_CATEGORY[category]
  return typeof km === "number" ? km : null
}

export function nearbySeverityBand(category: string | null | undefined): number {
  if (typeof category !== "string" || !category) return 99
  const band = NEARBY_SEVERITY_BAND[category]
  return typeof band === "number" ? band : 50
}
