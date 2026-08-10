/**
 * TRN 058E/H/J — nearby report notification orchestration.
 * Evaluates recipients; sends FCM only when send gate is true AND rollout unlocks.
 *
 * 058J: fail-closed staged rollout + optional budget reservation hooks.
 * Production defaults: gate false, Stage 0 config — no real FCM.
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
  nearbyBudgetActionAfterSend,
  type NearbyBudgetDecisionReason,
  type NearbyBudgetState,
} from "./nearbyBudget"
import { deserializeNearbyBudgetDoc } from "./budgetPersistence"
import {
  EMPTY_NEARBY_OBSERVABILITY_COUNTS,
  type NearbyObservabilityCounts,
} from "./nearbyObservability"
import {
  assertNearbyPayloadSafe,
  buildNearbyReportEventKey,
  buildNearbyReportPayload,
} from "./payload"
import {
  isNearbyCategorySendCapable,
  isNearbyReportFreshEnough,
  nearbySeverityForCategory,
  passesNearbyTrustGate,
} from "./policy"
import { parseNearbyReportCreate } from "./reportParse"
import {
  NEARBY_ROLLOUT_DEFAULT_CONFIG,
  normalizeNearbyRolloutConfig,
  type NearbyNormalizedRolloutConfig,
  type NearbyRolloutStage,
} from "./rolloutConfig"
import { filterNearbyRolloutEligible } from "./rolloutEligibility"
import {
  filterNearbyCanaryRecipients,
  isNearbyNotificationSendAllowed,
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
} from "./sendGate"

export type NearbySendResult = {
  success: boolean
  errorCode?: string
}

export type NearbyBudgetReserveResult = {
  reserved: boolean
  reason: NearbyBudgetDecisionReason | "REJECT_BUDGET_TRANSACTION_FAILED"
  reservationId?: string
  /** Opaque prior state for legacy in-memory release; prefer reservationId. */
  releaseHandle?: NearbyBudgetState
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
  /**
   * Optional rollout config source. Default = Stage 0 (fail closed).
   * Only invoked when master send gate is true.
   */
  getRolloutConfig?: () =>
    | NearbyNormalizedRolloutConfig
    | Promise<NearbyNormalizedRolloutConfig | unknown>
    | unknown
  /**
   * Atomic budget reservation (Firestore txn in production wiring).
   * Only invoked when master send gate is true.
   */
  reserveNearbyBudget?: (input: {
    reportId: string
    subscriptionId: string
    severity: NonNullable<ReturnType<typeof nearbySeverityForCategory>>
    nowMs: number
    budgetRaw?: unknown
  }) => Promise<NearbyBudgetReserveResult>
  releaseNearbyBudget?: (input: {
    subscriptionId: string
    reservationId?: string
    releaseHandle?: NearbyBudgetState
    nowMs: number
  }) => Promise<void>
  commitNearbyBudget?: (input: {
    subscriptionId: string
    reservationId: string
    nowMs: number
  }) => Promise<void>
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
  rolloutRejectedCount: number
  rolloutEligibleCount: number
  cooldownRejectedCount: number
  hourlyBudgetRejectedCount: number
  dailyBudgetRejectedCount: number
  criticalWindowRejectedCount: number
  dedupeRejectedCount: number
  attempted: number
  success: number
  failed: number
  disabledTokens: number
  sendGate: boolean
  rolloutStage: NearbyRolloutStage
}

function emptyOutcome(
  partial: Partial<NearbyNotifyOutcome> & {
    status: NearbyNotifyOutcome["status"]
  }
): NearbyNotifyOutcome {
  return {
    candidateCount: 0,
    eligibleCount: 0,
    allowlistedEligibleCount: 0,
    rolloutRejectedCount: 0,
    rolloutEligibleCount: 0,
    cooldownRejectedCount: 0,
    hourlyBudgetRejectedCount: 0,
    dailyBudgetRejectedCount: 0,
    criticalWindowRejectedCount: 0,
    dedupeRejectedCount: 0,
    attempted: 0,
    success: 0,
    failed: 0,
    disabledTokens: 0,
    sendGate: false,
    rolloutStage: 0,
    ...partial,
  }
}

