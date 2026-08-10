/**
 * TRN 058J — pure rollout eligibility (per subscription × report).
 * Never logs subscription ids / uids / geohashes.
 */

import {
  isNearbyCategorySendCapable,
} from "./policy"
import {
  isNearbyDeliveryLayerUnlocked,
  type NearbyNormalizedRolloutConfig,
  type NearbyRolloutStage,
} from "./rolloutConfig"

export type NearbyRolloutEligibilityInput = {
  compileTimeSendGate: boolean
  config: NearbyNormalizedRolloutConfig
  subscriptionId: string | null | undefined
  /** Coarse precision-6 geohash from subscription (not logged). */
  locationGeohash: string | null | undefined
  reportCategory: string | null | undefined
}

export type NearbyRolloutEligibilityResult = {
  eligible: boolean
  stage: NearbyRolloutStage
  reason:
    | "eligible"
    | "compile_gate_false"
    | "delivery_layers_locked"
    | "stage_0"
    | "missing_subscription_id"
    | "not_on_allowlist"
    | "unsupported_category"
    | "category_not_in_rollout"
    | "invalid_geography"
    | "geography_not_in_rollout"
    | "percent_bucket_closed"
    | "config_not_ok"
}

/** FNV-1a style deterministic 0–99 bucket (no Math.random). */
export function nearbyRolloutHashBucket(
  stableId: string,
  seed = ""
): number {
  const s = `${seed}:${stableId}`
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h) % 100
}

export function isInNearbyPercentBucket(
  stableId: string,
  percentOpen: number,
  seed = ""
): boolean {
  if (!(percentOpen > 0) || percentOpen > 100) return false
  if (!String(stableId || "").trim()) return false
  return nearbyRolloutHashBucket(stableId, seed) < percentOpen
}

function categoryAllowedByRollout(
  category: string | null | undefined,
  allowlist: readonly string[]
): boolean {
  const c = String(category || "").trim()
  if (!c) return false
  if (!isNearbyCategorySendCapable(c)) return false
  if (allowlist.length === 0) return true
  return allowlist.includes(c)
}

function geographyAllowedByRollout(
  locationGeohash: string | null | undefined,
  prefixes: readonly string[]
): boolean {
  if (prefixes.length === 0) return true
  const gh = String(locationGeohash || "").trim().toLowerCase()
  if (!gh || gh.length !== 6) return false
  if (!/^[0123456789bcdefghjkmnpqrstuvwxyz]+$/.test(gh)) return false
  return prefixes.some((p) => gh.startsWith(p.toLowerCase()))
}

export function evaluateNearbyRolloutEligibility(
  input: NearbyRolloutEligibilityInput
): NearbyRolloutEligibilityResult {
  const stage = input.config.stage
  if (input.compileTimeSendGate !== true) {
    return { eligible: false, stage, reason: "compile_gate_false" }
  }
  if (!isNearbyDeliveryLayerUnlocked({
    compileTimeSendGate: true,
    config: input.config,
  })) {
    if (stage === 0 || input.config.normalizeReason === "stage_0") {
      return { eligible: false, stage: 0, reason: "stage_0" }
    }
    return { eligible: false, stage, reason: "delivery_layers_locked" }
  }
  if (input.config.normalizeReason !== "ok") {
    return { eligible: false, stage: 0, reason: "config_not_ok" }
  }

  const subscriptionId = String(input.subscriptionId || "").trim()
  if (!subscriptionId) {
    return { eligible: false, stage, reason: "missing_subscription_id" }
  }

  if (stage === 1 || stage === 2) {
    if (!input.config.subscriptionAllowlist.includes(subscriptionId)) {
      return { eligible: false, stage, reason: "not_on_allowlist" }
    }
    if (!isNearbyCategorySendCapable(input.reportCategory)) {
      return { eligible: false, stage, reason: "unsupported_category" }
    }
    return { eligible: true, stage, reason: "eligible" }
  }

  if (stage === 3) {
    if (!categoryAllowedByRollout(input.reportCategory, input.config.categoryAllowlist)) {
      return {
        eligible: false,
        stage,
        reason: isNearbyCategorySendCapable(input.reportCategory)
          ? "category_not_in_rollout"
          : "unsupported_category",
      }
    }
    if (
      !geographyAllowedByRollout(
        input.locationGeohash,
        input.config.geohashAllowPrefixes
      )
    ) {
      const gh = String(input.locationGeohash || "").trim()
      return {
        eligible: false,
        stage,
        reason:
          !gh || gh.length !== 6
            ? "invalid_geography"
            : "geography_not_in_rollout",
      }
    }
    return { eligible: true, stage, reason: "eligible" }
  }

  if (stage === 4) {
    if (
      input.config.categoryAllowlist.length > 0 &&
      !categoryAllowedByRollout(input.reportCategory, input.config.categoryAllowlist)
    ) {
      return {
        eligible: false,
        stage,
        reason: isNearbyCategorySendCapable(input.reportCategory)
          ? "category_not_in_rollout"
          : "unsupported_category",
      }
    }
    if (
      input.config.geohashAllowPrefixes.length > 0 &&
      !geographyAllowedByRollout(
        input.locationGeohash,
        input.config.geohashAllowPrefixes
      )
    ) {
      const gh = String(input.locationGeohash || "").trim()
      return {
        eligible: false,
        stage,
        reason:
          !gh || gh.length !== 6
            ? "invalid_geography"
            : "geography_not_in_rollout",
      }
    }
    if (
      !isInNearbyPercentBucket(
        subscriptionId,
        input.config.percentOpen,
        input.config.percentSeed
      )
    ) {
      return { eligible: false, stage, reason: "percent_bucket_closed" }
    }
    if (!isNearbyCategorySendCapable(input.reportCategory)) {
      return { eligible: false, stage, reason: "unsupported_category" }
    }
    return { eligible: true, stage, reason: "eligible" }
  }

  return { eligible: false, stage: 0, reason: "stage_0" }
}

export function filterNearbyRolloutEligible<
  T extends {
    subscriptionId: string
    locationGeohash?: string | null
  },
>(input: {
  compileTimeSendGate: boolean
  config: NearbyNormalizedRolloutConfig
  reportCategory: string | null | undefined
  recipients: readonly T[]
}): { eligible: T[]; rejectedCount: number } {
  const eligible: T[] = []
  let rejectedCount = 0
  for (const r of input.recipients) {
    const d = evaluateNearbyRolloutEligibility({
      compileTimeSendGate: input.compileTimeSendGate,
      config: input.config,
      subscriptionId: r.subscriptionId,
      locationGeohash: r.locationGeohash,
      reportCategory: input.reportCategory,
    })
    if (d.eligible) eligible.push(r)
    else rejectedCount += 1
  }
  return { eligible, rejectedCount }
}
