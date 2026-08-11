/**
 * TRN 058K — Firestore persistence mapping for nearbyNotificationBudget.
 * Nested on notificationSubscriptions (minimal extra docs/reads).
 */

import type { NearbyBudgetState } from "./nearbyBudget"
import { EMPTY_NEARBY_BUDGET_STATE, parseNearbyBudgetState } from "./nearbyBudget"

/** Deterministic reservation id — aligned with notificationEvents key family. */
export function buildNearbyBudgetReservationId(
  reportId: string,
  subscriptionId: string
): string {
  return `nearby_budget:${String(reportId || "").trim()}:${String(subscriptionId || "").trim()}`
}

export type NearbyBudgetPendingEntry = {
  previous: NearbyBudgetState
  reservedAtMs: number
  severity: string
}

export type NearbyBudgetPersisted = NearbyBudgetState & {
  pending: Record<string, NearbyBudgetPendingEntry>
}

function pickMs(
  o: Record<string, unknown>,
  primary: string,
  alias: string
): unknown {
  if (primary in o) return o[primary]
  if (alias in o) return o[alias]
  return null
}

/** Accept 058J internal names or 058K Firestore field aliases. */
export function deserializeNearbyBudgetDoc(raw: unknown): {
  ok: boolean
  state: NearbyBudgetState
  pending: Record<string, NearbyBudgetPendingEntry>
} {
  if (raw == null) {
    return { ok: true, state: { ...EMPTY_NEARBY_BUDGET_STATE }, pending: {} }
  }
  if (typeof raw !== "object") {
    return { ok: false, state: { ...EMPTY_NEARBY_BUDGET_STATE }, pending: {} }
  }
  const o = raw as Record<string, unknown>
  const normalized = {
    hourWindowStartMs: pickMs(o, "hourWindowStartMs", "hourlyWindowStartedAt"),
    hourCount: o.hourCount ?? o.hourlyCount ?? 0,
    dayWindowStartMs: pickMs(o, "dayWindowStartMs", "dailyWindowStartedAt"),
    dayCount: o.dayCount ?? o.dailyCount ?? 0,
    lastSentAtMs: pickMs(o, "lastSentAtMs", "lastNearbySentAt"),
    criticalWindowStartMs: pickMs(
      o,
      "criticalWindowStartMs",
      "criticalWindowStartedAt"
    ),
    criticalCount: o.criticalCount ?? 0,
  }
  const parsed = parseNearbyBudgetState(normalized)
  if (!parsed.ok) {
    return { ok: false, state: { ...EMPTY_NEARBY_BUDGET_STATE }, pending: {} }
  }

  const pending: Record<string, NearbyBudgetPendingEntry> = {}
  const rawPending = o.pending
  if (rawPending != null && typeof rawPending === "object") {
    for (const [key, value] of Object.entries(
      rawPending as Record<string, unknown>
    )) {
      if (!key || typeof value !== "object" || value == null) continue
      const p = value as Record<string, unknown>
      const prev = deserializeNearbyBudgetDoc(p.previous)
      if (!prev.ok) continue
      if (
        typeof p.reservedAtMs !== "number" ||
        !Number.isFinite(p.reservedAtMs)
      ) {
        continue
      }
      pending[key] = {
        previous: prev.state,
        reservedAtMs: p.reservedAtMs,
        severity: String(p.severity || ""),
      }
    }
  }

  return { ok: true, state: parsed.state, pending }
}

/** Persist using 058K Firestore field names (+ pending map). */
export function serializeNearbyBudgetDoc(
  state: NearbyBudgetState,
  pending: Record<string, NearbyBudgetPendingEntry>
): Record<string, unknown> {
  const pendingOut: Record<string, unknown> = {}
  for (const [id, entry] of Object.entries(pending)) {
    pendingOut[id] = {
      previous: {
        hourlyWindowStartedAt: entry.previous.hourWindowStartMs,
        hourlyCount: entry.previous.hourCount,
        dailyWindowStartedAt: entry.previous.dayWindowStartMs,
        dailyCount: entry.previous.dayCount,
        lastNearbySentAt: entry.previous.lastSentAtMs,
        criticalWindowStartedAt: entry.previous.criticalWindowStartMs,
        criticalCount: entry.previous.criticalCount,
      },
      reservedAtMs: entry.reservedAtMs,
      severity: entry.severity,
    }
  }
  return {
    hourlyWindowStartedAt: state.hourWindowStartMs,
    hourlyCount: state.hourCount,
    dailyWindowStartedAt: state.dayWindowStartMs,
    dailyCount: state.dayCount,
    lastNearbySentAt: state.lastSentAtMs,
    criticalWindowStartedAt: state.criticalWindowStartMs,
    criticalCount: state.criticalCount,
    pending: pendingOut,
  }
}
