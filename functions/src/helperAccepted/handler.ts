/**
 * Orchestrates helper-accepted notification via shared lifecycle processor.
 */

import { buildHelperAcceptedPayload } from "./payload"
import {
  asNonEmptyString,
  buildHelperAcceptedEventKey,
  isHelperAcceptedTransition,
  type ReportSnapshot,
} from "./transition"
import {
  processLifecycleNotification,
  type LifecycleNotifyDeps,
  type LifecycleNotifyOutcome,
} from "../shared/processLifecycle"

export type { SendResult } from "../shared/processLifecycle"

export type HelperAcceptedDeps = LifecycleNotifyDeps

export type HelperAcceptedOutcome = LifecycleNotifyOutcome

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

  return processLifecycleNotification(
    {
      eventKey: buildHelperAcceptedEventKey(reportId, after),
      eventType: "helper_accepted",
      reportId,
      recipientUid: ownerUid,
      preferenceKey: "helperLifecycle",
      payload: buildHelperAcceptedPayload(reportId, (deps.now ?? Date.now)()),
    },
    deps
  )
}
