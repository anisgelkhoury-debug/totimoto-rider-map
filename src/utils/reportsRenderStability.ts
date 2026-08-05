/**
 * Helpers to avoid needless React re-renders when report arrays are
 * rewritten with identical map-relevant content.
 */

/** Compact fingerprint of fields that affect map markers / list sync. */
export function reportMapFingerprint(report: Record<string, unknown>): string {
  return [
    report.id,
    report.lat,
    report.lng,
    report.resolved === true ? 1 : 0,
    report.reportFamily ?? "",
    report.type ?? "",
    report.emoji ?? "",
    report.color ?? "",
    report.priority ?? "",
    report.helperComing === true ? 1 : 0,
    report.helperLat ?? "",
    report.helperLng ?? "",
    report.helperLocationUpdatedAt ?? "",
    report.ownerId ?? "",
    report.ownerUid ?? "",
    report.helperId ?? "",
    report.helperUid ?? "",
    report.createdAt ?? "",
    report.expiry ?? "",
    report.moving === true ? 1 : 0,
    report.isHelper === true ? 1 : 0,
    report.targetLat ?? "",
    report.targetLng ?? "",
  ].join("|")
}

export function reportsMapFingerprint(reports: unknown[]): string {
  if (!Array.isArray(reports) || reports.length === 0) return ""
  return reports
    .map((r) => reportMapFingerprint((r ?? {}) as Record<string, unknown>))
    .join("\n")
}

/** Haversine distance in meters (shared with App GPS throttling). */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
