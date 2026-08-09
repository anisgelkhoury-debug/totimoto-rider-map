/**
 * Pure geo-metadata coverage audit over an in-memory report set.
 * No Firestore I/O. No document mutation. No PII fields.
 */

export type GeoCoverageFamily =
  | "intelligence"
  | "incident"
  | "assistance"
  | "sharedRide"
  | "stolen"
  | "other"

export type FamilyCoverage = {
  family: GeoCoverageFamily
  total: number
  withGeohash: number
  withoutGeohash: number
  withExpiresAt: number
  withoutExpiresAt: number
  withBoth: number
}

export type GeoMetadataCoverageReport = {
  total: number
  withGeohash: number
  withoutGeohash: number
  withExpiresAt: number
  withoutExpiresAt: number
  withBoth: number
  /** Short-lived families only (excludes stolen). */
  shortLivedTotal: number
  shortLivedWithBoth: number
  geohashPct: number
  expiresAtPct: number
  bothPct: number
  shortLivedBothPct: number
  byFamily: FamilyCoverage[]
}

export type CoverageLikeReport = {
  resolved?: unknown
  reportFamily?: unknown
  geohash?: unknown
  expiresAt?: unknown
  type?: unknown
}

function hasGeohash(report: CoverageLikeReport): boolean {
  return typeof report.geohash === "string" && report.geohash.trim().length > 0
}

function hasExpiresAt(report: CoverageLikeReport): boolean {
  if (report.expiresAt == null) return false
  if (typeof report.expiresAt === "number") return Number.isFinite(report.expiresAt)
  if (typeof report.expiresAt === "object") return true
  return false
}

function resolveFamily(report: CoverageLikeReport): GeoCoverageFamily {
  const f = report.reportFamily
  if (f === "intelligence") return "intelligence"
  if (f === "incident") return "incident"
  if (f === "assistance") return "assistance"
  if (f === "sharedRide") return "sharedRide"
  if (f === "stolen") return "stolen"
  if (typeof report.type === "string" && report.type.includes("مسروقة")) {
    return "stolen"
  }
  return "other"
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 100
  return Math.round((part / whole) * 1000) / 10
}

/**
 * Audit unresolved (or provided) reports for geo dual-write coverage.
 * Pass already-filtered live reports from a full listener snapshot.
 */
export function auditGeoMetadataCoverage(
  reports: ReadonlyArray<CoverageLikeReport>,
  options: { includeResolved?: boolean } = {}
): GeoMetadataCoverageReport {
  const list = options.includeResolved
    ? reports
    : reports.filter((r) => r.resolved !== true)

  const families: GeoCoverageFamily[] = [
    "intelligence",
    "incident",
    "assistance",
    "sharedRide",
    "stolen",
    "other",
  ]
  const buckets = new Map<GeoCoverageFamily, FamilyCoverage>()
  for (const family of families) {
    buckets.set(family, {
      family,
      total: 0,
      withGeohash: 0,
      withoutGeohash: 0,
      withExpiresAt: 0,
      withoutExpiresAt: 0,
      withBoth: 0,
    })
  }

  let withGeohash = 0
  let withExpiresAt = 0
  let withBoth = 0
  let shortLivedTotal = 0
  let shortLivedWithBoth = 0

  for (const report of list) {
    const family = resolveFamily(report)
    const bucket = buckets.get(family)!
    bucket.total += 1
    const gh = hasGeohash(report)
    const ex = hasExpiresAt(report)
    if (gh) {
      withGeohash += 1
      bucket.withGeohash += 1
    } else {
      bucket.withoutGeohash += 1
    }
    if (ex) {
      withExpiresAt += 1
      bucket.withExpiresAt += 1
    } else {
      bucket.withoutExpiresAt += 1
    }
    if (gh && ex) {
      withBoth += 1
      bucket.withBoth += 1
    }
    if (family !== "stolen") {
      shortLivedTotal += 1
      if (gh && ex) shortLivedWithBoth += 1
    }
  }

  const total = list.length
  return {
    total,
    withGeohash,
    withoutGeohash: total - withGeohash,
    withExpiresAt,
    withoutExpiresAt: total - withExpiresAt,
    withBoth,
    shortLivedTotal,
    shortLivedWithBoth,
    geohashPct: pct(withGeohash, total),
    expiresAtPct: pct(withExpiresAt, total),
    bothPct: pct(withBoth, total),
    shortLivedBothPct: pct(shortLivedWithBoth, shortLivedTotal),
    byFamily: families.map((f) => buckets.get(f)!),
  }
}

/** Recommended canary gate for short-lived families (stolen separate). */
export const SHORT_LIVED_GEO_COVERAGE_CANARY_PCT = 95

export function meetsShortLivedGeoCoverageGate(
  coverage: GeoMetadataCoverageReport,
  thresholdPct = SHORT_LIVED_GEO_COVERAGE_CANARY_PCT
): boolean {
  return coverage.shortLivedBothPct >= thresholdPct
}
