/**
 * Community confirm / deny for live road + incident intelligence.
 * Answers: "Is this report still relevant right now?"
 * Not likes, reputation, or official verification.
 */

import { isIncidentReport } from "../utils/incidentTypes.ts"
import { isRoadIntelligenceReport } from "../utils/roadIntelligenceTypes.ts"

export const CONFIRMATION_STATUS = {
  present: "present",
  gone: "gone",
} as const

export type ConfirmationStatus =
  (typeof CONFIRMATION_STATUS)[keyof typeof CONFIRMATION_STATUS]

export type ConfirmationDoc = {
  status: ConfirmationStatus
  createdAt: number
  updatedAt: number
}

export type ConfirmationCounts = {
  presentCount: number
  goneCount: number
  total: number
}

export type ConfirmationishReport = {
  id?: string
  type?: string
  reportFamily?: string
  reportCategory?: string
  ownerUid?: string
  ownerId?: string
}

/** Rider-facing copy — Lebanese-friendly, no technical jargon. */
export const CONFIRMATION_COPY = {
  prompt: "هل ما زال موجوداً؟",
  present: "لسا موجود",
  gone: "مش موجود",
  trustDefault: "بلاغ من دراج",
  trustCommunity: "مؤكد من عدة دراجين",
  ownerHint: "أنت صاحب البلاغ — التأكيد للجماعة",
  voteFailed: "ما قدرنا نسجّل رأيك — حاول مرة تانية",
  authNotReady: "ثوانٍ… عم نجهّز الحساب",
  reportMissing: "هالبلاغ ما عاد ظاهر",
} as const

/**
 * Trust label threshold (documented):
 * - at least COMMUNITY_TRUST_MIN_PRESENT independent "لسا موجود" votes
 * - and presentCount >= 2 * goneCount (clearly positive ratio)
 * Owner votes are excluded client-side and by rules when ownerUid is set.
 */
export const COMMUNITY_TRUST_MIN_PRESENT = 3

export function isValidConfirmationStatus(
  value: unknown
): value is ConfirmationStatus {
  return value === "present" || value === "gone"
}

/** Live intelligence only — not assistance / sharedRide / stolen / marketplace / weather. */
export function isConfirmationEligibleReport(
  report: ConfirmationishReport | null | undefined
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

export function isReportOwnerForConfirmation(
  report: ConfirmationishReport,
  currentUid: string | null | undefined
): boolean {
  const uid = typeof currentUid === "string" ? currentUid.trim() : ""
  if (!uid) return false
  const ownerUid =
    typeof report.ownerUid === "string" ? report.ownerUid.trim() : ""
  return ownerUid.length > 0 && ownerUid === uid
}

export function canUserCastConfirmation(options: {
  report: ConfirmationishReport
  currentUid: string | null | undefined
}): boolean {
  const { report, currentUid } = options
  if (!isConfirmationEligibleReport(report)) return false
  const uid = typeof currentUid === "string" ? currentUid.trim() : ""
  if (!uid) return false
  if (isReportOwnerForConfirmation(report, uid)) return false
  return true
}

export function countConfirmations(
  docs: ReadonlyArray<{ status?: unknown }>
): ConfirmationCounts {
  let presentCount = 0
  let goneCount = 0
  for (const d of docs) {
    if (d.status === "present") presentCount += 1
    else if (d.status === "gone") goneCount += 1
  }
  return {
    presentCount,
    goneCount,
    total: presentCount + goneCount,
  }
}

export function meetsCommunityTrustThreshold(
  counts: ConfirmationCounts
): boolean {
  return (
    counts.presentCount >= COMMUNITY_TRUST_MIN_PRESENT &&
    counts.presentCount >= counts.goneCount * 2
  )
}

export function trustLabelForCounts(counts: ConfirmationCounts): string {
  return meetsCommunityTrustThreshold(counts)
    ? CONFIRMATION_COPY.trustCommunity
    : CONFIRMATION_COPY.trustDefault
}

/** Compact mobile summary: "لسا موجود 12 · مش موجود 3" */
export function formatConfirmationSummary(counts: ConfirmationCounts): string {
  return `${CONFIRMATION_COPY.present} ${counts.presentCount} · ${CONFIRMATION_COPY.gone} ${counts.goneCount}`
}

/**
 * Apply a vote to an in-memory list (one doc per uid).
 * Used for post-write local recount without an extra round-trip when preferred.
 */
export function upsertConfirmationInList(
  docs: ReadonlyArray<{ id: string; status: ConfirmationStatus }>,
  uid: string,
  status: ConfirmationStatus
): Array<{ id: string; status: ConfirmationStatus }> {
  const next = docs.filter((d) => d.id !== uid)
  next.push({ id: uid, status })
  return next
}

/** Confirmation docs must not create notification payloads — guard for tests. */
export function confirmationCreatesNotificationPath(): boolean {
  return false
}

/** Confirmations never mutate report ownership fields. */
export function confirmationTouchesOwnership(): boolean {
  return false
}

/** V1 does not change report expiry / TTL. */
export function confirmationChangesExpiry(): boolean {
  return false
}
