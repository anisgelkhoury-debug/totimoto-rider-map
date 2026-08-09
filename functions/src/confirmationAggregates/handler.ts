/**
 * Sync parent-report confirmation aggregates after a confirmation write.
 * Recounts confirmations/{uid} under one report — no global scan.
 */

import {
  FieldValue,
  type Firestore,
  type DocumentData,
} from "firebase-admin/firestore"
import { computeAggregateSyncState } from "./logic"
import { safeError, safeInfo } from "../lib/safeLog"

export type SyncConfirmationAggregatesResult = {
  status: "updated" | "missing_report" | "error"
  presentCount?: number
  goneCount?: number
  likelyGone?: boolean
  reason?: string
}

export async function syncConfirmationAggregatesForReport(
  db: Firestore,
  reportId: string,
  nowMs = Date.now()
): Promise<SyncConfirmationAggregatesResult> {
  const id = typeof reportId === "string" ? reportId.trim() : ""
  if (!id) {
    return { status: "error", reason: "missing_report_id" }
  }

  const reportRef = db.collection("reports").doc(id)

  try {
    const [reportSnap, confSnap] = await Promise.all([
      reportRef.get(),
      reportRef.collection("confirmations").get(),
    ])

    if (!reportSnap.exists) {
      return { status: "missing_report", reason: "report_not_found" }
    }

    const data = (reportSnap.data() || {}) as DocumentData
    const confirmationDocs = confSnap.docs.map((d) => ({
      status: d.data()?.status,
    }))

    const patch = computeAggregateSyncState({
      confirmationDocs,
      existingLikelyGoneSince: data.likelyGoneSince,
      nowMs,
    })

    const update: Record<string, unknown> = {
      confirmationPresentCount: patch.confirmationPresentCount,
      confirmationGoneCount: patch.confirmationGoneCount,
      confirmationUpdatedAt: patch.confirmationUpdatedAt,
    }

    if (patch.clearLikelyGoneSince) {
      update.likelyGoneSince = FieldValue.delete()
    } else if (patch.likelyGoneSinceMs != null) {
      update.likelyGoneSince = patch.likelyGoneSinceMs
    }

    await reportRef.update(update)

    safeInfo("confirmation_aggregates_synced", {
      reportId: id,
      present: patch.confirmationPresentCount,
      gone: patch.confirmationGoneCount,
      clearLikelyGoneSince: patch.clearLikelyGoneSince ? 1 : 0,
    })

    return {
      status: "updated",
      presentCount: patch.confirmationPresentCount,
      goneCount: patch.confirmationGoneCount,
      likelyGone: !patch.clearLikelyGoneSince,
    }
  } catch (error: unknown) {
    const code =
      typeof error === "object" && error && "code" in error
        ? String((error as { code?: unknown }).code)
        : "unknown"
    safeError("confirmation_aggregates_sync_failed", code)
    return { status: "error", reason: code }
  }
}
