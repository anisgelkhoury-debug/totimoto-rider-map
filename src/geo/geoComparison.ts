/**
 * Pure comparison helpers for full-listener vs bounded geo (057E).
 * No Firestore I/O. Summaries avoid dumping huge ID lists / PII.
 */

import { filterBoundedLiveReports } from "./filterBoundedReports.ts"
import { RIDER_NEARBY_MAX_RADIUS_M } from "./geoConfig.ts"
import { OWNER_UNRESOLVED_LIMIT } from "./queryBuilder.ts"
import { distanceMeters } from "../utils/reportsRenderStability.ts"
import { isValidGeoCoordinate } from "./coordinates.ts"
import {
  compareFullVsBoundedReportIds,
  type ReportIdSetComparison,
} from "./compareReportIds.ts"

export type DiffReason =
  | "missing_geohash"
  | "outside_radius"
  | "outside_viewport"
  | "stolen_deferred"
  | "expired"
  | "soft_hidden"
  | "invalid_coords"
  | "resolved"
  | "owner_limit"
  | "bounded_only_suspicious"
  | "unknown"

export type ClassifiedDiff = {
  id: string
  side: "full_only" | "bounded_only"
  reason: DiffReason
}

export type ComparisonSummary = {
  fullCount: number
  boundedCount: number
  intersectionCount: number
  fullOnlyCount: number
  boundedOnlyCount: number
  missingGeohashInFull: number
  fullOnlyByReason: Partial<Record<DiffReason, number>>
  boundedOnlyByReason: Partial<Record<DiffReason, number>>
  sampleFullOnlyIds: string[]
  sampleBoundedOnlyIds: string[]
}

export type ExpectedVsBoundedResult = {
  expectedCount: number
  boundedCount: number
  intersectionCount: number
  expectedOnlyCount: number
  boundedOnlyCount: number
  equal: boolean
  sampleExpectedOnlyIds: string[]
  sampleBoundedOnlyIds: string[]
}

export type ReadCostEstimate = {
  fullInitialDocs: number
  boundedViewportDocs: number
  boundedRiderDocs: number
  ownerMax: number
  occasionalGetDoc: number
  boundedUniqueEstimate: number
  reductionPct: number
}

type ReportLike = {
  id?: string | number | null
  lat?: unknown
  lng?: unknown
  geohash?: unknown
  expiresAt?: unknown
  resolved?: unknown
  reportFamily?: unknown
  type?: unknown
  ownerUid?: unknown
  createdAt?: unknown
  expiry?: unknown
  confirmationPresentCount?: unknown
  confirmationGoneCount?: unknown
  likelyGoneSince?: unknown
}

function idOf(report: ReportLike): string | null {
  if (report.id == null) return null
  const id = String(report.id).trim()
  return id.length > 0 ? id : null
}

function isStolen(report: ReportLike): boolean {
  if (report.reportFamily === "stolen") return true
  return typeof report.type === "string" && report.type.includes("مسروقة")
}

function inBounds(
  report: ReportLike,
  bounds: { north: number; south: number; east: number; west: number }
): boolean {
  if (!isValidGeoCoordinate(report.lat, report.lng)) return false
  const lat = report.lat as number
  const lng = report.lng as number
  return (
    lat <= bounds.north &&
    lat >= bounds.south &&
    lng <= bounds.east &&
    lng >= bounds.west
  )
}

function sampleIds(ids: ReadonlyArray<string>, n = 5): string[] {
  return ids.slice(0, n)
}

export function summarizeIdComparison(
  cmp: ReportIdSetComparison,
  options: { sampleSize?: number } = {}
): ComparisonSummary {
  const n = options.sampleSize ?? 5
  return {
    fullCount: cmp.fullCount,
    boundedCount: cmp.boundedCount,
    intersectionCount: cmp.shared.length,
    fullOnlyCount: cmp.fullOnly.length,
    boundedOnlyCount: cmp.boundedOnly.length,
    missingGeohashInFull: cmp.missingGeohashInFull,
    fullOnlyByReason: {},
    boundedOnlyByReason: {},
    sampleFullOnlyIds: sampleIds(cmp.fullOnly, n),
    sampleBoundedOnlyIds: sampleIds(cmp.boundedOnly, n),
  }
}

