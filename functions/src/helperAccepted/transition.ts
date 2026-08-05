/**
 * Report snapshot fields used by helper-accepted notifications.
 * Keep this free of Admin/Firestore SDK imports for unit testing.
 */

export type ReportFamily =
  | "assistance"
  | "sharedRide"
  | "intelligence"
  | "stolen"
  | string

export type ReportSnapshot = {
  ownerUid?: unknown
  helperUid?: unknown
  helperComing?: unknown
  helperAcceptedAt?: unknown
  resolved?: unknown
  reportFamily?: unknown
}

export function asNonEmptyString(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim()
}

export function isTruthyComing(value: unknown): boolean {
  return value === true
}

export function isResolved(value: unknown): boolean {
  return value === true
}

export function isNotifiableReportFamily(family: unknown): boolean {
  return family === "assistance" || family === "sharedRide"
}

/**
 * True only for unclaimed → claimed helper-accept transitions.
 */
export function isHelperAcceptedTransition(
  before: ReportSnapshot | null | undefined,
  after: ReportSnapshot | null | undefined
): boolean {
  if (!before || !after) return false
  if (!isNotifiableReportFamily(after.reportFamily)) return false
  if (isResolved(after.resolved)) return false

  const ownerUid = asNonEmptyString(after.ownerUid)
  const helperUid = asNonEmptyString(after.helperUid)
  if (!ownerUid || !helperUid) return false
  if (ownerUid === helperUid) return false
  if (!isTruthyComing(after.helperComing)) return false

  const beforeHelperUid = asNonEmptyString(before.helperUid)
  if (beforeHelperUid) return false
  if (isTruthyComing(before.helperComing)) return false

  return true
}

export function buildHelperAcceptedEventKey(
  reportId: string,
  after: ReportSnapshot
): string {
  const helperAcceptedAt = after.helperAcceptedAt
  const suffix =
    typeof helperAcceptedAt === "number" && Number.isFinite(helperAcceptedAt)
      ? String(helperAcceptedAt)
      : asNonEmptyString(after.helperUid) || "unknown"
  return `helper_accepted:${reportId}:${suffix}`
}
