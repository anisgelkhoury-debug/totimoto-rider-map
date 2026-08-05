/**
 * TRN Cloud Functions — owner↔helper lifecycle notifications.
 * 2nd gen Firestore triggers. No client sends. No production deploy in this task.
 */
import { initializeApp } from "firebase-admin/app"
import { FieldValue, getFirestore, type DocumentData } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import {
  onDocumentDeleted,
  onDocumentUpdated,
} from "firebase-functions/v2/firestore"
import { processHelperAcceptedUpdate } from "./helperAccepted/handler"
import {
  processHelperCancelledUpdate,
  processOwnerCancelledDelete,
  processOwnerResolvedUpdate,
} from "./lifecycle/handlers"
import { safeError, safeInfo } from "./lib/safeLog"
import type { PreferenceKey, ReportSnapshot } from "./shared/report"
import type { LifecycleNotifyOutcome } from "./shared/processLifecycle"
import type { SubscriptionDoc } from "./shared/subscriptions"

initializeApp()

const db = getFirestore()
const messaging = getMessaging()

function asReportSnapshot(data: DocumentData | undefined): ReportSnapshot | null {
  if (!data) return null
  return {
    ownerUid: data.ownerUid,
    helperUid: data.helperUid,
    helperComing: data.helperComing,
    helperAcceptedAt: data.helperAcceptedAt,
    resolved: data.resolved,
    reportFamily: data.reportFamily,
  }
}

async function claimEventOnce(
  eventKey: string,
  meta: Record<string, unknown>
): Promise<"claimed" | "duplicate"> {
  const ref = db.collection("notificationEvents").doc(eventKey)
  try {
    await ref.create({
      ...meta,
      createdAt: FieldValue.serverTimestamp(),
    })
    return "claimed"
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : ""
    if (code === "already-exists" || code === "6") {
      return "duplicate"
    }
    throw error
  }
}

async function releaseEventClaim(eventKey: string): Promise<void> {
  await db.collection("notificationEvents").doc(eventKey).delete()
}

async function markEventComplete(
  eventKey: string,
  status: string,
  counts: Record<string, number>
): Promise<void> {
  await db.collection("notificationEvents").doc(eventKey).set(
    {
      status,
      attempted: counts.attempted ?? 0,
      success: counts.success ?? 0,
      failed: counts.failed ?? 0,
      disabledTokens: counts.disabledTokens ?? 0,
      completedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

async function listSubscriptions(
  recipientUid: string,
  preferenceKey: PreferenceKey
): Promise<SubscriptionDoc[]> {
  const prefPath =
    preferenceKey === "ownerLifecycle"
      ? "notificationPreferences.ownerLifecycle"
      : "notificationPreferences.helperLifecycle"

  const snap = await db
    .collection("notificationSubscriptions")
    .where("uid", "==", recipientUid)
    .where("enabled", "==", true)
    .where("permissionState", "==", "granted")
    .where(prefPath, "==", true)
    .get()

  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      uid: data.uid,
      enabled: data.enabled,
      permissionState: data.permissionState,
      token: data.token,
      notificationPreferences: data.notificationPreferences ?? null,
    }
  })
}

async function sendDataMessage(
  token: string,
  data: Record<string, string>
): Promise<{ success: boolean; errorCode?: string }> {
  try {
    await messaging.send({
      token,
      data,
      android: {
        priority: "high",
        collapseKey: data.tag || "trn-lifecycle",
      },
      webpush: {
        headers: {
          Urgency: "high",
          TTL: "300",
        },
        fcmOptions: {
          link: data.deepLink,
        },
      },
    })
    return { success: true }
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown"
    safeError("fcm_send_failed", code)
    return { success: false, errorCode: code }
  }
}

async function disableSubscription(subscriptionId: string): Promise<void> {
  await db.collection("notificationSubscriptions").doc(subscriptionId).set(
    {
      enabled: false,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  )
}

const sharedDeps = {
  claimEventOnce,
  releaseEventClaim,
  markEventComplete,
  listSubscriptions,
  sendDataMessage,
  disableSubscription,
}

function logOutcome(label: string, outcome: LifecycleNotifyOutcome): void {
  safeInfo(label, {
    status: outcome.status,
    attempted: outcome.attempted,
    success: outcome.success,
    failed: outcome.failed,
    disabledTokens: outcome.disabledTokens,
    reason: outcome.reason || "",
  })
}

function throwIfRetryable(outcome: LifecycleNotifyOutcome, message: string): void {
  if (outcome.reason === "transient_all_failed_retryable") {
    throw new Error(message)
  }
}

/**
 * Single update trigger for mutually exclusive lifecycle transitions
 * (helper accepted / cancelled / owner resolved).
 */
export const onReportLifecycleUpdated = onDocumentUpdated(
  {
    document: "reports/{reportId}",
    region: "us-central1",
  },
  async (event) => {
    const reportId = event.params.reportId
    const before = asReportSnapshot(event.data?.before.data())
    const after = asReportSnapshot(event.data?.after.data())

    const accepted = await processHelperAcceptedUpdate(
      reportId,
      before,
      after,
      sharedDeps
    )
    logOutcome("helper_accepted_outcome", accepted)
    throwIfRetryable(accepted, "helper_accepted_transient_fcm_failure")

    const cancelled = await processHelperCancelledUpdate(
      reportId,
      before,
      after,
      sharedDeps
    )
    logOutcome("helper_cancelled_outcome", cancelled)
    throwIfRetryable(cancelled, "helper_cancelled_transient_fcm_failure")

    const resolved = await processOwnerResolvedUpdate(
      reportId,
      before,
      after,
      sharedDeps
    )
    logOutcome("owner_resolved_outcome", resolved)
    throwIfRetryable(resolved, "owner_resolved_transient_fcm_failure")
  }
)

/** Owner deleted an accepted active report → notify previous helper. */
export const onReportOwnerCancelled = onDocumentDeleted(
  {
    document: "reports/{reportId}",
    region: "us-central1",
  },
  async (event) => {
    const reportId = event.params.reportId
    const before = asReportSnapshot(event.data?.data())

    const outcome = await processOwnerCancelledDelete(reportId, before, sharedDeps)
    logOutcome("owner_cancelled_outcome", outcome)
    throwIfRetryable(outcome, "owner_cancelled_transient_fcm_failure")
  }
)
