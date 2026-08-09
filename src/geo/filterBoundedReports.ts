/**
 * Client-side filters for bounded geo results.
 * Reuses reportSnapshot expiry + lifecycle soft-hide.
 */

import {
  isReportExpired,
  normalizeReportCreatedAt,
} from "../utils/reportSnapshot.ts"
import { isValidGeoCoordinate } from "./coordinates.ts"
import {
  isReportSoftHiddenByLifecycle,
  shouldShowReportByLifecycle,
  type LifecycleReportLike,
} from "../reportLifecycle/reportLifecycle.ts"
import { distanceMeters } from "../utils/reportsRenderStability.ts"

export type BoundedFilterableReport = LifecycleReportLike & {
  lat?: unknown
  lng?: unknown
  expiresAt?: unknown
  geohash?: unknown
}

/**
 * Prefer expiresAt Timestamp/ms when present; else legacy expiry minutes.
 */
export function isReportExpiredForBounded(
  report: BoundedFilterableReport,
  now = Date.now()
): boolean {
  if (report.resolved === true) return true
  const expiresAtMs = normalizeReportCreatedAt(report.expiresAt)
  if (expiresAtMs != null) {
    return now >= expiresAtMs
  }
  return isReportExpired(report, now)
}

export function filterBoundedLiveReports<T extends BoundedFilterableReport>(
  reports: ReadonlyArray<T>,
  options: {
    now?: number
    centerLat?: number
    centerLng?: number
    maxDistanceMeters?: number
    selectedReportId?: string | null
    viewerDeviceId?: string | null
    viewerUid?: string | null
    requireGeohash?: boolean
  } = {}
): T[] {
  const now = options.now ?? Date.now()
  const out: T[] = []

  for (const report of reports) {
    if (!isValidGeoCoordinate(report.lat, report.lng)) continue
    if (report.resolved === true) continue
    if (isReportExpiredForBounded(report, now)) continue

    if (options.requireGeohash) {
      const gh =
        typeof report.geohash === "string" ? report.geohash.trim() : ""
      if (!gh) continue
    }

    if (
      options.maxDistanceMeters != null &&
      options.centerLat != null &&
      options.centerLng != null &&
      isValidGeoCoordinate(options.centerLat, options.centerLng)
    ) {
      const d = distanceMeters(
        options.centerLat,
        options.centerLng,
        report.lat as number,
        report.lng as number
      )
      if (d > options.maxDistanceMeters) continue
    }

    if (
      !shouldShowReportByLifecycle(report, {
        now,
        selectedReportId: options.selectedReportId,
        viewerDeviceId: options.viewerDeviceId,
        viewerUid: options.viewerUid,
      })
    ) {
      continue
    }

    out.push(report)
  }

  return out
}

export function countMissingGeohash(
  reports: ReadonlyArray<{ geohash?: unknown }>
): number {
  let n = 0
  for (const r of reports) {
    if (typeof r.geohash !== "string" || !r.geohash.trim()) n += 1
  }
  return n
}

export { isReportSoftHiddenByLifecycle }
