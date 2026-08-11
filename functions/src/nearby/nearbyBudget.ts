/**
 * TRN 058J — per-subscription nearby notification budget (pure).
 *
 * CRITICAL policy (safer fail-closed):
 * - May bypass MEDIUM/HIGH ordinary interval.
 * - Does NOT bypass hourly (~3) or daily (~12) soft budgets.
 * - Still capped at ~2 CRITICAL / 30 minutes.
 * - Hard report×subscription dedupe remains separate.
 */

import type { NearbySeverity } from "./policy"

export const NEARBY_BUDGET_POLICY = {
  hourlyMax: 3,
  hourlyWindowMs: 60 * 60 * 1000,
  dailyMax: 12,
  dailyWindowMs: 24 * 60 * 60 * 1000,
  mediumMinIntervalMs: 20 * 60 * 1000,
  highMinIntervalMs: 10 * 60 * 1000,
  criticalWindowMs: 30 * 60 * 1000,
  criticalMaxPerWindow: 2,
  /** CRITICAL bypasses ordinary MEDIUM/HIGH interval only — not hourly/daily. */
  criticalBypassesOrdinaryInterval: true,
  criticalBypassesHourlyDaily: false,
} as const

/** Server-owned fields nested under notificationSubscriptions.nearbyNotificationBudget */
export type NearbyBudgetState = {
  hourWindowStartMs: number | null
  hourCount: number
  dayWindowStartMs: number | null
  dayCount: number
  lastSentAtMs: number | null
  criticalWindowStartMs: number | null
  criticalCount: number
}

export const EMPTY_NEARBY_BUDGET_STATE: NearbyBudgetState = {
  hourWindowStartMs: null,
  hourCount: 0,
  dayWindowStartMs: null,
  dayCount: 0,
  lastSentAtMs: null,
  criticalWindowStartMs: null,
  criticalCount: 0,
}

export type NearbyBudgetDecisionReason =
  | "ALLOW"
  | "REJECT_HOURLY_BUDGET"
  | "REJECT_DAILY_BUDGET"
  | "REJECT_MEDIUM_INTERVAL"
  | "REJECT_HIGH_INTERVAL"
  | "REJECT_CRITICAL_WINDOW"
  | "REJECT_INVALID_BUDGET_STATE"

export type NearbyBudgetDecision = {
  allow: boolean
  reason: NearbyBudgetDecisionReason
}

function isFiniteNonNegInt(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && Number.isInteger(n)
}

function isFiniteMs(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0
}

/** Fail closed on malformed persisted budget. */
export function parseNearbyBudgetState(raw: unknown): {
  ok: boolean
  state: NearbyBudgetState
} {
  if (raw == null) {
    return { ok: true, state: { ...EMPTY_NEARBY_BUDGET_STATE } }
  }
  if (typeof raw !== "object") {
    return { ok: false, state: { ...EMPTY_NEARBY_BUDGET_STATE } }
  }
  const o = raw as Record<string, unknown>
  const hourWindowStartMs =
    o.hourWindowStartMs == null ? null : o.hourWindowStartMs
  const dayWindowStartMs =
    o.dayWindowStartMs == null ? null : o.dayWindowStartMs
  const lastSentAtMs = o.lastSentAtMs == null ? null : o.lastSentAtMs
  const criticalWindowStartMs =
    o.criticalWindowStartMs == null ? null : o.criticalWindowStartMs

  if (
    !(hourWindowStartMs === null || isFiniteMs(hourWindowStartMs)) ||
    !(dayWindowStartMs === null || isFiniteMs(dayWindowStartMs)) ||
    !(lastSentAtMs === null || isFiniteMs(lastSentAtMs)) ||
    !(criticalWindowStartMs === null || isFiniteMs(criticalWindowStartMs)) ||
    !isFiniteNonNegInt(o.hourCount ?? 0) ||
    !isFiniteNonNegInt(o.dayCount ?? 0) ||
    !isFiniteNonNegInt(o.criticalCount ?? 0)
  ) {
    return { ok: false, state: { ...EMPTY_NEARBY_BUDGET_STATE } }
  }

  return {
    ok: true,
    state: {
      hourWindowStartMs:
        hourWindowStartMs === null ? null : (hourWindowStartMs as number),
      hourCount: (o.hourCount as number) ?? 0,
      dayWindowStartMs:
        dayWindowStartMs === null ? null : (dayWindowStartMs as number),
      dayCount: (o.dayCount as number) ?? 0,
      lastSentAtMs: lastSentAtMs === null ? null : (lastSentAtMs as number),
      criticalWindowStartMs:
        criticalWindowStartMs === null
          ? null
          : (criticalWindowStartMs as number),
      criticalCount: (o.criticalCount as number) ?? 0,
    },
  }
}

