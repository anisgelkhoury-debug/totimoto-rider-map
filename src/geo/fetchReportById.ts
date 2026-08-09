/**
 * One-shot report fetch for deep-link / selected escape hatch.
 */

import {
  doc,
  getDoc,
  type Firestore,
} from "firebase/firestore"
import { normalizeReportCreatedAt } from "../utils/reportSnapshot.ts"
import { isReportExpiredForBounded } from "./filterBoundedReports.ts"

export type FetchReportByIdResult =
  | { ok: true; report: Record<string, unknown> & { id: string } }
  | { ok: false; reason: "missing" | "expired" | "invalid_id" | "error" }

export async function fetchReportById(
  db: Firestore,
  reportId: string
): Promise<FetchReportByIdResult> {
  const id = typeof reportId === "string" ? reportId.trim() : ""
  if (!id) return { ok: false, reason: "invalid_id" }

  try {
    const snap = await getDoc(doc(db, "reports", id))
    if (!snap.exists()) return { ok: false, reason: "missing" }
    const raw = snap.data() || {}
    const createdAt = normalizeReportCreatedAt(raw.createdAt)
    const report = {
      ...raw,
      id: snap.id,
      createdAt,
    }
    if (isReportExpiredForBounded(report)) {
      return { ok: false, reason: "expired" }
    }
    return { ok: true, report }
  } catch {
    return { ok: false, reason: "error" }
  }
}