async function resolveRolloutConfig(
  deps: NearbyNotifyDeps
): Promise<NearbyNormalizedRolloutConfig> {
  if (!deps.getRolloutConfig) return { ...NEARBY_ROLLOUT_DEFAULT_CONFIG }
  try {
    const raw = await deps.getRolloutConfig()
    if (
      raw &&
      typeof raw === "object" &&
      "normalizeReason" in (raw as object) &&
      "stage" in (raw as object)
    ) {
      // Already normalized.
      const n = raw as NearbyNormalizedRolloutConfig
      if (typeof n.stage === "number" && typeof n.normalizeReason === "string") {
        return n
      }
    }
    return normalizeNearbyRolloutConfig(raw)
  } catch {
    return {
      ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
      normalizeReason: "rollout_config_read_failed",
    }
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
 * When send gate is false: evaluate + return dry_run (no events, no FCM, no budget writes).
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
      rolloutStage: 0,
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
      rolloutStage: 0,
    })
  }

  if (!isNearbyCategorySendCapable(report.reportCategory)) {
    return emptyOutcome({
      status: "skipped",
      reason: "category_send_disabled_v1",
      category: report.reportCategory,
      sendGate,
      rolloutStage: 0,
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
      rolloutStage: 0,
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
      rolloutStage: 0,
    })
  }

  const radiusMeters = nearbyNotificationRadiusMeters(report.reportCategory)
  if (radiusMeters == null) {
    return emptyOutcome({
      status: "skipped",
      reason: "no_radius",
      category: report.reportCategory,
      sendGate,
      rolloutStage: 0,
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
      rolloutStage: 0,
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
      rolloutStage: 0,
    })
  }

  // Dry-run: never claim events / never FCM / never budget mutate / never ops read.
  if (!sendGate) {
    return emptyOutcome({
      status: "dry_run",
      reason: "send_gate_false",
      category: report.reportCategory,
      candidateCount: loaded.candidates.length,
      eligibleCount: eligible.length,
      allowlistedEligibleCount: 0,
      rolloutEligibleCount: 0,
      rolloutRejectedCount: 0,
      sendGate: false,
      rolloutStage: 0,
    })
  }

  const rolloutConfig = await resolveRolloutConfig(deps)

  // KEY 2 — staged rollout (default Stage 0 ⇒ nobody).
  const rolloutFiltered = filterNearbyRolloutEligible({
    compileTimeSendGate: true,
    config: rolloutConfig,
    reportCategory: report.reportCategory,
    recipients: eligible,
  })

  if (rolloutFiltered.eligible.length === 0) {
    return emptyOutcome({
      status: "skipped",
      reason: "no_rollout_recipients",
      category: report.reportCategory,
      candidateCount: loaded.candidates.length,
      eligibleCount: eligible.length,
      allowlistedEligibleCount: 0,
      rolloutEligibleCount: 0,
      rolloutRejectedCount: rolloutFiltered.rejectedCount,
      sendGate: true,
      rolloutStage: rolloutConfig.stage,
    })
  }

  // Legacy canary allowlist (empty ⇒ nobody). Keeps mistaken gate+stage flips fail-closed
  // until ops intentionally populate canary or a later task retires it.
  const canarySet =
    deps.canarySubscriptionIds ?? NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
  const canaryEligible = filterNearbyCanaryRecipients(
    rolloutFiltered.eligible,
    canarySet
  )

  if (canaryEligible.length === 0) {
    return emptyOutcome({
      status: "skipped",
      reason: "no_canary_recipients",
      category: report.reportCategory,
      candidateCount: loaded.candidates.length,
      eligibleCount: eligible.length,
      allowlistedEligibleCount: 0,
      rolloutEligibleCount: rolloutFiltered.eligible.length,
      rolloutRejectedCount: rolloutFiltered.rejectedCount,
      sendGate: true,
      rolloutStage: rolloutConfig.stage,
    })
  }

  return sendToEligible(
    report,
    canaryEligible,
    deps,
    {
      candidateCount: loaded.candidates.length,
      eligibleCount: eligible.length,
      allowlistedEligibleCount: canaryEligible.length,
      rolloutEligibleCount: rolloutFiltered.eligible.length,
      rolloutRejectedCount: rolloutFiltered.rejectedCount,
    },
    rolloutConfig.stage,
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
  countsBase: {
    candidateCount: number
    eligibleCount: number
    allowlistedEligibleCount: number
    rolloutEligibleCount: number
    rolloutRejectedCount: number
  },
  rolloutStage: NearbyRolloutStage,
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
      ...countsBase,
      sendGate: true,
      rolloutStage,
    })
  }

  const severity = nearbySeverityForCategory(report.reportCategory)
  if (!severity) {
    return emptyOutcome({
      status: "failed",
      reason: "unknown_severity",
      category: report.reportCategory,
      ...countsBase,
      sendGate: true,
      rolloutStage,
    })
  }

  let attempted = 0
  let success = 0
  let failed = 0
  let disabledTokens = 0
  let duplicates = 0
  let transientFailures = 0
  let cooldownRejectedCount = 0
  let hourlyBudgetRejectedCount = 0
  let dailyBudgetRejectedCount = 0
  let criticalWindowRejectedCount = 0
  let dedupeRejectedCount = 0

  for (const recipient of canaryEligible) {
    let reservationId: string | undefined
    let releaseHandle: NearbyBudgetState | undefined

    if (deps.reserveNearbyBudget) {
      const budgetRaw =
        (recipient as { nearbyNotificationBudget?: unknown })
          .nearbyNotificationBudget ?? null
      const decoded = deserializeNearbyBudgetDoc(budgetRaw)
      if (!decoded.ok && budgetRaw != null) {
        cooldownRejectedCount += 1
        continue
      }
      const reserved = await deps.reserveNearbyBudget({
        reportId: report.reportId,
        subscriptionId: recipient.subscriptionId,
        severity,
        nowMs,
        budgetRaw,
      })
      if (!reserved.reserved) {
        cooldownRejectedCount += 1
        if (reserved.reason === "REJECT_HOURLY_BUDGET") {
          hourlyBudgetRejectedCount += 1
        }
        if (reserved.reason === "REJECT_DAILY_BUDGET") {
          dailyBudgetRejectedCount += 1
        }
        if (reserved.reason === "REJECT_CRITICAL_WINDOW") {
          criticalWindowRejectedCount += 1
        }
        continue
      }
      reservationId = reserved.reservationId
      releaseHandle = reserved.releaseHandle
    }

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
      dedupeRejectedCount += 1
      if (
        deps.releaseNearbyBudget &&
        nearbyBudgetActionAfterSend({
          fcmSuccess: false,
          permanentInvalidToken: false,
          eventClaim: "duplicate",
        }) === "release_reservation"
      ) {
        await deps.releaseNearbyBudget({
          subscriptionId: recipient.subscriptionId,
          reservationId,
          releaseHandle,
          nowMs,
        })
      }
      continue
    }

    attempted += 1
    const result = await deps.sendDataMessage(recipient.token, payload)
    const action = nearbyBudgetActionAfterSend({
      fcmSuccess: result.success,
      permanentInvalidToken: isPermanentInvalidTokenError(result.errorCode),
      eventClaim: "claimed",
    })

    if (result.success) {
      success += 1
      if (reservationId && deps.commitNearbyBudget) {
        await deps.commitNearbyBudget({
          subscriptionId: recipient.subscriptionId,
          reservationId,
          nowMs,
        })
      }
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
    if (action === "release_reservation" && deps.releaseNearbyBudget) {
      await deps.releaseNearbyBudget({
        subscriptionId: recipient.subscriptionId,
        reservationId,
        releaseHandle,
        nowMs,
      })
    }

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

  const obs: NearbyObservabilityCounts = {
    ...EMPTY_NEARBY_OBSERVABILITY_COUNTS,
    ...countsBase,
    cooldownRejectedCount,
    hourlyBudgetRejectedCount,
    dailyBudgetRejectedCount,
    criticalWindowRejectedCount,
    dedupeRejectedCount,
    attempted,
    success,
    failed,
    disabledTokens,
  }

  if (attempted === 0 && duplicates > 0) {
    return emptyOutcome({
      status: "skipped",
      reason: "all_duplicate_events",
      category: report.reportCategory,
      ...obs,
      allowlistedEligibleCount: countsBase.allowlistedEligibleCount,
      sendGate: true,
      rolloutStage,
    })
  }

  if (attempted === 0 && cooldownRejectedCount > 0) {
    return emptyOutcome({
      status: "skipped",
      reason: "all_budget_rejected",
      category: report.reportCategory,
      ...obs,
      allowlistedEligibleCount: countsBase.allowlistedEligibleCount,
      sendGate: true,
      rolloutStage,
    })
  }

  if (success === 0 && transientFailures > 0) {
    return emptyOutcome({
      status: "failed",
      reason: "transient_all_failed_retryable",
      category: report.reportCategory,
      ...obs,
      allowlistedEligibleCount: countsBase.allowlistedEligibleCount,
      sendGate: true,
      rolloutStage,
    })
  }

  if (success === 0 && attempted > 0) {
    return emptyOutcome({
      status: "failed",
      reason: "all_sends_failed",
      category: report.reportCategory,
      ...obs,
      allowlistedEligibleCount: countsBase.allowlistedEligibleCount,
      sendGate: true,
      rolloutStage,
    })
  }

  if (attempted === 0) {
    return emptyOutcome({
      status: "skipped",
      reason: "no_send_attempts",
      category: report.reportCategory,
      ...obs,
      allowlistedEligibleCount: countsBase.allowlistedEligibleCount,
      sendGate: true,
      rolloutStage,
    })
  }

  return emptyOutcome({
    status: failed > 0 ? "partial" : "sent",
    category: report.reportCategory,
    ...obs,
    allowlistedEligibleCount: countsBase.allowlistedEligibleCount,
    sendGate: true,
    rolloutStage,
  })
}
