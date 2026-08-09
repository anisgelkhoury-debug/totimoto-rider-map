/**
 * Deterministic geohash encoding via geofire-common.
 */

import { geohashForLocation } from "geofire-common"
import { GEO_HASH_STORE_PRECISION } from "./geoConfig.ts"
import { isValidGeoCoordinate } from "./coordinates.ts"

export type EncodeGeohashResult =
  | { ok: true; geohash: string; precision: number; lat: number; lng: number }
  | { ok: false; reason: string }

/**
 * Encode lat/lng at TRN store precision.
 * Invalid coordinates → ok:false (no silent clamp).
 */
export function encodeReportGeohash(
  lat: unknown,
  lng: unknown,
  precision: number = GEO_HASH_STORE_PRECISION
): EncodeGeohashResult {
  if (!isValidGeoCoordinate(lat, lng)) {
    return { ok: false, reason: "invalid_coordinates" }
  }
  if (
    typeof precision !== "number" ||
    !Number.isFinite(precision) ||
    precision < 1 ||
    precision > 12
  ) {
    return { ok: false, reason: "invalid_precision" }
  }

  const p = Math.floor(precision)
  try {
    const geohash = geohashForLocation([lat, lng], p)
    if (typeof geohash !== "string" || geohash.length !== p) {
      return { ok: false, reason: "encode_failed" }
    }
    return { ok: true, geohash, precision: p, lat, lng }
  } catch {
    return { ok: false, reason: "encode_threw" }
  }
}

export function geohashOrNull(
  lat: unknown,
  lng: unknown,
  precision?: number
): string | null {
  const r = encodeReportGeohash(lat, lng, precision)
  return r.ok ? r.geohash : null
}
