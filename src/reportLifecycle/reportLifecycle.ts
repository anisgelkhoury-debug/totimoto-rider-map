/**
 * Smart Report Lifecycle — soft-hide likely-gone reports after grace.
 *
 * Uses parent-report aggregates only (zero confirmation reads per marker).
 * Never deletes Firestore docs, never mutates resolvedAt/expiry, never N+1.
 */

import {
  isConfirmationEligibleReport,
  type ConfirmationCounts,
  type ConfirmationishReport,
} from "../reportConfirmations/reportConfirmations.ts"
import {
  resolveTrustState,
  TRUST_STATE,
} from "../reportConfirmations/reportTrust.ts"
import { normalizeReportCreatedAt } from "../utils/reportSnapshot.ts"
import {
  LIFECYCLE_AGGREGATE_FIELDS,
  LIFECYCLE_LIKELY_GONE_GRACE_MS,
} from "./lifecycleConfig.ts"

export type LifecycleReportLike = ConfirmationishReport & {
  confirmationPresentCount?: unknown
  confirmationGoneCount?: unknown
  confirmationUpdatedAt?: unknown
  likelyGoneSince?: unknown
  ownerId?: string
  deviceId?: string
  ownerUid?: string
  resolved?: unknown
  createdAt?: unknown
  expiry?: unknown
}

export type LifecycleVisibilityOptions = {
  now?: number
  /** Currently selected report — never soft-hide while viewing. */
  selectedReportId?: string | null
  /** Local device id — owner management context stays visible. */
  viewerDeviceId?: string | null
  /** Auth uid — alternate owner match when present. */
  viewerUid?: string | null
  graceMs?: number
}

function finiteNonNegInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const n = Math.floor(value)
  return n >= 0 ? n : null
}

/**
 * Read aggregate confirmation counts from the parent report document.
 * Missing / invalid → treated as zeros (safe: no soft-hide).
 */
export function confirmationCountsFromReportAggregates(
  report: LifecycleReportLike | null | undefined
): ConfirmationCounts {
  const presentCount =
    finiteNonNegInt(report?.[LIFECYCLE_AGGREGATE_FIELDS.presentCount]) ?? 0
  const goneCount =
    finiteNonNegInt(report?.[LIFECYCLE_AGGREGATE_FIELDS.goneCount]) ?? 0
  return {
    presentCount,
    goneCount,
    total: presentCount + goneCount,
  }
}

export function normalizeLikelyGoneSinceMs(value: unknown): number | null {
  return normalizeReportCreatedAt(value)
}

export function isLikelyGoneFromAggregates(
  report: LifecycleReportLike | null | undefined
): boolean {
  if (!isConfirmationEligibleReport(report)) return false
  return (
    resolveTrustState(confirmationCountsFromReportAggregates(report)) ===
    TRUST_STATE.likelyGone
  )
}

/**
 * Soft-hide = likely-gone by aggregates AND grace elapsed since likelyGoneSince.
 * Without likelyGoneSince (Function lag / legacy), never soft-hide.
 */
export function isReportSoftHiddenByLifecycle(
  report: LifecycleReportLike | null | undefined,
  now = Date.now(),
  graceMs = LIFECYCLE_LIKELY_GONE_GRACE_MS
): boolean {
  if (!report) return false
  if (!isConfirmationEligibleReport(report)) return false
  if (report.resolved === true) return false
  if (!isLikelyGoneFromAggregates(report)) return false

  const since = normalizeLikelyGoneSinceMs(
    report[LIFECYCLE_AGGREGATE_FIELDS.likelyGoneSince]
  )
  if (since == null) return false
  if (!(graceMs >= 0)) return false
  return now - since >= graceMs
}

function isOwnedByViewer(
  report: LifecycleReportLike,
  options: LifecycleVisibilityOptions
): boolean {
  const deviceId =
    typeof options.viewerDeviceId === "string"
      ? options.viewerDeviceId.trim()
      : ""
  if (deviceId) {
    const ownerId =
      typeof report.ownerId === "string" ? report.ownerId.trim() : ""
    const device =
      typeof report.deviceId === "string" ? report.deviceId.trim() : ""
    if (ownerId === deviceId || device === deviceId) return true
  }

  const uid =
    typeof options.viewerUid === "string" ? options.viewerUid.trim() : ""
  if (uid) {
    const ownerUid =
      typeof report.ownerUid === "string" ? report.ownerUid.trim() : ""
    if (ownerUid === uid) return true
  }
  return false
}

/**
 * Default map/list/nearby/duplicate visibility.
 * Soft-hidden reports stay out of default surfaces unless selected or owned.
 */
export function shouldShowReportByLifecycle(
  report: LifecycleReportLike | null | undefined,
  options: LifecycleVisibilityOptions = {}
): boolean {
  if (!report) return false

  const id = report.id != null ? String(report.id) : ""
  const selected =
    options.selectedReportId != null && String(options.selectedReportId) !== ""
      ? String(options.selectedReportId)
      : ""
  if (selected && id && selected === id) return true

  if (isOwnedByViewer(report, options)) return true

  return !isReportSoftHiddenByLifecycle(
    report,
    options.now ?? Date.now(),
    options.graceMs ?? LIFECYCLE_LIKELY_GONE_GRACE_MS
  )
}

/** Soft-hidden reports must not seed duplicate detection. */
export function isExcludedFromDuplicateByLifecycle(
  report: LifecycleReportLike | null | undefined,
  now = Date.now()
): boolean {
  return isReportSoftHiddenByLifecycle(report, now)
}

/** Soft-hidden reports must not appear in Nearby. */
export function isExcludedFromNearbyByLifecycle(
  report: LifecycleReportLike | null | undefined,
  now = Date.now()
): boolean {
  return isReportSoftHiddenByLifecycle(report, now)
}

/** Documented: soft-hide never deletes Firestore reports. */
export function lifecycleDeletesReports(): boolean {
  return false
}

/** Documented: soft-hide never mutates resolved / solvedAt. */
export function lifecycleMutatesResolvedAt(): boolean {
  return false
}

/** Documented: soft-hide never extends TTL. */
export function lifecycleExtendsExpiry(): boolean {
  return false
}

/** Documented: V1 soft-hide uses parent aggregates only (no marker N+1). */
export function lifecycleRequiresPerMarkerConfirmationReads(): boolean {
  return false
}

/** Documented: lifecycle soft-hide is active when aggregates + grace allow it. */
export function lifecycleSoftHidesReports(): boolean {
  return true
}
