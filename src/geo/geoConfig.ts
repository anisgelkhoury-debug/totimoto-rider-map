/**
 * Geographic query foundation — constants for future bounded listeners.
 * No Firestore I/O. No App wiring.
 */

/** Stored report geohash string length (single field). */
export const GEO_HASH_STORE_PRECISION = 9

/**
 * Precision 9 ≈ 4.8 m × 4.8 m at the equator (order-of-magnitude).
 * Long enough for geofire-common range bounds across 250 m–15 km radii;
 * shorter than library default 10 while remaining query-safe.
 */
export const GEO_HASH_CELL_SIZE_NOTE =
  "precision 9 ≈ ~5 m cells at equator; supports multi-radius range queries"

/** Approved Nearby / rider-centered max radius (explosionStrike). */
export const RIDER_NEARBY_MAX_RADIUS_KM = 15
export const RIDER_NEARBY_MAX_RADIUS_M = RIDER_NEARBY_MAX_RADIUS_KM * 1000

/** Practical radius limits for query planning (meters). */
export const GEO_QUERY_RADIUS_MIN_M = 1
export const GEO_QUERY_RADIUS_MAX_M = 50_000

/** Viewport padding multiplier on half-diagonal radius. */
export const VIEWPORT_RADIUS_PADDING = 1.25

/**
 * Stolen bikes are NOT viewport-only / short-radius.
 * Placeholder strategy for later tasks — not implemented as a query here.
 */
export const STOLEN_GEO_QUERY_STRATEGY = {
  mode: "lebanonWideOrCoarse",
  notShortRadius: true,
  note: "Use family-scoped or coarse national cells — never force 3–15 km only.",
} as const

export type StolenGeoQueryStrategy = typeof STOLEN_GEO_QUERY_STRATEGY
