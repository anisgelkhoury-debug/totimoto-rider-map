/**
 * Shared claim → select → send → retry orchestration for lifecycle notifications.
 */

import { payloadContainsForbiddenKeys } from "./payloadSafety"
import type { PreferenceKey } from "./report"
import {
  isPermanentInvalidTokenError,
  selectEnabledSubscriptions,
  type SubscriptionDoc,
} from "./subscriptions"

export type SendResult = {
  success: boolean
  errorCode?: string
}

export type LifecycleNotifyDeps = {
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
  listSubscriptions: (
    recipientUid: string,
    preferenceKey: PreferenceKey
  ) => Promise<SubscriptionDoc[]>
  sendDataMessage: (token: string, data: Record<string, string>) => Promise<SendResult>
  disableSubscription: (subscriptionId: string) => Promise<void>
  now?: () => number
}

export type LifecycleNotifyRequest = {
  eventKey: string
  eventType: string
  reportId: string
  recipientUid: string
  preferenceKey: PreferenceKey
  payload: Record<string, string>
}

export type LifecycleNotifyOutcome = {
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

const emptyOutcome = (): LifecycleNotifyOutcome => ({
  status: "ignored",
  attempted: 0,
  success: 0,
  failed: 0,
  disabledTokens: 0,
})

/**
 * Idempotent multi-device send. Caller must already validate the business transition.
 */
export async function processLifecycleNotification(
  request: LifecycleNotifyRequest,
  deps: LifecycleNotifyDeps
): Promise<LifecycleNotifyOutcome> {
  const empty = emptyOutcome()
  const recipientUid = request.recipientUid.trim()
  if (!recipientUid) {
    return { ...empty, reason: "missing_recipient" }
  }

  const claim = await deps.claimEventOnce(request.eventKey, {
    type: request.eventType,
    reportId: request.reportId,
    status: "processing",
    createdAt: (deps.now ?? Date.now)(),
  })
  if (claim === "duplicate") {
    return { ...empty, status: "duplicate", reason: "event_exists" }
  }

  const subscriptions = selectEnabledSubscriptions(
    await deps.listSubscriptions(recipientUid, request.preferenceKey),
    recipientUid,
    request.preferenceKey
  )

  if (subscriptions.length === 0) {
    if (deps.markEventComplete) {
      await deps.markEventComplete(request.eventKey, "no_subscriptions", {
        attempted: 0,
        success: 0,
        failed: 0,
        disabledTokens: 0,
      })
    }
    return { ...empty, status: "no_subscriptions", reason: "none_enabled" }
  }

  if (payloadContainsForbiddenKeys(request.payload)) {
    return { ...empty, status: "failed", reason: "unsafe_payload" }
  }

  let success = 0
  let failed = 0
  let disabledTokens = 0
  let transientFailures = 0

  for (const sub of subscriptions) {
    const result = await deps.sendDataMessage(sub.token, request.payload)
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

  if (success === 0 && transientFailures > 0) {
    if (deps.releaseEventClaim) {
      await deps.releaseEventClaim(request.eventKey)
    }
    return {
      status: "failed",
      reason: "transient_all_failed_retryable",
      ...counts,
    }
  }

  if (success === 0) {
    if (deps.markEventComplete) {
      await deps.markEventComplete(request.eventKey, "failed_no_valid_tokens", counts)
    }
    return {
      status: "failed",
      reason: "all_sends_failed",
      ...counts,
    }
  }

  const terminalStatus = failed > 0 ? "partial" : "sent"
  if (deps.markEventComplete) {
    await deps.markEventComplete(request.eventKey, terminalStatus, counts)
  }
  return {
    status: terminalStatus,
    ...counts,
  }
}
