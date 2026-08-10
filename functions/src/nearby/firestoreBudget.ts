/**
 * TRN 058K — Firestore Admin atomic nearby budget reservation.
 * Nested on notificationSubscriptions.nearbyNotificationBudget.
 */

import type { Firestore } from "firebase-admin/firestore"
import {
  applyNearbyBudgetReservation,
  type NearbyBudgetDecisionReason,
  type NearbyBudgetState,
} from "./nearbyBudget"
import type { NearbySeverity } from "./policy"
import {
  buildNearbyBudgetReservationId,
  deserializeNearbyBudgetDoc,
  serializeNearbyBudgetDoc,
  type NearbyBudgetPendingEntry,
} from "./budgetPersistence"

export type ReserveNearbyBudgetTxnResult =
  | {
      reserved: true
      reason: "ALLOW"
      reservationId: string
      previous: NearbyBudgetState
      next: NearbyBudgetState
      idempotentReplay: boolean
    }
  | {
      reserved: false
      reason: NearbyBudgetDecisionReason | "REJECT_BUDGET_TRANSACTION_FAILED"
      reservationId: string
      previous: NearbyBudgetState
      next: null
      idempotentReplay: false
    }

function subscriptionRef(db: Firestore, subscriptionId: string) {
  return db.collection("notificationSubscriptions").doc(subscriptionId)
}

/** Pure transaction body (testable without live Firestore). */
export function applyReserveNearbyBudgetTransactionBody(input: {
  subscriptionExists: boolean
  budgetRaw: unknown
  reservationId: string
  severity: NearbySeverity
  nowMs: number
}): {
  result: ReserveNearbyBudgetTxnResult
  nextBudgetDoc: Record<string, unknown> | null
} {
  const reservationId = String(input.reservationId || "").trim()
  const emptyPrevious: NearbyBudgetState = {
    hourWindowStartMs: null,
    hourCount: 0,
    dayWindowStartMs: null,
    dayCount: 0,
    lastSentAtMs: null,
    criticalWindowStartMs: null,
    criticalCount: 0,
  }

  if (!input.subscriptionExists || !reservationId) {
    return {
      result: {
        reserved: false,
        reason: "REJECT_BUDGET_TRANSACTION_FAILED",
        reservationId,
        previous: emptyPrevious,
        next: null,
        idempotentReplay: false,
      },
      nextBudgetDoc: null,
    }
  }

  const decoded = deserializeNearbyBudgetDoc(input.budgetRaw)
  if (!decoded.ok) {
    return {
      result: {
        reserved: false,
        reason: "REJECT_INVALID_BUDGET_STATE",
        reservationId,
        previous: decoded.state,
        next: null,
        idempotentReplay: false,
      },
      nextBudgetDoc: null,
    }
  }

  const existingPending = decoded.pending[reservationId]
  if (existingPending) {
    return {
      result: {
        reserved: true,
        reason: "ALLOW",
        reservationId,
        previous: existingPending.previous,
        next: decoded.state,
        idempotentReplay: true,
      },
      nextBudgetDoc: null,
    }
  }

  const applied = applyNearbyBudgetReservation(
    decoded.state,
    input.severity,
    input.nowMs
  )
  if (!applied.ok) {
    return {
      result: {
        reserved: false,
        reason: applied.reason,
        reservationId,
        previous: decoded.state,
        next: null,
        idempotentReplay: false,
      },
      nextBudgetDoc: null,
    }
  }

  const pending: Record<string, NearbyBudgetPendingEntry> = {
    ...decoded.pending,
    [reservationId]: {
      previous: decoded.state,
      reservedAtMs: input.nowMs,
      severity: input.severity,
    },
  }

  return {
    result: {
      reserved: true,
      reason: "ALLOW",
      reservationId,
      previous: decoded.state,
      next: applied.next,
      idempotentReplay: false,
    },
    nextBudgetDoc: serializeNearbyBudgetDoc(applied.next, pending),
  }
}

export function applyReleaseNearbyBudgetTransactionBody(input: {
  subscriptionExists: boolean
  budgetRaw: unknown
  reservationId: string
}): {
  ok: boolean
  nextBudgetDoc: Record<string, unknown> | null
  reason: string
} {
  const reservationId = String(input.reservationId || "").trim()
  if (!input.subscriptionExists || !reservationId) {
    return { ok: false, nextBudgetDoc: null, reason: "missing_subscription" }
  }
  const decoded = deserializeNearbyBudgetDoc(input.budgetRaw)
  if (!decoded.ok) {
    return { ok: false, nextBudgetDoc: null, reason: "malformed_budget" }
  }
  const entry = decoded.pending[reservationId]
  if (!entry) {
    return { ok: true, nextBudgetDoc: null, reason: "already_released" }
  }
  const pending = { ...decoded.pending }
  delete pending[reservationId]
  return {
    ok: true,
    nextBudgetDoc: serializeNearbyBudgetDoc(entry.previous, pending),
    reason: "released",
  }
}

