/**
 * Pure query plans for rider-centered and viewport-bounded geo subscriptions.
 * No Firestore listeners in this module.
 */

import {
  RIDER_NEARBY_MAX_RADIUS_M,
  VIEWPORT_RADIUS_PADDING,
} from "./geoConfig.ts"
import { distanceMeters } from "../utils/reportsRenderStability.ts"
import { isValidGeoCoordinate } from "./coordinates.ts"
import {
  planGeohashQueryRanges,
  type GeohashQueryRange,
} from "./queryRanges.ts"

export type GeoQueryPlan = {
  kind: "riderCentered" | "viewportApprox" | "radius"
  lat: number
  lng: number
  radiusMeters: number
  ranges: GeohashQueryRange[]
}

export type GeoQueryPlanResult =
  | { ok: true; plan: GeoQueryPlan }
  | { ok: false; reason: string }

/**
 * Rider-centered plan covering the approved Nearby max radius (15 km).
 * Feeds future Nearby + Duplicate Intelligence.
 */
export function planRiderCenteredGeoQuery(
  lat: unknown,
  lng: unknown,
  radiusMeters: number = RIDER_NEARBY_MAX_RADIUS_M
): GeoQueryPlanResult {
  const rangesResult = planGeohashQueryRanges(lat, lng, radiusMeters)
  if (!rangesResult.ok) {
    return { ok: false, reason: rangesResult.reason }
  }
  return {
    ok: true,
    plan: {
      kind: "riderCentered",
      lat: rangesResult.lat,
      lng: rangesResult.lng,
      radiusMeters: rangesResult.radiusMeters,
      ranges: rangesResult.ranges,
    },
  }
}

export type ViewportBoundsInput = {
  north: unknown
  south: unknown
  east: unknown
  west: unknown
  /** Optional padding on half-diagonal (default VIEWPORT_RADIUS_PADDING). */
  padding?: number
}

/**
 * Lightweight viewport → circle approximation → geohash ranges.
 *
 * Exact multi-cell viewport tiling can be refined later; this gives a
 * deterministic bounded plan suitable for early flag-gated wiring.
 */
export function planViewportGeoQuery(
  bounds: ViewportBoundsInput
): GeoQueryPlanResult {
  const { north, south, east, west } = bounds
  if (
    typeof north !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof west !== "number" ||
    !Number.isFinite(north) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(west)
  ) {
    return { ok: false, reason: "invalid_bounds" }
  }
  if (north < south) {
    return { ok: false, reason: "north_south_inverted" }
  }
  // Antimeridian-spanning viewports (east < west) deferred — reject explicitly.
  if (east < west) {
    return { ok: false, reason: "antimeridian_viewport_unsupported" }
  }

  const lat = (north + south) / 2
  const lng = (east + west) / 2
  if (!isValidGeoCoordinate(lat, lng)) {
    return { ok: false, reason: "invalid_center" }
  }

  const halfDiag = distanceMeters(south, west, north, east) / 2
  const pad =
    typeof bounds.padding === "number" &&
    Number.isFinite(bounds.padding) &&
    bounds.padding >= 1
      ? bounds.padding
      : VIEWPORT_RADIUS_PADDING
  const radiusMeters = Math.max(1, halfDiag * pad)

  const rangesResult = planGeohashQueryRanges(lat, lng, radiusMeters)
  if (!rangesResult.ok) {
    return { ok: false, reason: rangesResult.reason }
  }

  return {
    ok: true,
    plan: {
      kind: "viewportApprox",
      lat: rangesResult.lat,
      lng: rangesResult.lng,
      radiusMeters: rangesResult.radiusMeters,
      ranges: rangesResult.ranges,
    },
  }
}
