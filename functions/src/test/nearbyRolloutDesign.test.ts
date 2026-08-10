/**
 * TRN 058I — pure rollout design helper tests (no production send wiring).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND } from "../nearby/sendGate"
import {
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
  nearbyCanaryAllowlistSize,
} from "../nearby/sendGate"
import {
  buildNearbyObservabilityPayload,
  decideNearbyCooldown,
  emptyAllowlistMeansNobody,
  isInNearbyPercentBucket,
  isSubscriptionOnNearbyAllowlist,
  nearbyRolloutHashBucket,
  validateNearbyRolloutConfig,
  type NearbyRolloutConfig,
} from "../nearby/rolloutDesign"
import { NEARBY_COOLDOWN_POLICY } from "../nearby/policy"

const ROOT = join(__dirname, "../../..")

describe("058I rollout design helpers", () => {
  it("production send gate remains false; allowlist empty", () => {
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
    assert.equal(nearbyCanaryAllowlistSize(), 0)
    assert.equal(NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS.size, 0)
    assert.equal(emptyAllowlistMeansNobody(0), true)
  })

  it("missing / invalid rollout config fails closed", () => {
    assert.equal(validateNearbyRolloutConfig(null).ok, false)
    assert.equal(validateNearbyRolloutConfig(undefined).ok, false)
    assert.equal(
      validateNearbyRolloutConfig({
        stage: 9 as never,
        subscriptionAllowlist: ["x"],
      }).reason,
      "invalid_rollout_stage"
    )
  })

  it("stage 0 always closed", () => {
    const d = validateNearbyRolloutConfig({
      stage: 0,
      subscriptionAllowlist: ["a"],
    })
    assert.equal(d.ok, false)
    assert.equal(d.reason, "stage_0_gate_off")
  })

  it("empty allowlist cannot mean everybody (stages 1–2)", () => {
    const d = validateNearbyRolloutConfig({
      stage: 1,
      subscriptionAllowlist: [],
    })
    assert.equal(d.ok, false)
    assert.equal(d.reason, "empty_allowlist_fail_closed")
  })

  it("stage 1–2 with allowlist validates", () => {
    const cfg: NearbyRolloutConfig = {
      stage: 2,
      subscriptionAllowlist: ["sub-a"],
    }
    assert.equal(validateNearbyRolloutConfig(cfg).ok, true)
    assert.equal(isSubscriptionOnNearbyAllowlist("sub-a", cfg.subscriptionAllowlist), true)
    assert.equal(isSubscriptionOnNearbyAllowlist("sub-b", cfg.subscriptionAllowlist), false)
  })

  it("stage 4 percent 0 fails closed; bucket is deterministic", () => {
    assert.equal(
      validateNearbyRolloutConfig({
        stage: 4,
        subscriptionAllowlist: [],
        percentOpen: 0,
      }).ok,
      false
    )
    const a = nearbyRolloutHashBucket("device-xyz")
    const b = nearbyRolloutHashBucket("device-xyz")
    assert.equal(a, b)
    assert.ok(a >= 0 && a < 100)
    assert.equal(isInNearbyPercentBucket("device-xyz", 0), false)
  })

  it("cooldown budgets: soft hourly / daily / intervals / critical cap", () => {
    const now = 1_700_000_000_000
    assert.equal(
      decideNearbyCooldown({
        severity: "MEDIUM",
        lastNearbySentAtMs: now - 5 * 60 * 1000,
        nearbySentInLastHour: 0,
        nearbySentInLastDay: 0,
        criticalSentInLast30Min: 0,
        nowMs: now,
      }).reason,
      "medium_interval"
    )
    assert.equal(
      decideNearbyCooldown({
        severity: "HIGH",
        lastNearbySentAtMs: null,
        nearbySentInLastHour: 3,
        nearbySentInLastDay: 3,
        criticalSentInLast30Min: 0,
        nowMs: now,
      }).reason,
      "soft_hourly_budget"
    )
    assert.equal(
      decideNearbyCooldown({
        severity: "CRITICAL",
        lastNearbySentAtMs: now - 1000,
        nearbySentInLastHour: 0,
        nearbySentInLastDay: 0,
        criticalSentInLast30Min: 2,
        nowMs: now,
      }).reason,
      "critical_cap"
    )
    assert.equal(
      decideNearbyCooldown({
        severity: "CRITICAL",
        lastNearbySentAtMs: now - 1000,
        nearbySentInLastHour: 0,
        nearbySentInLastDay: 0,
        criticalSentInLast30Min: 1,
        nowMs: now,
      }).allow,
      true
    )
  })

  it("observability payload has no token/coord/geohash keys", () => {
    const payload = buildNearbyObservabilityPayload({
      category: "accident",
      sendGate: false,
      stage: 0,
      counts: {
        candidateCount: 1,
        eligibleCount: 1,
        rolloutEligibleCount: 0,
        cooldownRejectedCount: 0,
        staleLocationRejectedCount: 0,
        preferenceRejectedCount: 0,
        selfExcludedCount: 0,
        dedupeRejectedCount: 0,
        attempted: 0,
        success: 0,
        failed: 0,
        disabledTokens: 0,
      },
    })
    const keys = Object.keys(payload).join(",")
    assert.equal(keys.includes("token"), false)
    assert.equal(keys.includes("lat"), false)
    assert.equal(keys.includes("geohash"), false)
    assert.equal(payload.sendGate, false)
    assert.equal(payload.rolloutStage, 0)
  })

  it("hard dedupe policy unchanged; processNearbyReport not importing rolloutDesign", () => {
    assert.equal(NEARBY_COOLDOWN_POLICY.mode, "postponed_v1")
    assert.match(
      NEARBY_COOLDOWN_POLICY.hardDedupe,
      /nearby_report:\{reportId\}:\{subscriptionId\}/
    )
    const processSrc = readFileSync(
      join(ROOT, "functions/src/nearby/processNearbyReport.ts"),
      "utf8"
    )
    assert.equal(processSrc.includes("rolloutDesign"), false)
    const indexSrc = readFileSync(join(ROOT, "functions/src/index.ts"), "utf8")
    assert.equal(indexSrc.includes("rolloutDesign"), false)
  })

  it("no-push categories and traffic remain out of send-capable lists", () => {
    const policy = readFileSync(
      join(ROOT, "functions/src/nearby/policy.ts"),
      "utf8"
    )
    assert.doesNotMatch(policy, /"traffic"/)
    assert.doesNotMatch(policy, /"stolen"/)
    assert.doesNotMatch(policy, /"marketplace"/)
  })
})
