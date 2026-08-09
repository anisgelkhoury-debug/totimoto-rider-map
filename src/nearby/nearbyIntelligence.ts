/**
 * Nearby Rider Intelligence — pure ranking over already-loaded live reports.
 *
 * V1:
 * - No extra Firestore reads
 * - No GPS writes
 * - No confirmation/trust queries (soft-hide uses parent aggregates already on the report)
 * - Radius filter → severity → distance → freshness
 */

import { isIncidentReport } from "../utils/incidentTypes.ts"
import { isRoadIntelligenceReport } from "../utils/roadIntelligenceTypes.ts"
import { isReportExpired } from "../utils/reportSnapshot.ts"
import { distanceKm, distanceMeters } from "../utils/reportsRenderStability.ts"
import {
  resolveFreshnessState,
  freshnessLabelForState,
  type FreshnessState,
} from "../reportConfirmations/reportTrust.ts"
import { isExcludedFromNearbyByLifecycle } from "../reportLifecycle/reportLifecycle.ts"
import {
  NEARBY_COPY,
  NEARBY_MAX_RESULTS,
  nearbyRadiusKmForCategory,
  nearbySeverityBand,
} from "./nearbyConfig.ts"

export type NearbyReportLike = {
  id?: string | number
  type?: string
  emoji?: string
  lat?: unknown
  lng?: unknown
  createdAt?: unknown
  expiry?: unknown
  resolved?: unknown
  reportFamily?: string
  reportCategory?: string
  priority?: string
  confirmationPresentCount?: unknown
  confirmationGoneCount?: unknown
  likelyGoneSince?: unknown
}

export type NearbyRiderLocation = {
  lat: number
  lng: number
}

export type NearbyCandidate = {
  id: string
  report: NearbyReportLike
  distanceMeters: number
  distanceKm: number
  severityBand: number
  freshness: FreshnessState | null
  freshnessLabel: string | null
  category: string
}

/** Arabic compact distance for nearby rows/chip context. */
export function formatNearbyDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return "—"
  if (meters < 1000) {
    return `${Math.round(meters)} م`
  }
  const km = meters / 1000
  const rounded = km < 10 ? km.toFixed(1) : Math.round(km).toString()
  return `${rounded} كم`
}

export function nearbyCreatesNotificationPath(): boolean {
  return false
}

export function nearbyRequiresConfirmationQueries(): boolean {
  return false
}

/**
 * Situational intelligence only — not assistance / sharedRide / stolen /
 * marketplace / weather.
 */
export function isNearbyEligibleReport(
  report: NearbyReportLike | null | undefined
): boolean {
  if (!report) return false
  if (report.reportFamily === "assistance") return false
  if (report.reportFamily === "sharedRide") return false
  if (report.reportFamily === "stolen") return false
  if (typeof report.type === "string" && report.type.includes("مسروقة")) {
    return false
  }
  return isRoadIntelligenceReport(report) || isIncidentReport(report)
}

function resolveCategory(report: NearbyReportLike): string | null {
  if (
    typeof report.reportCategory === "string" &&
    report.reportCategory.trim()
  ) {
    return report.reportCategory.trim()
  }
  // Fallback from Arabic type labels when category missing on legacy docs
  const t = report.type
  if (t === "زحمة") return "traffic"
  if (t === "حادث") return "accident"
  if (t === "طريق زلق") return "slippery_road"
  if (t === "طريق مسكر") return "road_closed"
  if (t === "حاجز") return "checkpoint"
  if (t === "حريق") return "fire"
  if (t === "إطلاق نار") return "gunfire"
  if (t === "انفجار / غارة") return "explosionStrike"
  if (t === "انهيار / خطر كبير") return "collapseDanger"
  if (t === "أخرى" && report.reportFamily === "incident") return "otherIncident"
  return null
}

function finiteCoord(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function getNearbyReportCandidates(options: {
  reports: ReadonlyArray<NearbyReportLike>
  rider: NearbyRiderLocation | null | undefined
  now?: number
  maxResults?: number
}): NearbyCandidate[] {
  const { reports, rider } = options
  const now = options.now ?? Date.now()
  const maxResults = options.maxResults ?? NEARBY_MAX_RESULTS

  if (
    !rider ||
    !Number.isFinite(rider.lat) ||
    !Number.isFinite(rider.lng)
  ) {
    return []
  }

  const candidates: NearbyCandidate[] = []

  for (const report of reports) {
    if (!isNearbyEligibleReport(report)) continue
    if (report.resolved === true) continue
    if (isReportExpired(report, now)) continue
    // Task 056 — soft-hidden likely-gone excluded (aggregates on parent only).
    if (isExcludedFromNearbyByLifecycle(report, now)) continue

    const lat = finiteCoord(report.lat)
    const lng = finiteCoord(report.lng)
    if (lat == null || lng == null) continue

    const category = resolveCategory(report)
    const radiusKm = nearbyRadiusKmForCategory(category)
    if (radiusKm == null || category == null) continue

    const dMeters = distanceMeters(rider.lat, rider.lng, lat, lng)
    const dKm = dMeters / 1000
    if (dKm > radiusKm) continue

    const id =
      report.id != null && String(report.id) !== ""
        ? String(report.id)
        : ""
    if (!id) continue

    const freshness = resolveFreshnessState({
      createdAt: report.createdAt,
      expiry: report.expiry,
      now,
    })

    candidates.push({
      id,
      report,
      distanceMeters: dMeters,
      distanceKm: dKm,
      severityBand: nearbySeverityBand(category),
      freshness,
      freshnessLabel: freshnessLabelForState(freshness),
      category,
    })
  }

  return rankNearbyReports(candidates).slice(0, maxResults)
}

/**
 * Deterministic ranking:
 * 1. severityBand ascending (severe first)
 * 2. distanceMeters ascending
 * 3. fresher first (lower age ratio via freshness ordinal)
 * 4. id ascending (stable)
 *
 * Trust ranking still does NOT load confirmation subcollections (aggregates only).
 */
export function rankNearbyReports(
  candidates: ReadonlyArray<NearbyCandidate>
): NearbyCandidate[] {
  const freshnessRank = (f: FreshnessState | null): number => {
    if (f === "veryFresh") return 0
    if (f === "fresh") return 1
    if (f === "aging") return 2
    if (f === "expiringSoon") return 3
    return 4
  }

  return [...candidates].sort((a, b) => {
    if (a.severityBand !== b.severityBand) {
      return a.severityBand - b.severityBand
    }
    if (a.distanceMeters !== b.distanceMeters) {
      return a.distanceMeters - b.distanceMeters
    }
    const fa = freshnessRank(a.freshness)
    const fb = freshnessRank(b.freshness)
    if (fa !== fb) return fa - fb
    return a.id.localeCompare(b.id)
  })
}

export function formatNearbyChipLabel(count: number): string {
  if (count <= 0) return ""
  if (count === 1) return NEARBY_COPY.chipSingular
  return NEARBY_COPY.chipPlural(count)
}

/** Re-export tested distance helpers for nearby module consumers/tests. */
export { distanceKm, distanceMeters }
