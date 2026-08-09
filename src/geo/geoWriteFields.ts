/**
 * Write-boundary helpers for dual-writing geohash + expiresAt on NEW reports.
 * Pure until the caller converts expiresAtMs → Firestore Timestamp.
 */

import { GEO_HASH_STORE_PRECISION } from "./geoConfig.ts"
import {
  buildReportGeoMetadata,
  type BuildReportGeoMetadataInput,
} from "./reportGeoMetadata.ts"

export type ReportGeoWriteFields = {
  geohash: string
  /** Epoch ms — convert with Timestamp.fromMillis at Firestore write. */
  expiresAtMs: number
}

export type BuildReportGeoWriteFieldsResult =
  | { ok: true; fields: ReportGeoWriteFields }
  | { ok: false; reason: string }

/**
 * Build geohash + expiresAtMs for a single create write.
 * Fail closed: no silent Beirut defaults, no invented expiry.
 */
export function buildReportGeoWriteFields(
  input: BuildReportGeoMetadataInput
): BuildReportGeoWriteFieldsResult {
  const built = buildReportGeoMetadata(input)
  if (!built.ok) {
    return { ok: false, reason: built.reason }
  }
  return {
    ok: true,
    fields: {
      geohash: built.metadata.geohash,
      expiresAtMs: built.metadata.expiresAt,
    },
  }
}

/**
 * Merge geo write fields into a plain create payload (test / App helper).
 * Does not convert to Firestore Timestamp — caller does that at addDoc.
 */
export function withGeoWriteFields<T extends Record<string, unknown>>(
  payload: T,
  fields: ReportGeoWriteFields
): T & { geohash: string; expiresAtMs: number } {
  return {
    ...payload,
    geohash: fields.geohash,
    expiresAtMs: fields.expiresAtMs,
  }
}

export function isValidStoredGeohashShape(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === GEO_HASH_STORE_PRECISION &&
    /^[0-9bcdefghjkmnpqrstuvwxyz]+$/.test(value)
  )
}

/** Documented: one create write carries geo fields — no follow-up update. */
export function geoDualWriteUsesFollowUpUpdate(): boolean {
  return false
}

/** Documented: dual-write does not call GPS again. */
export function geoDualWriteRequestsGps(): boolean {
  return false
}
