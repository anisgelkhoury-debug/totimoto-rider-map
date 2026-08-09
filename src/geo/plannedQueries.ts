/**
 * Planned Firestore query shapes for future bounded geo reads (057D+).
 * Documentation + test anchors only — App does NOT use these yet.
 *
 * Constraint (Firestore + geofire-common):
 * Geohash range uses orderBy('geohash') + startAt/endAt, which is an
 * inequality on `geohash`. Combining that with expiresAt > now (another
 * field inequality) is invalid / impractical for TRN V1.
 *
 * Therefore expiresAt is CLIENT-FILTERED after the geo query.
 */

/** Generic map / Nearby / Duplicate geo range query (per geohash bound). */
export const PLANNED_GEO_RANGE_QUERY = {
  collection: "reports",
  equality: [{ field: "resolved", op: "==", value: false }],
  orderBy: [{ field: "geohash", direction: "asc" }],
  range: { field: "geohash", via: "startAt/endAt" },
  clientFilters: [
    "expiresAt > now (Timestamp)",
    "exact distance within radius (false-positive trim)",
    "Smart Lifecycle soft-hide (aggregates already on doc)",
  ],
  indexFields: [
    { fieldPath: "resolved", order: "ASCENDING" },
    { fieldPath: "geohash", order: "ASCENDING" },
  ],
  note: "One composite serves viewport + rider-centered ranges. No family filter.",
} as const

/** Owner escape hatch — not geo-bounded. */
export const PLANNED_OWNER_UNRESOLVED_QUERY = {
  collection: "reports",
  equality: [
    { field: "ownerUid", op: "==", value: "<auth.uid>" },
    { field: "resolved", op: "==", value: false },
  ],
  orderBy: [{ field: "createdAt", direction: "desc" }],
  limit: 20,
  clientFilters: ["expiresAt > now optional", "isReportExpired minutes fallback"],
  indexFields: [
    { fieldPath: "ownerUid", order: "ASCENDING" },
    { fieldPath: "resolved", order: "ASCENDING" },
    { fieldPath: "createdAt", order: "DESCENDING" },
  ],
  note: "Small owner set for management when panned away from map.",
} as const

/**
 * expiresAt decision for geo migration V1:
 * B — client-filtered after bounded geohash query.
 * Physical TTL deletion remains AFTER bounded queries are proven (057 later).
 */
export const EXPIRES_AT_QUERY_DECISION = {
  choice: "clientFilterAfterGeoQuery",
  code: "B",
  reasons: [
    "geohash startAt/endAt already consumes the range/inequality slot with orderBy geohash",
    "Firebase geo query docs use equality + geohash range, then client distance filter",
    "expired docs in a local geohash cell are few; client drop is cheap",
    "avoids invalid dual-inequality query shapes",
  ],
} as const

/** Stolen: no speculative family×geo index until query strategy is concrete. */
export const STOLEN_INDEX_DECISION = {
  addIndexNow: false,
  reason:
    "Lebanon-wide / coarse strategy undecided; reuse generic geo or family-only query later.",
} as const

/** Assistance/sharedRide reuse generic geo index (no family-specific geo index). */
export const ASSISTANCE_GEO_INDEX_DECISION = {
  separateIndex: false,
  reuse: "PLANNED_GEO_RANGE_QUERY",
} as const

export function plannedGeoIndexDefinitions() {
  return [
    {
      collectionGroup: "reports",
      queryScope: "COLLECTION",
      fields: [...PLANNED_GEO_RANGE_QUERY.indexFields],
      purpose: "generic-map-nearby-duplicate-geo",
    },
    {
      collectionGroup: "reports",
      queryScope: "COLLECTION",
      fields: [...PLANNED_OWNER_UNRESOLVED_QUERY.indexFields],
      purpose: "owner-unresolved-escape",
    },
  ] as const
}
