/**
 * Owner unresolved reports subscription (escape hatch).
 */

import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  type Firestore,
  type Unsubscribe,
} from "firebase/firestore"
import { normalizeLiveReports } from "../utils/reportSnapshot.ts"
import {
  BOUNDED_GEO_INDEX_REQUIRED,
  OWNER_UNRESOLVED_LIMIT,
  isMissingIndexError,
} from "./queryBuilder.ts"

export type OwnerReportsSubscription = {
  unsubscribe: () => void
}

export function subscribeOwnerUnresolvedReports(options: {
  db: Firestore
  ownerUid: string
  onData: (reports: Array<Record<string, unknown> & { id: string }>) => void
  onError?: (info: { missingIndex: boolean; code: string }) => void
  limitTo?: number
}): OwnerReportsSubscription | null {
  const uid =
    typeof options.ownerUid === "string" ? options.ownerUid.trim() : ""
  if (!uid) return null

  const lim = options.limitTo ?? OWNER_UNRESOLVED_LIMIT
  const q = query(
    collection(options.db, "reports"),
    where("ownerUid", "==", uid),
    where("resolved", "==", false),
    orderBy("createdAt", "desc"),
    limit(lim)
  )

  const unsub: Unsubscribe = onSnapshot(
    q,
    (snap) => {
      const reports = normalizeLiveReports(snap.docs) as Array<
        Record<string, unknown> & { id: string }
      >
      options.onData(reports)
    },
    (error) => {
      const missingIndex = isMissingIndexError(error)
      if (import.meta.env.DEV) {
        console.error(
          missingIndex
            ? `[TRN Geo] ${BOUNDED_GEO_INDEX_REQUIRED} (owner)`
            : "[TRN Geo] owner listener error",
          missingIndex ? undefined : error
        )
      }
      options.onError?.({
        missingIndex,
        code: missingIndex
          ? BOUNDED_GEO_INDEX_REQUIRED
          : "bounded_owner_query_error",
      })
    }
  )

  return { unsubscribe: () => unsub() }
}