/**
 * Classify full-only / bounded-only IDs using full report objects.
 * Bounded-only is treated as suspicious by default.
 */
export function classifyComparisonDiffs(options: {
  fullReports: ReadonlyArray<ReportLike>
  comparison: ReportIdSetComparison
  riderLat?: number | null
  riderLng?: number | null
  radiusMeters?: number
  viewport?: { north: number; south: number; east: number; west: number } | null
  deferStolen?: boolean
}): {
  classified: ClassifiedDiff[]
  summary: ComparisonSummary
} {
  const byId = new Map<string, ReportLike>()
  for (const r of options.fullReports) {
    const id = idOf(r)
    if (id) byId.set(id, r)
  }
  const radius = options.radiusMeters ?? RIDER_NEARBY_MAX_RADIUS_M
  const deferStolen = options.deferStolen !== false
  const classified: ClassifiedDiff[] = []
  const fullOnlyByReason: Partial<Record<DiffReason, number>> = {}
  const boundedOnlyByReason: Partial<Record<DiffReason, number>> = {}

  const bump = (
    bag: Partial<Record<DiffReason, number>>,
    reason: DiffReason
  ) => {
    bag[reason] = (bag[reason] ?? 0) + 1
  }

  for (const id of options.comparison.fullOnly) {
    const report = byId.get(id)
    let reason: DiffReason = "unknown"
    if (!report) reason = "unknown"
    else if (report.resolved === true) reason = "resolved"
    else if (!isValidGeoCoordinate(report.lat, report.lng)) {
      reason = "invalid_coords"
    } else if (
      typeof report.geohash !== "string" ||
      !report.geohash.trim()
    ) {
      reason = "missing_geohash"
    } else if (deferStolen && isStolen(report)) {
      reason = "stolen_deferred"
    } else if (
      options.riderLat != null &&
      options.riderLng != null &&
      isValidGeoCoordinate(options.riderLat, options.riderLng)
    ) {
      const d = distanceMeters(
        options.riderLat,
        options.riderLng,
        report.lat as number,
        report.lng as number
      )
      const inRider = d <= radius
      const inView = options.viewport
        ? inBounds(report, options.viewport)
        : false
      if (!inRider && !inView) {
        reason = options.viewport ? "outside_viewport" : "outside_radius"
      } else if (!inRider) {
        reason = "outside_radius"
      } else if (options.viewport && !inView) {
        // Still in rider set — should appear in bounded merge; leave unknown
        reason = "unknown"
      }
    }
    classified.push({ id, side: "full_only", reason })
    bump(fullOnlyByReason, reason)
  }

  for (const id of options.comparison.boundedOnly) {
    classified.push({
      id,
      side: "bounded_only",
      reason: "bounded_only_suspicious",
    })
    bump(boundedOnlyByReason, "bounded_only_suspicious")
  }

  const base = summarizeIdComparison(options.comparison)
  return {
    classified,
    summary: {
      ...base,
      fullOnlyByReason,
      boundedOnlyByReason,
    },
  }
}

/**
 * Equality check that matters for 057E:
 * full → same geo/expiry/lifecycle filters == bounded IDs
 * (optionally exclude stolen).
 */
