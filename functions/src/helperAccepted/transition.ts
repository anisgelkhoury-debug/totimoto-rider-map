/**
 * Report snapshot fields used by helper-accepted notifications.
 * Re-exports shared helpers; keeps helper-accepted-specific transition logic here.
 */

export type { ReportSnapshot } from "../shared/report"
export {
  asNonEmptyString,
  isTruthyComing,
  isResolved,
  isNotifiableReportFamily,
} from "../shared/report"

import {
  asNonEmptyString,
  isNotifiableReportFamily,
  isResolved,
  isTruthyComing,
  type ReportSnapshot,
} from "../shared/report"

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
