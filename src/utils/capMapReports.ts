/**
 * Cap map markers while preserving critical reports by deterministic rank.
 *
 * Overflow policy when protected reports exceed `cap`:
 * Keep the highest-ranked reports only (tier → distance → recency → input index).
 * Selected and owned sit at the top of that order, so they are only dropped if
 * more than `cap` selected+owned alone exist (extremely unlikely).
 */

import { distanceMeters } from "./reportsRenderStability.ts"

export type CapMapReport = {
  id?: string | number
  ownerId?: string
  helperId?: string
  helperComing?: boolean
  resolved?: boolean
  reportFamily?: string
  reportCategory?: string
  type?: string
  priority?: string
  lat?: number
  lng?: number
  createdAt?: number
}

export type CapMapOptions = {
  cap: number
  deviceId: string
  selectedId?: string | number | null
  userLocation?: [number, number] | null
}

/** Lower number = higher priority. */
export const CAP_TIER = {
  selected: 1,
  owned: 2,
  currentHelper: 3,
  claimedAssistance: 4,
  unclaimedAssistance: 5,
  /** gunfire / explosionStrike */
  severeIncident: 6,
  stolen: 7,
  /** accident + checkpoint (high road intel) */
  seriousRoadIntel: 8,
  /** fire / collapseDanger */
  seriousIncident: 9,
  highIntel: 10,
  ordinaryIncident: 11,
  ordinary: 12,
} as const

export function isValidMapCoordinate(
  lat: unknown,
  lng: unknown
): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

function isStolen(report: CapMapReport): boolean {
  return (
    report.reportFamily === "stolen" ||
    (typeof report.type === "string" && report.type.includes("مسروقة"))
  )
}

function isAssistanceOrRide(report: CapMapReport): boolean {
  return (
    report.reportFamily === "assistance" ||
    report.reportFamily === "sharedRide"
  )
}

function isIncidentFamily(report: CapMapReport): boolean {
  return report.reportFamily === "incident"
}

function isSevereIncidentCategory(report: CapMapReport): boolean {
  return (
    report.reportCategory === "gunfire" ||
    report.reportCategory === "explosionStrike"
  )
}

function isSeriousIncidentCategory(report: CapMapReport): boolean {
  return (
    report.reportCategory === "fire" ||
    report.reportCategory === "collapseDanger"
  )
}

function isSeriousRoadIntel(report: CapMapReport): boolean {
  if (report.reportFamily !== "intelligence") return false
  return (
    report.reportCategory === "accident" ||
    report.reportCategory === "checkpoint" ||
    report.type === "حادث" ||
    report.type === "حاجز" ||
    report.priority === "high"
  )
}

export function reportCapTier(
  report: CapMapReport,
  options: Pick<CapMapOptions, "deviceId" | "selectedId">
): number {
  const { deviceId, selectedId } = options
  if (selectedId != null && String(report.id) === String(selectedId)) {
    return CAP_TIER.selected
  }
  if (report.ownerId === deviceId) {
    return CAP_TIER.owned
  }
  if (
    report.helperId === deviceId &&
    report.helperComing === true &&
    report.resolved !== true
  ) {
    return CAP_TIER.currentHelper
  }
  if (isAssistanceOrRide(report) && report.helperComing === true) {
    return CAP_TIER.claimedAssistance
  }
  if (isAssistanceOrRide(report)) {
    return CAP_TIER.unclaimedAssistance
  }
  if (isIncidentFamily(report) && isSevereIncidentCategory(report)) {
    return CAP_TIER.severeIncident
  }
  if (isStolen(report)) {
    return CAP_TIER.stolen
  }
  if (isSeriousRoadIntel(report)) {
    return CAP_TIER.seriousRoadIntel
  }
  if (isIncidentFamily(report) && isSeriousIncidentCategory(report)) {
    return CAP_TIER.seriousIncident
  }
  if (
    report.reportFamily === "intelligence" &&
    (report.priority === "high" ||
      report.reportCategory === "checkpoint" ||
      report.type === "حاجز")
  ) {
    return CAP_TIER.highIntel
  }
  if (isIncidentFamily(report)) {
    return CAP_TIER.ordinaryIncident
  }
  return CAP_TIER.ordinary
}

function distanceOrInfinity(
  report: CapMapReport,
  userLocation: [number, number] | null | undefined
): number {
  if (
    !userLocation ||
    !isValidMapCoordinate(userLocation[0], userLocation[1]) ||
    !isValidMapCoordinate(report.lat, report.lng)
  ) {
    return Number.POSITIVE_INFINITY
  }
  return distanceMeters(
    userLocation[0],
    userLocation[1],
    report.lat as number,
    report.lng as number
  )
}

export function capMapReports<T extends CapMapReport>(
  reports: T[],
  options: CapMapOptions
): T[] {
  const { cap, deviceId, selectedId, userLocation = null } = options
  if (!Array.isArray(reports) || reports.length === 0) return reports
  if (reports.length <= cap) return reports

  const ranked = reports
    .map((report, inputIndex) => ({
      report,
      inputIndex,
      tier: reportCapTier(report, { deviceId, selectedId }),
      distance: distanceOrInfinity(report, userLocation),
      createdAt:
        typeof report.createdAt === "number" && Number.isFinite(report.createdAt)
          ? report.createdAt
          : 0,
    }))
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      if (a.distance !== b.distance) return a.distance - b.distance
      if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
      return a.inputIndex - b.inputIndex
    })

  const out: T[] = []
  const seen = new Set<string>()
  for (const item of ranked) {
    if (out.length >= cap) break
    const id =
      item.report.id != null
        ? String(item.report.id)
        : `__idx_${item.inputIndex}`
    if (seen.has(id)) continue
    seen.add(id)
    out.push(item.report)
  }
  return out
}
