/**
 * TRN 058J — privacy-safe nearby outcome metrics (pure).
 * Never include tokens, lat/lng, geohashes, phones, emails, full uids, or full subscription ids.
 */

import type { NearbyRolloutStage } from "./rolloutConfig"

export type NearbyObservabilityCounts = {
  candidateCount: number
  eligibleCount: number
  rolloutRejectedCount: number
  rolloutEligibleCount: number
  cooldownRejectedCount: number
  hourlyBudgetRejectedCount: number
  dailyBudgetRejectedCount: number
  criticalWindowRejectedCount: number
  staleLocationRejectedCount: number
  preferenceRejectedCount: number
  selfExcludedCount: number
  dedupeRejectedCount: number
  attempted: number
  success: number
  failed: number
  disabledTokens: number
}

export const EMPTY_NEARBY_OBSERVABILITY_COUNTS: NearbyObservabilityCounts = {
  candidateCount: 0,
  eligibleCount: 0,
  rolloutRejectedCount: 0,
  rolloutEligibleCount: 0,
  cooldownRejectedCount: 0,
  hourlyBudgetRejectedCount: 0,
  dailyBudgetRejectedCount: 0,
  criticalWindowRejectedCount: 0,
  staleLocationRejectedCount: 0,
  preferenceRejectedCount: 0,
  selfExcludedCount: 0,
  dedupeRejectedCount: 0,
  attempted: 0,
  success: 0,
  failed: 0,
  disabledTokens: 0,
}

const ALLOWED_OBSERVABILITY_KEYS = new Set([
  "category",
  "sendGate",
  "rolloutStage",
  "candidateCount",
  "eligibleCount",
  "rolloutRejectedCount",
  "rolloutEligibleCount",
  "cooldownRejectedCount",
  "hourlyBudgetRejectedCount",
  "dailyBudgetRejectedCount",
  "criticalWindowRejectedCount",
  "staleLocationRejectedCount",
  "preferenceRejectedCount",
  "selfExcludedCount",
  "dedupeRejectedCount",
  "attempted",
  "success",
  "failed",
  "disabledTokens",
])

export function buildNearbyObservabilityPayload(input: {
  category: string
  sendGate: boolean
  rolloutStage: NearbyRolloutStage
  counts: NearbyObservabilityCounts
}): Record<string, string | number | boolean> {
  return {
    category: String(input.category || ""),
    sendGate: input.sendGate === true,
    rolloutStage: input.rolloutStage,
    candidateCount: input.counts.candidateCount,
    eligibleCount: input.counts.eligibleCount,
    rolloutRejectedCount: input.counts.rolloutRejectedCount,
    rolloutEligibleCount: input.counts.rolloutEligibleCount,
    cooldownRejectedCount: input.counts.cooldownRejectedCount,
    hourlyBudgetRejectedCount: input.counts.hourlyBudgetRejectedCount,
    dailyBudgetRejectedCount: input.counts.dailyBudgetRejectedCount,
    criticalWindowRejectedCount: input.counts.criticalWindowRejectedCount,
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

export function assertNearbyObservabilityPayloadSafe(
  payload: Record<string, unknown>
): boolean {
  for (const key of Object.keys(payload)) {
    if (!ALLOWED_OBSERVABILITY_KEYS.has(key)) return false
  }
  return true
}
