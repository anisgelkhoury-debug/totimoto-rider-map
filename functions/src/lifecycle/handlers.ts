/**
 * Handlers for helper-cancelled, owner-resolved, and owner-cancelled events.
 */

import {
  buildHelperCancelledPayload,
  buildOwnerCancelledPayload,
  buildOwnerResolvedPayload,
  toFcmDataMap,
} from "./payloads"
import {
  buildHelperCancelledEventKey,
  buildOwnerCancelledEventKey,
  buildOwnerResolvedEventKey,
  isHelperCancelledTransition,
  isOwnerCancelledTransition,
  isOwnerResolvedTransition,
  recipientForHelperCancelled,
  recipientForOwnerCancelled,
  recipientForOwnerResolved,
} from "./transitions"
import type { ReportSnapshot } from "../shared/report"
import {
  processLifecycleNotification,
  type LifecycleNotifyDeps,
  type LifecycleNotifyOutcome,
} from "../shared/processLifecycle"

export type LifecycleHandlerDeps = LifecycleNotifyDeps
export type LifecycleHandlerOutcome = LifecycleNotifyOutcome

const ignored = (reason: string): LifecycleHandlerOutcome => ({
  status: "ignored",
  reason,
  attempted: 0,
  success: 0,
  failed: 0,
  disabledTokens: 0,
})

export async function processHelperCancelledUpdate(
  reportId: string,
  before: ReportSnapshot | null | undefined,
  after: ReportSnapshot | null | undefined,
  deps: LifecycleHandlerDeps
): Promise<LifecycleHandlerOutcome> {
  if (!isHelperCancelledTransition(before, after) || !before || !after) {
    return ignored("not_helper_cancelled_transition")
  }

  const recipientUid = recipientForHelperCancelled(before, after)
  if (!recipientUid) return ignored("missing_recipient")

  return processLifecycleNotification(
    {
      eventKey: buildHelperCancelledEventKey(reportId, before),
      eventType: "helper_cancelled",
      reportId,
      recipientUid,
      preferenceKey: "helperLifecycle",
      payload: toFcmDataMap(
        buildHelperCancelledPayload(reportId, (deps.now ?? Date.now)())
      ),
    },
    deps
  )
}

export async function processOwnerResolvedUpdate(
  reportId: string,
  before: ReportSnapshot | null | undefined,
  after: ReportSnapshot | null | undefined,
  deps: LifecycleHandlerDeps
): Promise<LifecycleHandlerOutcome> {
  if (!isOwnerResolvedTransition(before, after) || !before) {
    return ignored("not_owner_resolved_transition")
  }

  const recipientUid = recipientForOwnerResolved(before)
  if (!recipientUid) return ignored("missing_recipient")

  return processLifecycleNotification(
    {
      eventKey: buildOwnerResolvedEventKey(reportId),
      eventType: "owner_resolved",
      reportId,
      recipientUid,
      preferenceKey: "ownerLifecycle",
      payload: toFcmDataMap(
        buildOwnerResolvedPayload(reportId, (deps.now ?? Date.now)())
      ),
    },
    deps
  )
}

export async function processOwnerCancelledDelete(
  reportId: string,
  before: ReportSnapshot | null | undefined,
  deps: LifecycleHandlerDeps
): Promise<LifecycleHandlerOutcome> {
  if (!isOwnerCancelledTransition(before) || !before) {
    return ignored("not_owner_cancelled_transition")
  }

  const recipientUid = recipientForOwnerCancelled(before)
  if (!recipientUid) return ignored("missing_recipient")

  return processLifecycleNotification(
    {
      eventKey: buildOwnerCancelledEventKey(reportId),
      eventType: "owner_cancelled",
      reportId,
      recipientUid,
      preferenceKey: "ownerLifecycle",
      payload: toFcmDataMap(
        buildOwnerCancelledPayload(reportId, (deps.now ?? Date.now)())
      ),
    },
    deps
  )
}
