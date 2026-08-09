/**
 * Pure geo metadata builder for future dual-write (057B).
 * Does NOT write Firestore.
 */

import { encodeReportGeohash } from "./geohash.ts"
import { deriveExpiresAt } from "./expiresAt.ts"
import { GEO_HASH_STORE_PRECISION } from "./geoConfig.ts"
import { STOLEN_GEO_QUERY_STRATEGY } from "./geoConfig.ts"

export type ReportGeoMetadata = {
  lat: number
  lng: number
  geohash: string
  expiresAt: number
  precision: number
}

export type BuildReportGeoMetadataInput = {
  lat: unknown
  lng: unknown
  createdAt: unknown
  expiryMinutes: unknown
  /** Optional — does not change math; documents family for callers. */
  reportFamily?: string | null
  precision?: number
}

export type BuildReportGeoMetadataResult =
  | { ok: true; metadata: ReportGeoMetadata }
  | { ok: false; reason: string }

/**
 * Build validated { lat, lng, geohash, expiresAt } for a report create path.
 * Stolen long TTL is accepted when expiryMinutes is valid (e.g. 43200).
 * Does not force stolen into short-radius query assumptions.
 */
export function buildReportGeoMetadata(
  input: BuildReportGeoMetadataInput
): BuildReportGeoMetadataResult {
  const precision = input.precision ?? GEO_HASH_STORE_PRECISION
  const hash = encodeReportGeohash(input.lat, input.lng, precision)
  if (!hash.ok) {
    return { ok: false, reason: hash.reason }
  }

  const expires = deriveExpiresAt({
    createdAt: input.createdAt,
    expiryMinutes: input.expiryMinutes,
  })
  if (!expires.ok) {
    return { ok: false, reason: expires.reason }
  }

  // Document-only: stolen family must not be planned with short Nearby radius later.
  if (input.reportFamily === "stolen") {
    void STOLEN_GEO_QUERY_STRATEGY
  }

  return {
    ok: true,
    metadata: {
      lat: hash.lat,
      lng: hash.lng,
      geohash: hash.geohash,
      expiresAt: expires.expiresAt,
      precision: hash.precision,
    },
  }
}
