/**
 * TRN 058I — pure limited-rollout design helpers (NOT wired to production send).
 *
 * Locks fail-closed stage/config validation, proposed cooldown budgets,
 * deterministic hashing, and privacy-safe outcome aggregation for future 058J.
 */

import type { NearbySeverity } from "./policy"

/** Explicit rollout stages — Stage 0 is production-safe (no real nearby FCM). */
export type NearbyRolloutStage = 0 | 1 | 2 | 3 | 4

export const NEARBY_ROLLOUT_STAGE_LABELS: Record<NearbyRolloutStage, string> = {
  0: "gate_off",
  1: "anis_test_devices",
  2: "manual_allowlist",
  3: "limited_geo_or_category",
  4: "wider_opted_in_percent",
}

/**
 * Proposed V1 soft budgets (design lock). Enforcement belongs in 058J —
 * not applied by onReportCreatedNearbyNotify today.
 */
export const NEARBY_BUDGET_PROPOSAL = {
  softHourlyMax: 3,
  softDailyMax: 12,
  mediumMinIntervalMs: 20 * 60 * 1000,
  highMinIntervalMs: 10 * 60 * 1000,
  /** CRITICAL may bypass ordinary interval but still hard-dedupe per report×sub. */
  criticalBypassesOrdinaryInterval: true,
  /** Absolute safety: never more than this CRITICAL pushes / 30 min even with bypass. */
  criticalMaxPer30Min: 2,
} as const

export type NearbyRolloutConfig = {
  stage: NearbyRolloutStage
  /** Subscription document ids allowed when stage is 1 or 2. */
  subscriptionAllowlist: readonly string[]
  /** Optional geohash prefixes (precision ≤6) when stage is 3. */
  geohashAllowPrefixes?: readonly string[]
  /** Optional send-capable categories when stage is 3. */
  categoryAllowlist?: readonly string[]
  /** 0–100 for stage 4 deterministic bucketing; 0 = nobody. */
  percentOpen?: number
}

export type NearbyRolloutDecision =
  | { ok: true; stage: NearbyRolloutStage; reason: "eligible" }
  | { ok: false; stage: NearbyRolloutStage | null; reason: string }

/** Fail-closed: missing/invalid config never means "everybody". */
export function validateNearbyRolloutConfig(
  config: NearbyRolloutConfig | null | undefined
): NearbyRolloutDecision {
  if (!config || typeof config !== "object") {
    return { ok: false, stage: null, reason: "missing_rollout_config" }
  }
  const stage = config.stage
  if (stage !== 0 && stage !== 1 && stage !== 2 && stage !== 3 && stage !== 4) {
    return { ok: false, stage: null, reason: "invalid_rollout_stage" }
  }
  if (stage === 0) {
    return { ok: false, stage: 0, reason: "stage_0_gate_off" }
  }
  const list = Array.isArray(config.subscriptionAllowlist)
    ? config.subscriptionAllowlist.map((s) => String(s || "").trim()).filter(Boolean)
    : []
  if (stage === 1 || stage === 2) {
    if (list.length === 0) {
      return { ok: false, stage, reason: "empty_allowlist_fail_closed" }
    }
  }
  if (stage === 3) {
    const prefixes = Array.isArray(config.geohashAllowPrefixes)
      ? config.geohashAllowPrefixes
      : []
    const cats = Array.isArray(config.categoryAllowlist)
      ? config.categoryAllowlist
      : []
    if (prefixes.length === 0 && cats.length === 0 && list.length === 0) {
      return { ok: false, stage, reason: "stage_3_no_scope_fail_closed" }
    }
  }
  if (stage === 4) {
    const pct =
      typeof config.percentOpen === "number" && Number.isFinite(config.percentOpen)
        ? config.percentOpen
        : -1
    if (pct <= 0 || pct > 100) {
      return { ok: false, stage, reason: "stage_4_percent_closed" }
    }
  }
  return { ok: true, stage, reason: "eligible" }
}

/**
 * Deterministic 0–99 bucket from a stable id (subscriptionId or uid).
 * Used for Stage 4 percentage rollout — not wired to send yet.
 */
export function nearbyRolloutHashBucket(stableId: string): number {
  const s = String(stableId || "")
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % 100
}

export function isInNearbyPercentBucket(
  stableId: string,
  percentOpen: number
): boolean {
  if (!(percentOpen > 0) || percentOpen > 100) return false
  return nearbyRolloutHashBucket(stableId) < percentOpen
}

