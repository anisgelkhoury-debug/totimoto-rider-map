/**
 * Duplicate Report Intelligence — pure matching over already-loaded reports.
 * Zero Firestore reads. Exact reportCategory only. No AI / NLP.
 */

import { isIncidentReport } from "../utils/incidentTypes.ts"
import { isRoadIntelligenceReport } from "../utils/roadIntelligenceTypes.ts"
import {
  isReportExpired,
  normalizeReportCreatedAt,
} from "../utils/reportSnapshot.ts"
import { distanceMeters } from "../utils/reportsRenderStability.ts"
import {
  freshnessLabelForState,
  resolveFreshnessState,
  type FreshnessState,
} from "../reportConfirmations/reportTrust.ts"
import {
  DUPLICATE_MAX_AGE_RATIO,
  duplicateDistanceMetersForCategory,
} from "./duplicateConfig.ts"
import { formatNearbyDistance } from "../nearby/nearbyIntelligence.ts"

export type DuplicateReportLike = {
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
  ownerUid?: string
  ownerId?: string
}

export type DuplicateMatch = {
  id: string
  report: DuplicateReportLike
  category: string
  distanceMeters: number
  freshness: FreshnessState | null
  freshnessLabel: string | null
  distanceLabel: string
}

export function duplicateDetectionAddsFirestoreReads(): boolean {
  return false
}

export function duplicateRequiresConfirmationQueries(): boolean {
  return false
}

export function isDuplicateEligibleCreateType(type: {
  reportFamily?: string
  reportCategory?: string
  type?: string
  label?: string
} | null | undefined): boolean {
  if (!type) return false
  const family = type.reportFamily
  if (family === "assistance" || family === "sharedRide" || family === "stolen") {
    return false
  }
  const category =
    typeof type.reportCategory === "string" ? type.reportCategory.trim() : ""
  if (!category) return false
  // Road + incident catalogs only
  const probe = {
    reportFamily: family,
    reportCategory: category,
    type: type.label || type.type,
  }
  return isRoadIntelligenceReport(probe) || isIncidentReport(probe)
}

export function isDuplicateEligibleLiveReport(
  report: DuplicateReportLike | null | undefined
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

function resolveCategory(report: DuplicateReportLike): string | null {
  if (
    typeof report.reportCategory === "string" &&
    report.reportCategory.trim()
  ) {
    return report.reportCategory.trim()
  }
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

/**
 * Within first DUPLICATE_MAX_AGE_RATIO of TTL (and still live / not expired).
 */
export function isWithinDuplicateFreshnessWindow(
  report: DuplicateReportLike,
  now = Date.now()
): boolean {
  if (report.resolved === true) return false
  if (isReportExpired(report, now)) return false
  const createdAt = normalizeReportCreatedAt(report.createdAt)
  const expiry =
    typeof report.expiry === "number" &&
    Number.isFinite(report.expiry) &&
    report.expiry > 0
      ? report.expiry
      : null
  if (createdAt == null || expiry == null) return false
  const ageMinutes = Math.max(0, (now - createdAt) / 1000 / 60)
  return ageMinutes / expiry <= DUPLICATE_MAX_AGE_RATIO
}

export function isReportOwnerForDuplicate(
  report: DuplicateReportLike,
  options: {
    currentUid?: string | null
    deviceId?: string | null
  }
): boolean {
  const uid =
    typeof options.currentUid === "string" ? options.currentUid.trim() : ""
  const ownerUid =
    typeof report.ownerUid === "string" ? report.ownerUid.trim() : ""
  if (uid && ownerUid && uid === ownerUid) return true
  const deviceId =
    typeof options.deviceId === "string" ? options.deviceId.trim() : ""
  const ownerId =
    typeof report.ownerId === "string" ? report.ownerId.trim() : ""
  if (deviceId && ownerId && deviceId === ownerId) return true
  return false
}

/**
 * Find at most one likely duplicate for an intended create.
 * Exact same reportCategory + within category distance + freshness window.
 */
export function findLikelyDuplicateReport(options: {
  reports: ReadonlyArray<DuplicateReportLike>
  createCategory: string
  createLat: number
  createLng: number
  now?: number
}): DuplicateMatch | null {
  const { reports, createCategory, createLat, createLng } = options
  const now = options.now ?? Date.now()

  if (
    !createCategory ||
    !Number.isFinite(createLat) ||
    !Number.isFinite(createLng)
  ) {
    return null
  }

  const maxMeters = duplicateDistanceMetersForCategory(createCategory)
  if (maxMeters == null) return null

  const candidates: DuplicateMatch[] = []

  for (const report of reports) {
    if (!isDuplicateEligibleLiveReport(report)) continue
    if (!isWithinDuplicateFreshnessWindow(report, now)) continue

    const category = resolveCategory(report)
    if (category !== createCategory) continue

    const lat = finiteCoord(report.lat)
    const lng = finiteCoord(report.lng)
    if (lat == null || lng == null) continue

    const id =
      report.id != null && String(report.id) !== "" ? String(report.id) : ""
    if (!id) continue

    const d = distanceMeters(createLat, createLng, lat, lng)
    if (d > maxMeters) continue

    const freshness = resolveFreshnessState({
      createdAt: report.createdAt,
      expiry: report.expiry,
      now,
    })

    candidates.push({
      id,
      report,
      category,
      distanceMeters: d,
      freshness,
      freshnessLabel: freshnessLabelForState(freshness),
      distanceLabel: formatNearbyDistance(d),
    })
  }

  if (candidates.length === 0) return null
  return rankDuplicateCandidates(candidates)[0] ?? null
}

/** closest → fresher → id */
export function rankDuplicateCandidates(
  candidates: ReadonlyArray<DuplicateMatch>
): DuplicateMatch[] {
  const freshnessRank = (f: FreshnessState | null): number => {
    if (f === "veryFresh") return 0
    if (f === "fresh") return 1
    if (f === "aging") return 2
    if (f === "expiringSoon") return 3
    return 4
  }

  return [...candidates].sort((a, b) => {
    if (a.distanceMeters !== b.distanceMeters) {
      return a.distanceMeters - b.distanceMeters
    }
    const fa = freshnessRank(a.freshness)
    const fb = freshnessRank(b.freshness)
    if (fa !== fb) return fa - fb
    return a.id.localeCompare(b.id)
  })
}
