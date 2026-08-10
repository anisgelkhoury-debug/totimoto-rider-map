/**
 * TRN 058E — nearby report notification orchestration.
 * Evaluates recipients; sends FCM only when send gate is true.
 */

import {
  isNearbyNotificationReportEligible,
  nearbyNotificationRadiusMeters,
} from "../shared/nearbyNotificationRadii"
import { planNotificationRecipientCells } from "../shared/recipientGeoPlan"
import {
  filterNearbyNotificationRecipients,
  type EligibleNearbyRecipient,
  type NearbyRecipientSubscriptionDoc,
} from "../shared/recipientTargeting"
import { isPermanentInvalidTokenError } from "../shared/subscriptions"
import {
  assertNearbyPayloadSafe,
  buildNearbyReportEventKey,
  buildNearbyReportPayload,
} from "./payload"
import {
  isNearbyCategorySendCapable,
  isNearbyReportFreshEnough,
  passesNearbyTrustGate,
} from "./policy"
import { parseNearbyReportCreate } from "./reportParse"
import {
  filterNearbyCanaryRecipients,
  isNearbyNotificationSendAllowed,
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
} from "./sendGate"

export type NearbySendResult = {
  success: boolean
  errorCode?: string
}

export type NearbyNotifyDeps = {
  listSubscriptionsByGeohashRange: (
    start: string,
    end: string
  ) => Promise<NearbyRecipientSubscriptionDoc[]>
  claimEventOnce: (
    eventKey: string,
    meta: Record<string, unknown>
  ) => Promise<"claimed" | "duplicate">
  releaseEventClaim?: (eventKey: string) => Promise<void>
  markEventComplete?: (
    eventKey: string,
    status: string,
    counts: Record<string, number>
  ) => Promise<void>
  sendDataMessage: (
    token: string,
    data: Record<string, string>
  ) => Promise<NearbySendResult>
  disableSubscription: (subscriptionId: string) => Promise<void>
  /** Test override for ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND */
  allowSend?: boolean
  /** Test override for canary subscription allowlist */
  canarySubscriptionIds?: ReadonlySet<string>
  now?: () => number
}

export type NearbyNotifyOutcome = {
  status:
    | "skipped"
    | "dry_run"
    | "no_recipients"
    | "sent"
    | "partial"
    | "failed"
  reason?: string
  category?: string
  candidateCount: number
  eligibleCount: number
  /** Eligible recipients that also pass the canary allowlist (send path only). */
  allowlistedEligibleCount: number
  attempted: number
  success: number
  failed: number
  disabledTokens: number
  sendGate: boolean
}

function emptyOutcome(
  partial: Partial<NearbyNotifyOutcome> & { status: NearbyNotifyOutcome["status"] }
): NearbyNotifyOutcome {
  return {
    candidateCount: 0,
    eligibleCount: 0,
    allowlistedEligibleCount: 0,
    attempted: 0,
    success: 0,
    failed: 0,
    disabledTokens: 0,
    sendGate: false,
    ...partial,
  }
}

async function loadCandidates(
  deps: NearbyNotifyDeps,
  lat: number,
  lng: number,
  radiusMeters: number
): Promise<{
  candidates: NearbyRecipientSubscriptionDoc[]
  queryCount: number
  reason?: string
}> {
  const plan = planNotificationRecipientCells({
    reportLat: lat,
    reportLng: lng,
    radiusMeters,
  })
  if (!plan.ok) {
    return { candidates: [], queryCount: 0, reason: plan.reason }
  }

  const merged: NearbyRecipientSubscriptionDoc[] = []
  for (const q of plan.queries) {
    const docs = await deps.listSubscriptionsByGeohashRange(
      q.range.start,
      q.range.end
    )
    merged.push(...docs)
  }
  return { candidates: merged, queryCount: plan.queryCount }
}

/**
 * Process a newly created report for nearby alerts.
 * When send gate is false: evaluate + return dry_run (no events, no FCM).
 */