export function applyCommitNearbyBudgetTransactionBody(input: {
  subscriptionExists: boolean
  budgetRaw: unknown
  reservationId: string
}): {
  ok: boolean
  nextBudgetDoc: Record<string, unknown> | null
  reason: string
} {
  const reservationId = String(input.reservationId || "").trim()
  if (!input.subscriptionExists || !reservationId) {
    return { ok: false, nextBudgetDoc: null, reason: "missing_subscription" }
  }
  const decoded = deserializeNearbyBudgetDoc(input.budgetRaw)
  if (!decoded.ok) {
    return { ok: false, nextBudgetDoc: null, reason: "malformed_budget" }
  }
  if (!decoded.pending[reservationId]) {
    return { ok: true, nextBudgetDoc: null, reason: "already_committed" }
  }
  const pending = { ...decoded.pending }
  delete pending[reservationId]
  return {
    ok: true,
    nextBudgetDoc: serializeNearbyBudgetDoc(decoded.state, pending),
    reason: "committed",
  }
}

export async function reserveNearbyNotificationBudget(input: {
  db: Firestore
  reportId: string
  subscriptionId: string
  severity: NearbySeverity
  nowMs: number
}): Promise<ReserveNearbyBudgetTxnResult> {
  const reservationId = buildNearbyBudgetReservationId(
    input.reportId,
    input.subscriptionId
  )
  const ref = subscriptionRef(input.db, input.subscriptionId)
  try {
    return await input.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const body = applyReserveNearbyBudgetTransactionBody({
        subscriptionExists: snap.exists,
        budgetRaw: snap.exists
          ? (snap.data() as { nearbyNotificationBudget?: unknown })
              ?.nearbyNotificationBudget
          : null,
        reservationId,
        severity: input.severity,
        nowMs: input.nowMs,
      })
      if (body.nextBudgetDoc) {
        tx.set(
          ref,
          {
            nearbyNotificationBudget: body.nextBudgetDoc,
            updatedAt: input.nowMs,
          },
          { merge: true }
        )
      }
      return body.result
    })
  } catch {
    return {
      reserved: false,
      reason: "REJECT_BUDGET_TRANSACTION_FAILED",
      reservationId,
      previous: {
        hourWindowStartMs: null,
        hourCount: 0,
        dayWindowStartMs: null,
        dayCount: 0,
        lastSentAtMs: null,
        criticalWindowStartMs: null,
        criticalCount: 0,
      },
      next: null,
      idempotentReplay: false,
    }
  }
}

export async function releaseNearbyNotificationBudget(input: {
  db: Firestore
  subscriptionId: string
  reservationId: string
  nowMs: number
}): Promise<{ ok: boolean; reason: string }> {
  const ref = subscriptionRef(input.db, input.subscriptionId)
  try {
    return await input.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const body = applyReleaseNearbyBudgetTransactionBody({
        subscriptionExists: snap.exists,
        budgetRaw: snap.exists
          ? (snap.data() as { nearbyNotificationBudget?: unknown })
              ?.nearbyNotificationBudget
          : null,
        reservationId: input.reservationId,
      })
      if (body.nextBudgetDoc) {
        tx.set(
          ref,
          {
            nearbyNotificationBudget: body.nextBudgetDoc,
            updatedAt: input.nowMs,
          },
          { merge: true }
        )
      }
      return { ok: body.ok, reason: body.reason }
    })
  } catch {
    return { ok: false, reason: "transaction_failed" }
  }
}

export async function commitNearbyNotificationBudget(input: {
  db: Firestore
  subscriptionId: string
  reservationId: string
  nowMs: number
}): Promise<{ ok: boolean; reason: string }> {
  const ref = subscriptionRef(input.db, input.subscriptionId)
  try {
    return await input.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const body = applyCommitNearbyBudgetTransactionBody({
        subscriptionExists: snap.exists,
        budgetRaw: snap.exists
          ? (snap.data() as { nearbyNotificationBudget?: unknown })
              ?.nearbyNotificationBudget
          : null,
        reservationId: input.reservationId,
      })
      if (body.nextBudgetDoc) {
        tx.set(
          ref,
          {
            nearbyNotificationBudget: body.nextBudgetDoc,
            updatedAt: input.nowMs,
          },
          { merge: true }
        )
      }
      return { ok: body.ok, reason: body.reason }
    })
  } catch {
    return { ok: false, reason: "transaction_failed" }
  }
}

/** Serialized concurrent race using pure transaction bodies. */
export function concurrentReserveRaceHarness(input: {
  initialBudgetRaw: unknown
  reservationIds: [string, string]
  severity: NearbySeverity
  nowMs: number
}): {
  first: ReserveNearbyBudgetTxnResult
  second: ReserveNearbyBudgetTxnResult
  finalHourlyCount: number | null
} {
  let budgetRaw = input.initialBudgetRaw
  const r1 = applyReserveNearbyBudgetTransactionBody({
    subscriptionExists: true,
    budgetRaw,
    reservationId: input.reservationIds[0],
    severity: input.severity,
    nowMs: input.nowMs,
  })
  if (r1.nextBudgetDoc) budgetRaw = r1.nextBudgetDoc
  const r2 = applyReserveNearbyBudgetTransactionBody({
    subscriptionExists: true,
    budgetRaw,
    reservationId: input.reservationIds[1],
    severity: input.severity,
    nowMs: input.nowMs,
  })
  if (r2.nextBudgetDoc) budgetRaw = r2.nextBudgetDoc
  const final = deserializeNearbyBudgetDoc(budgetRaw)
  return {
    first: r1.result,
    second: r2.result,
    finalHourlyCount: final.ok ? final.state.hourCount : null,
  }
}
