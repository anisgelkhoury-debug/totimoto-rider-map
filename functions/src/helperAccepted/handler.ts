/**
 * Orchestrates helper-accepted notification with injectable dependencies.
 */

import {
  buildHelperAcceptedPayload,
  payloadContainsForbiddenKeys,
} from "./payload"
import {
  isPermanentInvalidTokenError,
  selectEnabledHelperLifecycleSubscriptions,
  type SubscriptionDoc,
} from "./subscriptions"
import {
  asNonEmptyString,
  buildHelperAcceptedEventKey,
  isHelperAcceptedTransition,
  type ReportSnapshot,
} from "./transition"

export type SendResult = {
  success: boolean
  errorCode?: string
}

export type HelperAcceptedDeps = {
  claimEventOnce: (eventKey: string, meta: Record<string, unknown>) => Promise<"claimed" | "duplicate">
  /** Release claim so a CF retry can re-send after total transient failure. */
  releaseEventClaim?: (eventKey: string) => Promise<void>
  /** Mark event terminal after at least one successful delivery (or permanent no-op). */
  markEventComplete?: (eventKey: string, status: string, counts: Record<string, number>) => Promise<void>
  listOwnerSubscriptions: (ownerUid: string) => Promise<SubscriptionDoc[]>
  sendDataMessage: (token: string, data: Record<string, string>) => Promise<SendResult>
  disableSubscription: (subscriptionId: string) => Promise<void>
  now?: () => number
}

export type HelperAcceptedOutcome = {
  status:
    | "ignored"
    | "duplicate"
    | "no_subscriptions"
    | "sent"
    | "partial"
    | "failed"
  reason?: string
  attempted: number
  success: number
  failed: number
  disabledTokens: number
}

export async function processHelperAcceptedUpdate(
  reportId: string,
  before: ReportSnapshot | null | undefined,
  after: ReportSnapshot | null | undefined,
  deps: HelperAcceptedDeps
): Promise<HelperAcceptedOutcome> {
  const empty: HelperAcceptedOutcome = {
    status: "ignored",
    attempted: 0,
    success: 0,
    failed: 0,
    disabledTokens: 0,
  }

  if (!isHelperAcceptedTransition(before, after)) {
    return { ...empty, reason: "not_helper_accepted_transition" }
  }

  const ownerUid = asNonEmptyString(after?.ownerUid)
  const helperUid = asNonEmptyString(after?.helperUid)
  if (!ownerUid || !helperUid || !after) {
    return { ...empty, reason: "missing_uids" }
  }

  const eventKey = buildHelperAcceptedEventKey(reportId, after)
  const claim = await deps.claimEventOnce(eventKey, {
    type: "helper_accepted",
    reportId,
    status: "processing",
    createdAt: (deps.now ?? Date.now)(),
  })
  if (claim === "duplicate") {
    return { ...empty, status: "duplicate", reason: "event_exists" }
  }

  const subscriptions = selectEnabledHelperLifecycleSubscriptions(
    await deps.listOwnerSubscriptions(ownerUid),
    ownerUid
  )

  if (subscriptions.length === 0) {
    if (deps.markEventComplete) {
      await deps.markEventComplete(eventKey, "no_subscriptions", {
        attempted: 0,
        success: 0,
        failed: 0,
        disabledTokens: 0,
      })
    }
    return { ...empty, status: "no_subscriptions", reason: "none_enabled" }
  }

  const payload = buildHelperAcceptedPayload(reportId, (deps.now ?? Date.now)())
  if (payloadContainsForbiddenKeys(payload as unknown as Record<string, unknown>)) {
    return { ...empty, status: "failed", reason: "unsafe_payload" }
  }

  let success = 0
  let failed = 0
  let disabledTokens = 0
  let transientFailures = 0

  for (const sub of subscriptions) {
    const result = await deps.sendDataMessage(sub.token, payload)
    if (result.success) {
      success += 1
      continue
    }
    failed += 1
    if (isPermanentInvalidTokenError(result.errorCode)) {
      await deps.disableSubscription(sub.id)
      disabledTokens += 1
    } else {
      transientFailures += 1
    }
  }

  const attempted = subscriptions.length
  const counts = { attempted, success, failed, disabledTokens }

  // Total failure with only transient errors: release claim so CF can retry safely.
  if (success === 0 && transientFailures > 0) {
    if (deps.releaseEventClaim) {
      await deps.releaseEventClaim(eventKey)
    }
    return {
      status: "failed",
      reason: "transient_all_failed_retryable",
      ...counts,
    }
  }

  if (success === 0) {
    if (deps.markEventComplete) {
      await deps.markEventComplete(eventKey, "failed_no_valid_tokens", counts)
    }
    return {
      status: "failed",
      reason: "all_sends_failed",
      ...counts,
    }
  }

  const terminalStatus = failed > 0 ? "partial" : "sent"
  if (deps.markEventComplete) {
    await deps.markEventComplete(eventKey, terminalStatus, counts)
  }
  return {
    status: terminalStatus,
    ...counts,
  }
}