export function compareExpectedFilteredVsBounded(options: {
  fullReports: ReadonlyArray<ReportLike>
  boundedReports: ReadonlyArray<ReportLike>
  centerLat: number
  centerLng: number
  maxDistanceMeters?: number
  excludeStolen?: boolean
  now?: number
  selectedReportId?: string | null
  viewerDeviceId?: string | null
  viewerUid?: string | null
}): ExpectedVsBoundedResult {
  const maxDistanceMeters =
    options.maxDistanceMeters ?? RIDER_NEARBY_MAX_RADIUS_M
  let full = options.fullReports
  if (options.excludeStolen !== false) {
    full = full.filter((r) => !isStolen(r))
  }
  const expected = filterBoundedLiveReports(full, {
    now: options.now,
    centerLat: options.centerLat,
    centerLng: options.centerLng,
    maxDistanceMeters,
    selectedReportId: options.selectedReportId,
    viewerDeviceId: options.viewerDeviceId,
    viewerUid: options.viewerUid,
    requireGeohash: true,
  })
  let bounded = options.boundedReports
  if (options.excludeStolen !== false) {
    bounded = bounded.filter((r) => !isStolen(r))
  }
  const expectedIds = expected.map((r) => String(r.id)).filter(Boolean)
  const boundedIds = bounded.map((r) => String(r.id)).filter(Boolean)
  const cmp = compareFullVsBoundedReportIds({
    fullIds: expectedIds,
    boundedIds,
  })
  return {
    expectedCount: cmp.fullCount,
    boundedCount: cmp.boundedCount,
    intersectionCount: cmp.shared.length,
    expectedOnlyCount: cmp.fullOnly.length,
    boundedOnlyCount: cmp.boundedOnly.length,
    equal: cmp.fullOnly.length === 0 && cmp.boundedOnly.length === 0,
    sampleExpectedOnlyIds: sampleIds(cmp.fullOnly),
    sampleBoundedOnlyIds: sampleIds(cmp.boundedOnly),
  }
}

/** Owner escape: full → filter ownerUid + unresolved + createdAt desc limit 20. */
export function expectedOwnerEscapeIds(
  fullReports: ReadonlyArray<ReportLike>,
  ownerUid: string,
  limit = OWNER_UNRESOLVED_LIMIT
): string[] {
  const uid = ownerUid.trim()
  if (!uid) return []
  return fullReports
    .filter(
      (r) =>
        r.resolved !== true &&
        typeof r.ownerUid === "string" &&
        r.ownerUid === uid
    )
    .slice()
    .sort((a, b) => {
      const ca =
        typeof a.createdAt === "number" ? a.createdAt : Number(a.createdAt) || 0
      const cb =
        typeof b.createdAt === "number" ? b.createdAt : Number(b.createdAt) || 0
      return cb - ca
    })
    .slice(0, limit)
    .map((r) => String(r.id))
    .filter(Boolean)
}

export function estimateBoundedReadCost(options: {
  fullInitialDocs: number
  viewportDocs: number
  riderDocs: number
  ownerDocs?: number
  getDocCount?: number
}): ReadCostEstimate {
  const ownerMax = Math.min(
    options.ownerDocs ?? OWNER_UNRESOLVED_LIMIT,
    OWNER_UNRESOLVED_LIMIT
  )
  const occasionalGetDoc = options.getDocCount ?? 0
  // Unique estimate: assume ~30% overlap between viewport and rider
  const overlap = Math.min(
    options.viewportDocs,
    options.riderDocs,
    Math.floor((options.viewportDocs + options.riderDocs) * 0.15)
  )
  const boundedUniqueEstimate =
    options.viewportDocs + options.riderDocs - overlap + ownerMax + occasionalGetDoc
  const full = Math.max(0, options.fullInitialDocs)
  const reductionPct =
    full <= 0
      ? 0
      : Math.round(
          ((full - Math.min(boundedUniqueEstimate, full)) / full) * 1000
        ) / 10
  return {
    fullInitialDocs: full,
    boundedViewportDocs: options.viewportDocs,
    boundedRiderDocs: options.riderDocs,
    ownerMax,
    occasionalGetDoc,
    boundedUniqueEstimate,
    reductionPct,
  }
}

/** Stolen canary strategy recommendation (documentation constant). */
export const STOLEN_BOUNDED_CANARY_RECOMMENDATION = {
  choice: "A" as const,
  strategy: "separate_legacy_stolen_listener",
  note:
    "Keep a small family-scoped stolen listener (or full stolen subset) during canary so Lebanon-wide stolen is never silently dropped by 15 km / viewport geo. Dedicated broader stolen geohash query is a later task.",
}
