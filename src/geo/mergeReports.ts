/**
 * Merge / dedupe report-like records from overlapping geo query results.
 * Pure — no React state.
 */

export type GeoMergeableReport = {
  id?: string | number | null
  [key: string]: unknown
}

export type MergeGeoReportsOptions = {
  /** Viewport / rider / other geo result batches. */
  batches?: ReadonlyArray<ReadonlyArray<GeoMergeableReport>>
  /** Deep-link / selected forced docs (win over geo batches). */
  forced?: ReadonlyArray<GeoMergeableReport> | null
  /** Owner-management docs (win over geo batches; forced still wins). */
  owner?: ReadonlyArray<GeoMergeableReport> | null
}

function reportId(report: GeoMergeableReport | null | undefined): string | null {
  if (!report || report.id == null) return null
  const id = String(report.id).trim()
  return id.length > 0 ? id : null
}

/**
 * Deterministic merge by String(id).
 * Precedence: forced > owner > earlier batches > later batches.
 * First-seen within the same tier wins.
 */
export function mergeGeoReportSets(
  options: MergeGeoReportsOptions
): GeoMergeableReport[] {
  const byId = new Map<string, GeoMergeableReport>()

  const absorb = (
    list: ReadonlyArray<GeoMergeableReport> | null | undefined,
    overwrite: boolean
  ) => {
    if (!list) return
    for (const report of list) {
      const id = reportId(report)
      if (!id) continue
      if (overwrite || !byId.has(id)) {
        byId.set(id, report)
      }
    }
  }

  // Geo batches: first batch wins on conflict
  for (const batch of options.batches ?? []) {
    absorb(batch, false)
  }
  // Owner overlays geo
  absorb(options.owner, true)
  // Forced / selected always wins
  absorb(options.forced, true)

  return Array.from(byId.values())
}

/**
 * Legacy-safe read of geo metadata fields — never invents values.
 */
export function readLegacyGeoFields(report: {
  geohash?: unknown
  expiresAt?: unknown
  lat?: unknown
  lng?: unknown
} | null | undefined): {
  geohash: string | null
  expiresAt: number | null
  hasGeohash: boolean
  hasExpiresAt: boolean
} {
  if (!report) {
    return {
      geohash: null,
      expiresAt: null,
      hasGeohash: false,
      hasExpiresAt: false,
    }
  }

  const geohash =
    typeof report.geohash === "string" && report.geohash.trim().length > 0
      ? report.geohash.trim()
      : null
  const expiresAt =
    typeof report.expiresAt === "number" && Number.isFinite(report.expiresAt)
      ? report.expiresAt
      : null

  return {
    geohash,
    expiresAt,
    hasGeohash: geohash != null,
    hasExpiresAt: expiresAt != null,
  }
}