export function isSubscriptionOnNearbyAllowlist(
  subscriptionId: string | null | undefined,
  allowlist: readonly string[]
): boolean {
  const id = String(subscriptionId || "").trim()
  if (!id || !Array.isArray(allowlist) || allowlist.length === 0) return false
  return allowlist.includes(id)
}

/**
 * Empty allowlist must never mean "all recipients".
 * Mirrors production canary Set([]) semantics.
 */
export function emptyAllowlistMeansNobody(allowlistSize: number): boolean {
  return allowlistSize === 0
}

export type CooldownDecisionInput = {
  severity: NearbySeverity
  lastNearbySentAtMs: number | null
  nearbySentInLastHour: number
  nearbySentInLastDay: number
  criticalSentInLast30Min: number
  nowMs: number
  budgets?: typeof NEARBY_BUDGET_PROPOSAL
}

export type CooldownDecision = {
  allow: boolean
  reason:
    | "ok"
    | "soft_hourly_budget"
    | "soft_daily_budget"
    | "medium_interval"
    | "high_interval"
    | "critical_cap"
}

/** Pure proposed cooldown decision — not applied in production send path. */
export function decideNearbyCooldown(
  input: CooldownDecisionInput
): CooldownDecision {
  const b = input.budgets ?? NEARBY_BUDGET_PROPOSAL
  if (input.nearbySentInLastDay >= b.softDailyMax) {
    return { allow: false, reason: "soft_daily_budget" }
  }
  if (input.nearbySentInLastHour >= b.softHourlyMax) {
    return { allow: false, reason: "soft_hourly_budget" }
  }

  if (input.severity === "CRITICAL") {
    if (input.criticalSentInLast30Min >= b.criticalMaxPer30Min) {
      return { allow: false, reason: "critical_cap" }
    }
    return { allow: true, reason: "ok" }
  }

  const last = input.lastNearbySentAtMs
  if (last != null && Number.isFinite(last)) {
    const gap = input.nowMs - last
    if (input.severity === "MEDIUM" && gap < b.mediumMinIntervalMs) {
      return { allow: false, reason: "medium_interval" }
    }
    if (input.severity === "HIGH" && gap < b.highMinIntervalMs) {
      return { allow: false, reason: "high_interval" }
    }
  }
  return { allow: true, reason: "ok" }
}

export type NearbyObservabilityCounts = {
  candidateCount: number
  eligibleCount: number
  rolloutEligibleCount: number
  cooldownRejectedCount: number
  staleLocationRejectedCount: number
  preferenceRejectedCount: number
  selfExcludedCount: number
  dedupeRejectedCount: number
  attempted: number
  success: number
  failed: number
  disabledTokens: number
}

/** Privacy-safe log/metric shape — never include tokens/coords/geohashes/uids. */
export function buildNearbyObservabilityPayload(input: {
  category: string
  sendGate: boolean
  stage: NearbyRolloutStage
  counts: NearbyObservabilityCounts
}): Record<string, string | number | boolean> {
  return {
    category: String(input.category || ""),
    sendGate: input.sendGate === true,
    rolloutStage: input.stage,
    candidateCount: input.counts.candidateCount,
    eligibleCount: input.counts.eligibleCount,
    rolloutEligibleCount: input.counts.rolloutEligibleCount,
    cooldownRejectedCount: input.counts.cooldownRejectedCount,
    staleLocationRejectedCount: input.counts.staleLocationRejectedCount,
    preferenceRejectedCount: input.counts.preferenceRejectedCount,
    selfExcludedCount: input.counts.selfExcludedCount,
    dedupeRejectedCount: input.counts.dedupeRejectedCount,
    attempted: input.counts.attempted,
    success: input.counts.success,
    failed: input.counts.failed,
    disabledTokens: input.counts.disabledTokens,
  }
}

/** Order-of-magnitude cost sketch inputs for design doc / tests. */
export const NEARBY_COST_MODEL_ASSUMPTIONS = {
  heartbeatWritesPerOptedInPerDay: 24 / (15 / 60), // ~96 if always foreground — use lower ops estimate
  heartbeatWritesPerActiveOptedInPerDay: 16,
  accidentCreatesPerDayDenseCity: 40,
  avgGeoRangeQueriesPerAccident: 6,
  avgSubscriptionDocsReadPerAccidentAt1k: 8,
  fcmPerEligibleWhenGateOpen: 1,
} as const
