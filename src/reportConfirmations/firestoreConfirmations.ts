/**
 * Firestore access for report confirmations.
 * Load only for a selected eligible report — never per-marker listeners.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  type Firestore,
} from "firebase/firestore"
import {
  isValidConfirmationStatus,
  type ConfirmationDoc,
  type ConfirmationStatus,
} from "./reportConfirmations"

export function confirmationDocRef(
  db: Firestore,
  reportId: string,
  uid: string
) {
  return doc(db, "reports", reportId, "confirmations", uid)
}

export function confirmationsCollectionRef(db: Firestore, reportId: string) {
  return collection(db, "reports", reportId, "confirmations")
}

export type LoadedConfirmation = {
  id: string
  status: ConfirmationStatus
  createdAt: number
  updatedAt: number
}

export async function loadReportConfirmations(
  db: Firestore,
  reportId: string
): Promise<LoadedConfirmation[]> {
  const snap = await getDocs(confirmationsCollectionRef(db, reportId))
  const out: LoadedConfirmation[] = []
  for (const d of snap.docs) {
    const data = d.data() as Partial<ConfirmationDoc>
    if (!isValidConfirmationStatus(data.status)) continue
    out.push({
      id: d.id,
      status: data.status,
      createdAt: typeof data.createdAt === "number" ? data.createdAt : 0,
      updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    })
  }
  return out
}

/**
 * One UID = one confirmation doc (doc id = uid).
 * Create or update; never creates a second document.
 */
export async function upsertReportConfirmation(options: {
  db: Firestore
  reportId: string
  uid: string
  status: ConfirmationStatus
  now?: number
}): Promise<ConfirmationDoc> {
  const { db, reportId, uid, status } = options
  if (!isValidConfirmationStatus(status)) {
    throw new Error("Invalid confirmation status")
  }

  const now = options.now ?? Date.now()
  const ref = confirmationDocRef(db, reportId, uid)
  const existing = await getDoc(ref)

  if (existing.exists()) {
    await updateDoc(ref, { status, updatedAt: now })
    const prev = existing.data() as Partial<ConfirmationDoc>
    return {
      status,
      createdAt:
        typeof prev.createdAt === "number" ? prev.createdAt : now,
      updatedAt: now,
    }
  }

  const created: ConfirmationDoc = {
    status,
    createdAt: now,
    updatedAt: now,
  }
  await setDoc(ref, created)
  return created
}
