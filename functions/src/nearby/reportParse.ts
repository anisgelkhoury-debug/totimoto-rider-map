/**
 * Parse report create snapshot fields for nearby evaluation (pure).
 */

export type NearbyReportCreateSnapshot = {
  reportId: string
  ownerUid: string
  reportCategory: string
  reportFamily: string | null
  resolved: boolean
  lat: number
  lng: number
  createdAtMs: number
  confirmationPresentCount: number
  confirmationGoneCount: number
  likelyGoneSince: unknown
}

function parseCreatedAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value < 1e12) return Math.floor(value * 1000)
    return Math.floor(value)
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    try {
      const ms = (value as { toMillis: () => number }).toMillis()
      return Number.isFinite(ms) ? ms : null
    } catch {
      return null
    }
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return Math.floor((value as { seconds: number }).seconds * 1000)
  }
  return null
}

function parseCoord(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

export function parseNearbyReportCreate(
  reportId: string,
  data: Record<string, unknown> | null | undefined
): NearbyReportCreateSnapshot | null {
  if (!data) return null
  const id = String(reportId || "").trim()
  if (!id) return null

  const lat = parseCoord(data.lat)
  const lng = parseCoord(data.lng)
  if (lat == null || lng == null) return null
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null

  const category =
    typeof data.reportCategory === "string" ? data.reportCategory.trim() : ""
  if (!category) return null

  const createdAtMs = parseCreatedAtMs(data.createdAt)
  if (createdAtMs == null) return null

  const ownerUid =
    typeof data.ownerUid === "string" ? data.ownerUid.trim() : ""

  const present =
    typeof data.confirmationPresentCount === "number" &&
    Number.isFinite(data.confirmationPresentCount)
      ? data.confirmationPresentCount
      : 0
  const gone =
    typeof data.confirmationGoneCount === "number" &&
    Number.isFinite(data.confirmationGoneCount)
      ? data.confirmationGoneCount
      : 0

  return {
    reportId: id,
    ownerUid,
    reportCategory: category,
    reportFamily:
      typeof data.reportFamily === "string" ? data.reportFamily : null,
    resolved: data.resolved === true,
    lat,
    lng,
    createdAtMs,
    confirmationPresentCount: present,
    confirmationGoneCount: gone,
    likelyGoneSince: data.likelyGoneSince ?? null,
  }
}
