/**
 * Transition detectors for remaining owner↔helper lifecycle notifications.
 */

import {
  asNonEmptyString,
  isNotifiableReportFamily,
  isResolved,
  isTruthyComing,
  reportFamilyOf,
  type ReportSnapshot,
} from "../shared/report"

/**
 * Accepted helper cleared → report open again for another helper.
 */
export function isHelperCancelledTransition(
  before: ReportSnapshot | null | undefined,
  after: ReportSnapshot | null | undefined
): boolean {
  if (!before || !after) return false
  if (!isNotifiableReportFamily(reportFamilyOf(after, before))) return false
  if (isResolved(before.resolved) || isResolved(after.resolved)) return false

  const beforeHelperUid = asNonEmptyString(before.helperUid)
  if (!beforeHelperUid) return false
  if (!isTruthyComing(before.helperComing)) return false

  const afterHelperUid = asNonEmptyString(after.helperUid)
  if (afterHelperUid) return false
  if (after.helperComing !== false) return false

  const ownerUid =
    asNonEmptyString(after.ownerUid) || asNonEmptyString(before.ownerUid)
  if (!ownerUid) return false
  if (ownerUid === beforeHelperUid) return false

  return true
}

export function buildHelperCancelledEventKey(
  reportId: string,
  before: ReportSnapshot
): string {
  const helperAcceptedAt = before.helperAcceptedAt
  const suffix =
    typeof helperAcceptedAt === "number" && Number.isFinite(helperAcceptedAt)
      ? String(helperAcceptedAt)
      : asNonEmptyString(before.helperUid) || "unknown"
  return `helper_cancelled:${reportId}:${suffix}`
}

/**
 * Owner marks an accepted active request as resolved.
 */
export function isOwnerResolvedTransition(
  before: ReportSnapshot | null | undefined,
  after: ReportSnapshot | null | undefined
): boolean {
  if (!before || !after) return false
  if (!isNotifiableReportFamily(reportFamilyOf(before, after))) return false
  if (isResolved(before.resolved)) return false
  if (!isResolved(after.resolved)) return false

  const helperUid = asNonEmptyString(before.helperUid)
  if (!helperUid) return false
  if (!isTruthyComing(before.helperComing)) return false

  const ownerUid =
    asNonEmptyString(before.ownerUid) || asNonEmptyString(after.ownerUid)
  if (!ownerUid) return false
  if (ownerUid === helperUid) return false

  return true
}

export function buildOwnerResolvedEventKey(reportId: string): string {
  return `owner_resolved:${reportId}`
}

/**
 * Owner deleted an accepted active (unresolved) assistance/sharedRide report.
 */
export function isOwnerCancelledTransition(
  before: ReportSnapshot | null | undefined
): boolean {
  if (!before) return false
  if (!isNotifiableReportFamily(before.reportFamily)) return false
  if (isResolved(before.resolved)) return false

  const helperUid = asNonEmptyString(before.helperUid)
  if (!helperUid) return false
  if (!isTruthyComing(before.helperComing)) return false

  const ownerUid = asNonEmptyString(before.ownerUid)
  if (!ownerUid) return false
  if (ownerUid === helperUid) return false

  return true
}

export function buildOwnerCancelledEventKey(reportId: string): string {
  return `owner_cancelled:${reportId}`
}

export function recipientForHelperCancelled(
  before: ReportSnapshot,
  after: ReportSnapshot
): string {
  return asNonEmptyString(after.ownerUid) || asNonEmptyString(before.ownerUid)
}

export function recipientForOwnerResolved(before: ReportSnapshot): string {
  return asNonEmptyString(before.helperUid)
}

export function recipientForOwnerCancelled(before: ReportSnapshot): string {
  return asNonEmptyString(before.helperUid)
}
