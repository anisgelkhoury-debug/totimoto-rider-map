/**
 * TRN Cloud Functions — owner↔helper lifecycle notifications + rider weather proxy
 * + confirmation aggregate sync for Smart Report Lifecycle (Task 056)
 * + nearby report notification evaluation (Task 058E; send gate default OFF).
 * 2nd gen. No production deploy in this task.
 */
import { initializeApp } from "firebase-admin/app"
import { FieldValue, getFirestore, type DocumentData } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore"
import { syncConfirmationAggregatesForReport } from "./confirmationAggregates/handler"
import { processHelperAcceptedUpdate } from "./helperAccepted/handler"
import {
  processHelperCancelledUpdate,
  processOwnerCancelledDelete,
  processOwnerResolvedUpdate,
} from "./lifecycle/handlers"
import { safeError, safeInfo } from "./lib/safeLog"
import {
  processNearbyReportCreated,
  type NearbyNotifyOutcome,
} from "./nearby/processNearbyReport"
import {
  ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND,
  nearbyCanaryAllowlistSize,
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
} from "./nearby/sendGate"
import type { PreferenceKey, ReportSnapshot } from "./shared/report"
import type { LifecycleNotifyOutcome } from "./shared/processLifecycle"
import type { NearbyRecipientSubscriptionDoc } from "./shared/recipientTargeting"
import type { SubscriptionDoc } from "./shared/subscriptions"

/** Re-export for tests / ops visibility. */
export {
  ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND,
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
  nearbyCanaryAllowlistSize,
}

initializeApp()

export { getRiderWeather } from "./weather/getRiderWeather"

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

/**
 * 058E geo recipient query — matches prepared index:
 * enabled ASC + locationGeohash ASC
 */
async function listSubscriptionsByGeohashRange(
  start: string,
  end: string
): Promise<NearbyRecipientSubscriptionDoc[]> {
  const snap = await db
    .collection("notificationSubscriptions")
    .where("enabled", "==", true)
    .where("locationGeohash", ">=", start)
    .where("locationGeohash", "<=", end)
    .get()

  return snap.docs.map((doc) => {
    const data = doc.data()
    return {
      id: doc.id,
      uid: data.uid,
      enabled: data.enabled,
      permissionState: data.permissionState,
      token: data.token,
      locationGeohash: data.locationGeohash,
      locationUpdatedAt: data.locationUpdatedAt,
      notificationPreferences: data.notificationPreferences ?? null,
    }
  })
}

const sharedDeps = {
  claimEventOnce,
  releaseEventClaim,
  markEventComplete,
  listSubscriptions,
  sendDataMessage,
  disableSubscription,
}

const nearbyDeps = {
  claimEventOnce,
  releaseEventClaim,
  markEventComplete,
  listSubscriptionsByGeohashRange,
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

function logNearbyOutcome(outcome: NearbyNotifyOutcome): void {
  safeInfo("nearby_report_outcome", {
    status: outcome.status,
    reason: outcome.reason || "",
    category: outcome.category || "",
    candidateCount: outcome.candidateCount,
    eligibleCount: outcome.eligibleCount,
    allowlistedEligibleCount: outcome.allowlistedEligibleCount,
    attempted: outcome.attempted,
    success: outcome.success,
    failed: outcome.failed,
    disabledTokens: outcome.disabledTokens,
    sendGate: outcome.sendGate,
    canaryMode: outcome.sendGate === true,
    canaryAllowlistSize: nearbyCanaryAllowlistSize(),
  })
}

/**
 * Task 058E — evaluate nearby alerts on report CREATE only.
 * Does not share handlers with assistance lifecycle update/delete triggers.
 * FCM send requires ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND === true.
 */
export const onReportCreatedNearbyNotify = onDocumentCreated(
  {
    document: "reports/{reportId}",
    region: "us-central1",
  },
  async (event) => {
    const reportId = event.params.reportId
    const data = event.data?.data() as Record<string, unknown> | undefined
    const outcome = await processNearbyReportCreated(reportId, data, nearbyDeps)
    logNearbyOutcome(outcome)
    if (outcome.reason === "transient_all_failed_retryable") {
      throw new Error("nearby_report_transient_fcm_failure")
    }
  }
)

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

/**
 * Task 056 — maintain parent confirmation aggregates after confirmation write.
 * Recounts only this report's confirmations subcollection (no global scan).
 * Admin write; no notifications; no TTL / resolved mutation.
 */
export const onReportConfirmationWritten = onDocumentWritten(
  {
    document: "reports/{reportId}/confirmations/{uid}",
    region: "us-central1",
  },
  async (event) => {
    const reportId = event.params.reportId
    const result = await syncConfirmationAggregatesForReport(db, reportId)
    if (result.status === "error") {
      throw new Error(
        `confirmation_aggregates_sync_failed:${result.reason || "unknown"}`
      )
    }
    safeInfo("confirmation_aggregates_trigger", {
      reportId,
      status: result.status,
      present: result.presentCount ?? 0,
      gone: result.goneCount ?? 0,
    })
  }
)