export async function processNearbyReportCreated(
  reportId: string,
  data: Record<string, unknown> | null | undefined,
  deps: NearbyNotifyDeps
): Promise<NearbyNotifyOutcome> {
  const nowMs = (deps.now ?? Date.now)()
  const sendGate = isNearbyNotificationSendAllowed(deps.allowSend)

  const report = parseNearbyReportCreate(reportId, data)
  if (!report) {
    return emptyOutcome({
      status: "skipped",
      reason: "malformed_report",
      sendGate,
    })
  }

  if (
    !isNearbyNotificationReportEligible({
      reportCategory: report.reportCategory,
      reportFamily: report.reportFamily,
      resolved: report.resolved,
    })
  ) {
    return emptyOutcome({
      status: "skipped",
      reason: "category_ineligible",
      category: report.reportCategory,
      sendGate,
    })
  }

  if (!isNearbyCategorySendCapable(report.reportCategory)) {
    return emptyOutcome({
      status: "skipped",
      reason: "category_send_disabled_v1",
      category: report.reportCategory,
      sendGate,
    })
  }

  if (
    !isNearbyReportFreshEnough({
      category: report.reportCategory,
      createdAtMs: report.createdAtMs,
      nowMs,
    })
  ) {
    return emptyOutcome({
      status: "skipped",
      reason: "report_stale",
      category: report.reportCategory,
      sendGate,
    })
  }

  const trust = passesNearbyTrustGate({
    category: report.reportCategory,
    confirmationPresentCount: report.confirmationPresentCount,
    confirmationGoneCount: report.confirmationGoneCount,
    likelyGoneSince: report.likelyGoneSince,
  })
  if (!trust.ok) {
    return emptyOutcome({
      status: "skipped",
      reason: trust.reason || "trust_failed",
      category: report.reportCategory,
      sendGate,
    })
  }

  const radiusMeters = nearbyNotificationRadiusMeters(report.reportCategory)
  if (radiusMeters == null) {
    return emptyOutcome({
      status: "skipped",
      reason: "no_radius",
      category: report.reportCategory,
      sendGate,
    })
  }

  const loaded = await loadCandidates(
    deps,
    report.lat,
    report.lng,
    radiusMeters
  )
  if (loaded.reason && loaded.candidates.length === 0) {
    return emptyOutcome({
      status: "skipped",
      reason: loaded.reason,
      category: report.reportCategory,
      sendGate,
    })
  }

  const eligible = filterNearbyNotificationRecipients({
    candidates: loaded.candidates,
    report: {
      id: report.reportId,
      ownerUid: report.ownerUid,
      reportCategory: report.reportCategory,
      reportFamily: report.reportFamily,
      resolved: report.resolved,
    },
    nowMs,
  })

  if (eligible.length === 0) {
    return emptyOutcome({
      status: "no_recipients",
      reason: "none_eligible",
      category: report.reportCategory,
      candidateCount: loaded.candidates.length,
      eligibleCount: 0,
      sendGate,
    })
  }

  // Dry-run: never claim events / never FCM while gate is false.
  if (!sendGate) {
    return emptyOutcome({
      status: "dry_run",
      reason: "send_gate_false",
      category: report.reportCategory,
      candidateCount: loaded.candidates.length,
      eligibleCount: eligible.length,
      allowlistedEligibleCount: 0,
      sendGate: false,
    })
  }

  const canarySet =
    deps.canarySubscriptionIds ?? NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
  const canaryEligible = filterNearbyCanaryRecipients(eligible, canarySet)

  if (canaryEligible.length === 0) {
    return emptyOutcome({
      status: "skipped",
      reason: "no_canary_recipients",
      category: report.reportCategory,
      candidateCount: loaded.candidates.length,
      eligibleCount: eligible.length,
      allowlistedEligibleCount: 0,
      sendGate: true,
    })
  }

  return sendToEligible(
    report,
    canaryEligible,
    deps,
    loaded.candidates.length,
    eligible.length,
    canaryEligible.length,
    nowMs
  )
}

async function sendToEligible(
  report: {
    reportId: string
    reportCategory: string
    createdAtMs: number
  },
  canaryEligible: EligibleNearbyRecipient[],
  deps: NearbyNotifyDeps,
  candidateCount: number,
  eligibleCount: number,
  allowlistedEligibleCount: number,
  nowMs: number
): Promise<NearbyNotifyOutcome> {
  const payload = buildNearbyReportPayload({
    reportId: report.reportId,
    category: report.reportCategory,
    createdAtMs: report.createdAtMs,
  })
  if (!payload || !assertNearbyPayloadSafe(payload)) {
    return emptyOutcome({
      status: "failed",
      reason: "unsafe_payload",
      category: report.reportCategory,
      candidateCount,
      eligibleCount,
      allowlistedEligibleCount,
      sendGate: true,
    })
  }

  let attempted = 0
  let success = 0
  let failed = 0
  let disabledTokens = 0
  let duplicates = 0
  let transientFailures = 0

  for (const recipient of canaryEligible) {
    const eventKey = buildNearbyReportEventKey(
      report.reportId,
      recipient.subscriptionId
    )
    const claim = await deps.claimEventOnce(eventKey, {
      type: "nearby_report",
      notificationType: payload.notificationType,
      reportId: report.reportId,
      subscriptionId: recipient.subscriptionId,
      category: report.reportCategory,
      status: "processing",
      createdAt: nowMs,
    })
    if (claim === "duplicate") {
      duplicates += 1
      continue
    }

    attempted += 1
    const result = await deps.sendDataMessage(recipient.token, payload)
    if (result.success) {
      success += 1
      if (deps.markEventComplete) {
        await deps.markEventComplete(eventKey, "sent", {
          attempted: 1,
          success: 1,
          failed: 0,
          disabledTokens: 0,
        })
      }
      continue
    }

    failed += 1
    if (isPermanentInvalidTokenError(result.errorCode)) {
      await deps.disableSubscription(recipient.subscriptionId)
      disabledTokens += 1
      if (deps.markEventComplete) {
        await deps.markEventComplete(eventKey, "failed_invalid_token", {
          attempted: 1,
          success: 0,
          failed: 1,
          disabledTokens: 1,
        })
      }
    } else {
      transientFailures += 1
      if (deps.releaseEventClaim) {
        await deps.releaseEventClaim(eventKey)
      }
    }
  }

  if (attempted === 0 && duplicates > 0) {
    return emptyOutcome({
      status: "skipped",
      reason: "all_duplicate_events",
      category: report.reportCategory,
      candidateCount,
      eligibleCount,
      allowlistedEligibleCount,
      sendGate: true,
    })
  }

  if (success === 0 && transientFailures > 0) {
    return emptyOutcome({
      status: "failed",
      reason: "transient_all_failed_retryable",
      category: report.reportCategory,
      candidateCount,
      eligibleCount,
      allowlistedEligibleCount,
      attempted,
      success,
      failed,
      disabledTokens,
      sendGate: true,
    })
  }

  if (success === 0) {
    return emptyOutcome({
      status: "failed",
      reason: "all_sends_failed",
      category: report.reportCategory,
      candidateCount,
      eligibleCount,
      allowlistedEligibleCount,
      attempted,
      success,
      failed,
      disabledTokens,
      sendGate: true,
    })
  }

  return emptyOutcome({
    status: failed > 0 ? "partial" : "sent",
    category: report.reportCategory,
    candidateCount,
    eligibleCount,
    allowlistedEligibleCount,
    attempted,
    success,
    failed,
    disabledTokens,
    sendGate: true,
  })
}
