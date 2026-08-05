/**
 * Pure geo filter / sort helpers for the reports list (no React).
 */

import { distanceKm } from "./reportsRenderStability.ts"

export type LatLngTuple = [number, number]

export type ListReport = {
  id?: string | number
  type?: string
  area?: string
  city?: string
  street?: string
  locationName?: string
  lat?: number
  lng?: number
  priority?: string
  createdAt?: number
  resolved?: boolean
  reportFamily?: string
  ownerId?: string
}

const PRIORITY_ORDER: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export function reportAreaText(report: ListReport): string {
  return `${report.area || ""} ${report.city || ""} ${report.street || ""} ${report.locationName || ""}`
}

/** Regional / near-me geo filters used by the reports page. */
export function matchesGeoFilter(
  report: ListReport,
  geoFilter: string,
  myLocation: LatLngTuple | null,
  nearKm = 25
): boolean {
  if (geoFilter === "all") return true

  if (geoFilter === "near") {
    if (!myLocation || report.lat == null || report.lng == null) return false
    const km = distanceKm(myLocation[0], myLocation[1], report.lat, report.lng)
    return km <= nearKm
  }

  const area = reportAreaText(report)

  if (geoFilter === "beirut") return area.includes("بيروت")

  if (geoFilter === "mount") {
    return (
      area.includes("بعبدا") ||
      area.includes("المتن") ||
      area.includes("كسروان") ||
      area.includes("عاليه") ||
      area.includes("الشوف") ||
      area.includes("جبل لبنان")
    )
  }

  if (geoFilter === "north") {
    return (
      area.includes("طرابلس") ||
      area.includes("عكار") ||
      area.includes("زغرتا") ||
      area.includes("الكورة") ||
      area.includes("البترون") ||
      area.includes("بشري") ||
      area.includes("الشمال")
    )
  }

  if (geoFilter === "bekaa") {
    return (
      area.includes("زحلة") ||
      area.includes("البقاع") ||
      area.includes("بعلبك") ||
      area.includes("الهرمل")
    )
  }

  if (geoFilter === "south") {
    return (
      area.includes("صيدا") ||
      area.includes("صور") ||
      area.includes("النبطية") ||
      area.includes("جزين") ||
      area.includes("الجنوب")
    )
  }

  return true
}

export function compareReportsForSort(
  a: ListReport,
  b: ListReport,
  sortFilter: string,
  myLocation: LatLngTuple | null
): number {
  if (sortFilter === "nearest" && myLocation) {
    const distanceA =
      a.lat != null && a.lng != null
        ? distanceKm(myLocation[0], myLocation[1], a.lat, a.lng)
        : 999999
    const distanceB =
      b.lat != null && b.lng != null
        ? distanceKm(myLocation[0], myLocation[1], b.lat, b.lng)
        : 999999
    return distanceA - distanceB
  }

  if (sortFilter === "important") {
    return (PRIORITY_ORDER[b.priority || ""] || 0) - (PRIORITY_ORDER[a.priority || ""] || 0)
  }

  return (b.createdAt || 0) - (a.createdAt || 0)
}

export function filterAndSortReports(
  reports: ListReport[],
  options: {
    geoFilter: string
    sortFilter: string
    myLocation: LatLngTuple | null
    nearKm?: number
  }
): ListReport[] {
  const { geoFilter, sortFilter, myLocation, nearKm = 25 } = options
  return reports
    .filter((r) => matchesGeoFilter(r, geoFilter, myLocation, nearKm))
    .sort((a, b) => compareReportsForSort(a, b, sortFilter, myLocation))
}

export function countUnresolvedByFamily(reports: ListReport[]): {
  intelligence: number
  assistance: number
  sharedRide: number
  stolen: number
} {
  let intelligence = 0
  let assistance = 0
  let sharedRide = 0
  let stolen = 0
  for (const r of reports) {
    if (r.resolved) continue
    if (r.reportFamily === "intelligence") intelligence++
    else if (r.reportFamily === "assistance") assistance++
    else if (r.reportFamily === "sharedRide") sharedRide++
    else if (r.reportFamily === "stolen") stolen++
  }
  return { intelligence, assistance, sharedRide, stolen }
}