function rolledWindow(
  windowStartMs: number | null,
  count: number,
  nowMs: number,
  windowMs: number
): { windowStartMs: number; count: number } {
  if (windowStartMs == null || nowMs - windowStartMs >= windowMs) {
    return { windowStartMs: nowMs, count: 0 }
  }
  return { windowStartMs, count }
}

export function projectNearbyBudgetWindows(
  state: NearbyBudgetState,
  nowMs: number,
  policy = NEARBY_BUDGET_POLICY
): {
  hourCount: number
  dayCount: number
  criticalCount: number
  hourWindowStartMs: number
  dayWindowStartMs: number
  criticalWindowStartMs: number
} {
  const hour = rolledWindow(
    state.hourWindowStartMs,
    state.hourCount,
    nowMs,
    policy.hourlyWindowMs
  )
  const day = rolledWindow(
    state.dayWindowStartMs,
    state.dayCount,
    nowMs,
    policy.dailyWindowMs
  )
  const crit = rolledWindow(
    state.criticalWindowStartMs,
    state.criticalCount,
    nowMs,
    policy.criticalWindowMs
  )
  return {
    hourCount: hour.count,
    dayCount: day.count,
    criticalCount: crit.count,
    hourWindowStartMs: hour.windowStartMs,
    dayWindowStartMs: day.windowStartMs,
    criticalWindowStartMs: crit.windowStartMs,
  }
}

export function decideNearbyBudget(input: {
  state: NearbyBudgetState
  severity: NearbySeverity
  nowMs: number
  policy?: typeof NEARBY_BUDGET_POLICY
}): NearbyBudgetDecision {
  const parsed = parseNearbyBudgetState(input.state)
  if (!parsed.ok) {
    return { allow: false, reason: "REJECT_INVALID_BUDGET_STATE" }
  }
  // Re-parse via object fields in case caller passed a plain object already typed.
  const stateCheck = parseNearbyBudgetState({
    hourWindowStartMs: input.state.hourWindowStartMs,
    hourCount: input.state.hourCount,
    dayWindowStartMs: input.state.dayWindowStartMs,
    dayCount: input.state.dayCount,
    lastSentAtMs: input.state.lastSentAtMs,
    criticalWindowStartMs: input.state.criticalWindowStartMs,
    criticalCount: input.state.criticalCount,
  })
  if (!stateCheck.ok) {
    return { allow: false, reason: "REJECT_INVALID_BUDGET_STATE" }
  }

  const policy = input.policy ?? NEARBY_BUDGET_POLICY
  const w = projectNearbyBudgetWindows(input.state, input.nowMs, policy)

  if (w.dayCount >= policy.dailyMax) {
    return { allow: false, reason: "REJECT_DAILY_BUDGET" }
  }
  if (w.hourCount >= policy.hourlyMax) {
    return { allow: false, reason: "REJECT_HOURLY_BUDGET" }
  }

  if (input.severity === "CRITICAL") {
    if (w.criticalCount >= policy.criticalMaxPerWindow) {
      return { allow: false, reason: "REJECT_CRITICAL_WINDOW" }
    }
    return { allow: true, reason: "ALLOW" }
  }

  const last = input.state.lastSentAtMs
  if (last != null && Number.isFinite(last)) {
    const gap = input.nowMs - last
    if (input.severity === "MEDIUM" && gap < policy.mediumMinIntervalMs) {
      return { allow: false, reason: "REJECT_MEDIUM_INTERVAL" }
    }
    if (input.severity === "HIGH" && gap < policy.highMinIntervalMs) {
      return { allow: false, reason: "REJECT_HIGH_INTERVAL" }
    }
  }

  return { allow: true, reason: "ALLOW" }
}

