/**
 * Pure query-shape builders for bounded geo reads (testable without Firestore).
 */

import type { GeohashQueryRange } from "./queryRanges.ts"

export type GeoRangeQueryShape = {
  collection: "reports"
  where: Array<{ field: string; op: "=="; value: false }>
  orderBy: Array<{ field: string; direction: "asc" }>
  startAt: string
  endAt: string
}

export type OwnerUnresolvedQueryShape = {
  collection: "reports"
  where: Array<{ field: string; op: "=="; value: string | false }>
  orderBy: Array<{ field: string; direction: "desc" }>
  limit: number
}

/** Matches prepared index: resolved ASC + geohash ASC. */
export function buildResolvedGeohashRangeQueryShape(
  range: GeohashQueryRange
): GeoRangeQueryShape {
  return {
    collection: "reports",
    where: [{ field: "resolved", op: "==", value: false }],
    orderBy: [{ field: "geohash", direction: "asc" }],
    startAt: range.start,
    endAt: range.end,
  }
}

export function buildOwnerUnresolvedQueryShape(
  ownerUid: string,
  limit = 20
): OwnerUnresolvedQueryShape {
  return {
    collection: "reports",
    where: [
      { field: "ownerUid", op: "==", value: ownerUid },
      { field: "resolved", op: "==", value: false },
    ],
    orderBy: [{ field: "createdAt", direction: "desc" }],
    limit,
  }
}

export const OWNER_UNRESOLVED_LIMIT = 20

export function isMissingIndexError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const code =
    "code" in error ? String((error as { code?: unknown }).code) : ""
  const message =
    "message" in error ? String((error as { message?: unknown }).message) : ""
  return (
    code === "failed-precondition" ||
    /requires an index/i.test(message) ||
    /FAILED_PRECONDITION/i.test(message)
  )
}

export const BOUNDED_GEO_INDEX_REQUIRED = "bounded_geo_index_required"
