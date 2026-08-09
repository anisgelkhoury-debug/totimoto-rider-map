/**
 * Firestore-compatible geohash range planning (pure — no Firestore calls).
 */

import { geohashQueryBounds } from "geofire-common"
import {
  GEO_QUERY_RADIUS_MAX_M,
  GEO_QUERY_RADIUS_MIN_M,
} from "./geoConfig.ts"
import {
  isSafeQueryLatitude,
  isValidGeoCoordinate,
} from "./coordinates.ts"

export type GeohashQueryRange = {
  start: string
  end: string
}

export type GeoQueryRangesResult =
  | { ok: true; ranges: GeohashQueryRange[]; lat: number; lng: number; radiusMeters: number }
  | { ok: false; reason: string }

function normalizeRadiusMeters(radiusMeters: unknown): number | null {
  if (typeof radiusMeters !== "number" || !Number.isFinite(radiusMeters)) {
    return null
  }
  if (radiusMeters < GEO_QUERY_RADIUS_MIN_M) return null
  if (radiusMeters > GEO_QUERY_RADIUS_MAX_M) return null
  return radiusMeters
}

/**
 * Dedupe identical [start,end] pairs while preserving first-seen order.
 */
export function dedupeGeohashRanges(
  ranges: ReadonlyArray<GeohashQueryRange>
): GeohashQueryRange[] {
  const seen = new Set<string>()
  const out: GeohashQueryRange[] = []
  for (const r of ranges) {
    if (
      !r ||
      typeof r.start !== "string" ||
      typeof r.end !== "string" ||
      r.start.length === 0 ||
      r.end.length === 0
    ) {
      continue
    }
    const key = `${r.start}\0${r.end}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ start: r.start, end: r.end })
  }
  return out
}

/**
 * Given center + radiusMeters → geohash start/end ranges for Firestore
 * `where('geohash','>=',start).where('geohash','<=',end)` style queries.
 */
export function planGeohashQueryRanges(
  lat: unknown,
  lng: unknown,
  radiusMeters: unknown
): GeoQueryRangesResult {
  if (!isValidGeoCoordinate(lat, lng)) {
    return { ok: false, reason: "invalid_coordinates" }
  }
  if (!isSafeQueryLatitude(lat)) {
    return { ok: false, reason: "unsafe_latitude" }
  }
  const radius = normalizeRadiusMeters(radiusMeters)
  if (radius == null) {
    return { ok: false, reason: "invalid_radius" }
  }

  try {
    const raw = geohashQueryBounds([lat, lng], radius)
    const mapped: GeohashQueryRange[] = raw.map(([start, end]) => ({
      start,
      end,
    }))
    const ranges = dedupeGeohashRanges(mapped)
    if (ranges.length === 0) {
      return { ok: false, reason: "empty_ranges" }
    }
    return { ok: true, ranges, lat, lng, radiusMeters: radius }
  } catch {
    return { ok: false, reason: "bounds_threw" }
  }
}