/** Pure next-state after a successful reservation (not yet "committed" vs reserved). */
export function applyNearbyBudgetReservation(
  state: NearbyBudgetState,
  severity: NearbySeverity,
  nowMs: number,
  policy = NEARBY_BUDGET_POLICY
): { ok: true; next: NearbyBudgetState } | { ok: false; reason: NearbyBudgetDecisionReason } {
  const decision = decideNearbyBudget({ state, severity, nowMs, policy })
  if (!decision.allow) {
    return { ok: false, reason: decision.reason }
  }
  const w = projectNearbyBudgetWindows(state, nowMs, policy)
  const next: NearbyBudgetState = {
    hourWindowStartMs: w.hourWindowStartMs,
    hourCount: w.hourCount + 1,
    dayWindowStartMs: w.dayWindowStartMs,
    dayCount: w.dayCount + 1,
    lastSentAtMs: nowMs,
    criticalWindowStartMs: w.criticalWindowStartMs,
    criticalCount:
      severity === "CRITICAL" ? w.criticalCount + 1 : w.criticalCount,
  }
  return { ok: true, next }
}

/**
 * In-memory atomic reservation harness (simulates Firestore transaction).
 * Concurrent callers serialize on the shared map for a subscription id.
 */
export type NearbyBudgetStore = Map<string, NearbyBudgetState>

export function createNearbyBudgetStore(): NearbyBudgetStore {
  return new Map()
}

export function reserveNearbyBudgetSlotAtomic(input: {
  store: NearbyBudgetStore
  subscriptionId: string
  severity: NearbySeverity
  nowMs: number
  /** Snapshot of prior state for release on failure. */
}): {
  reserved: boolean
  reason: NearbyBudgetDecisionReason
  previous: NearbyBudgetState
  next: NearbyBudgetState | null
} {
  const id = String(input.subscriptionId || "").trim()
  const previous = input.store.get(id) ?? { ...EMPTY_NEARBY_BUDGET_STATE }
  const applied = applyNearbyBudgetReservation(
    previous,
    input.severity,
    input.nowMs
  )
  if (!applied.ok) {
    return {
      reserved: false,
      reason: applied.reason,
      previous,
      next: null,
    }
  }
  input.store.set(id, applied.next)
  return {
    reserved: true,
    reason: "ALLOW",
    previous,
    next: applied.next,
  }
}

export function releaseNearbyBudgetSlot(input: {
  store: NearbyBudgetStore
  subscriptionId: string
  previous: NearbyBudgetState
}): void {
  const id = String(input.subscriptionId || "").trim()
  if (!id) return
  input.store.set(id, input.previous)
}

/**
 * Pipeline ordering for a single recipient (documentation + test lock):
 * 1 rollout eligibility
 * 2 budget reservation (atomic)
 * 3 notificationEvents claim
 * 4 FCM send
 * 5a success → keep budget + mark event sent
 * 5b transient FCM fail → release event claim + release budget
 * 5c invalid token → release budget + disable token + mark event failed
 * duplicate claim after reserve → release budget
 */
export type NearbySendPipelineStep =
  | "rollout"
  | "budget_reserve"
  | "event_claim"
  | "fcm_send"
  | "budget_commit_or_release"
  | "event_complete"

export const NEARBY_SEND_PIPELINE_ORDER: readonly NearbySendPipelineStep[] = [
  "rollout",
  "budget_reserve",
  "event_claim",
  "fcm_send",
  "budget_commit_or_release",
  "event_complete",
] as const

export type NearbyBudgetFailureAction =
  | "keep_reservation"
  | "release_reservation"

export function nearbyBudgetActionAfterSend(input: {
  fcmSuccess: boolean
  permanentInvalidToken: boolean
  eventClaim: "claimed" | "duplicate"
}): NearbyBudgetFailureAction {
  if (input.eventClaim === "duplicate") return "release_reservation"
  if (input.fcmSuccess) return "keep_reservation"
  // Transient or invalid token: do not permanently consume undelivered budget.
  return "release_reservation"
}
