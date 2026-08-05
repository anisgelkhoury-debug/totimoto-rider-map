/**
 * TRN Cloud Functions — helper accepted → notify report owner.
 * 2nd gen Firestore trigger. No client sends. No production deploy in this task.
 */
import { initializeApp } from "firebase-admin/app"
import { FieldValue, getFirestore, type DocumentData } from "firebase-admin/firestore"
import { getMessaging } from "firebase-admin/messaging"
import { onDocumentUpdated } from "firebase-functions/v2/firestore"
import { processHelperAcceptedUpdate } from "./helperAccepted/handler"
import type { SubscriptionDoc } from "./helperAccepted/subscriptions"
import type { ReportSnapshot } from "./helperAccepted/transition"
import { safeError, safeInfo } from "./lib/safeLog"

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
    // Firestore create conflict
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

async function listOwnerSubscriptions(ownerUid: string): Promise<SubscriptionDoc[]> {
  const snap = await db
    .collection("notificationSubscriptions")
    .where("uid", "==", ownerUid)
    .where("enabled", "==", true)
    .where("permissionState", "==", "granted")
    .where("notificationPreferences.helperLifecycle", "==", true)
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
        collapseKey: data.tag || "trn-helper-accepted",
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

export const onReportHelperAccepted = onDocumentUpdated(
  {
    document: "reports/{reportId}",
    region: "us-central1",
  },
  async (event) => {
    const reportId = event.params.reportId
    const before = asReportSnapshot(event.data?.before.data())
    const after = asReportSnapshot(event.data?.after.data())

    const outcome = await processHelperAcceptedUpdate(reportId, before, after, {
      claimEventOnce,
      releaseEventClaim,
      markEventComplete,
      listOwnerSubscriptions,
      sendDataMessage,
      disableSubscription,
    })

    safeInfo("helper_accepted_outcome", {
      status: outcome.status,
      attempted: outcome.attempted,
      success: outcome.success,
      failed: outcome.failed,
      disabledTokens: outcome.disabledTokens,
      reason: outcome.reason || "",
    })

    // Transient total failure: throw so platform may retry after claim release.
    if (outcome.reason === "transient_all_failed_retryable") {
      throw new Error("helper_accepted_transient_fcm_failure")
    }
  }
)
