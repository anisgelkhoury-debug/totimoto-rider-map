/**
 * Normalize / expire helpers for live Firestore report snapshots.
 * Keeps client UI from reintroducing documents the local expiry filter already hid.
 */

export type ExpirableReport = {
  id?: string | number
  createdAt?: unknown
  expiry?: unknown
  resolved?: unknown
  type?: unknown
  label?: unknown
  reportFamily?: unknown
  reportCategory?: unknown
}

/** Convert Firestore Timestamp | seconds | ms into epoch milliseconds. */
export function normalizeReportCreatedAt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: values below 1e12 are unix seconds.
    return value < 1e12 ? value * 1000 : value
  }
  if (value && typeof value === "object") {
    const v = value as {
      toMillis?: () => number
      seconds?: number
      nanoseconds?: number
    }
    if (typeof v.toMillis === "function") {
      const ms = v.toMillis()
      return Number.isFinite(ms) ? ms : null
    }
    if (typeof v.seconds === "number" && Number.isFinite(v.seconds)) {
      const nanos = typeof v.nanoseconds === "number" ? v.nanoseconds : 0
      return v.seconds * 1000 + Math.floor(nanos / 1e6)
    }
  }
  return null
}

export function isReportExpired(
  report: ExpirableReport,
  now = Date.now()
): boolean {
  if (report.resolved === true) return true
  const createdAt = normalizeReportCreatedAt(report.createdAt)
  if (createdAt == null) return false
  const expiry =
    typeof report.expiry === "number" && Number.isFinite(report.expiry)
      ? report.expiry
      : null
  if (expiry == null) return false
  const minutesPassed = (now - createdAt) / 1000 / 60
  return minutesPassed >= expiry
}

/** Stable React/list identity: prefer Firestore document id. */
export function reportRenderKey(
  report: ExpirableReport,
  index = 0
): string {
  if (report.id != null && String(report.id) !== "") {
    return `report-${String(report.id)}`
  }
  return `report-fallback-${index}`
}

/**
 * Map snapshot docs → UI reports:
 * - force id from document id
 * - normalize createdAt to ms
 * - drop expired / resolved
 * - dedupe by String(id) (first wins)
 */
export function normalizeLiveReports<T extends ExpirableReport>(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>,
  now = Date.now()
): Array<T & { id: string; createdAt: number | null }> {
  const seen = new Set<string>()
  const out: Array<T & { id: string; createdAt: number | null }> = []

  for (const docSnap of docs) {
    const id = String(docSnap.id)
    if (seen.has(id)) continue
    seen.add(id)

    const raw = docSnap.data() || {}
    const createdAt = normalizeReportCreatedAt(raw.createdAt)
    const report = {
      ...(raw as T),
      id,
      createdAt,
    }

    if (isReportExpired(report, now)) continue
    out.push(report)
  }

  return out
}
