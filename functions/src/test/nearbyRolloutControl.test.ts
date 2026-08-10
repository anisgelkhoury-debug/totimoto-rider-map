/**
 * TRN 058J — rollout control + budget foundation tests (no real FCM).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  applyNearbyBudgetReservation,
  createNearbyBudgetStore,
  decideNearbyBudget,
  EMPTY_NEARBY_BUDGET_STATE,
  nearbyBudgetActionAfterSend,
  NEARBY_BUDGET_POLICY,
  NEARBY_SEND_PIPELINE_ORDER,
  parseNearbyBudgetState,
  releaseNearbyBudgetSlot,
  reserveNearbyBudgetSlotAtomic,
} from "../nearby/nearbyBudget"
import {
  assertNearbyObservabilityPayloadSafe,
  buildNearbyObservabilityPayload,
} from "../nearby/nearbyObservability"
import { processNearbyReportCreated } from "../nearby/processNearbyReport"
import {
  isNearbyDeliveryLayerUnlocked,
  NEARBY_ROLLOUT_DEFAULT_CONFIG,
  normalizeNearbyRolloutConfig,
  readNearbyRolloutConfigSafe,
} from "../nearby/rolloutConfig"
import {
  evaluateNearbyRolloutEligibility,
  nearbyRolloutHashBucket,
} from "../nearby/rolloutEligibility"
import {
  ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND,
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
} from "../nearby/sendGate"
import {
  isNearbyCategorySendCapable,
  NEARBY_COOLDOWN_POLICY,
} from "../nearby/policy"

const ROOT = join(__dirname, "../../..")
const NOW = 1_700_000_000_000

describe("058J safety invariants", () => {
  it("1. production master gate remains false", () => {
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
    assert.equal(NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS.size, 0)
  })

  it("2–6. Stage 0 / missing / malformed / unknown / empty allowlist reject everybody", () => {
    assert.equal(normalizeNearbyRolloutConfig(null).stage, 0)
    assert.equal(normalizeNearbyRolloutConfig(undefined).stage, 0)
    assert.equal(normalizeNearbyRolloutConfig({ stage: 99 }).stage, 0)
    assert.equal(normalizeNearbyRolloutConfig({ stage: "nope" }).stage, 0)
    assert.equal(
      normalizeNearbyRolloutConfig({
        enabled: true,
        stage: 1,
        subscriptionAllowlist: [],
      }).stage,
      0
    )
    assert.equal(NEARBY_ROLLOUT_DEFAULT_CONFIG.stage, 0)
    assert.equal(
      evaluateNearbyRolloutEligibility({
        compileTimeSendGate: true,
        config: NEARBY_ROLLOUT_DEFAULT_CONFIG,
        subscriptionId: "sub-1",
        locationGeohash: "sy10zf",
        reportCategory: "accident",
      }).eligible,
      false
    )
  })

  it("7. gate true alone cannot enable everybody", () => {
    assert.equal(
      isNearbyDeliveryLayerUnlocked({
        compileTimeSendGate: true,
        config: NEARBY_ROLLOUT_DEFAULT_CONFIG,
      }),
      false
    )
    const cfg = normalizeNearbyRolloutConfig({
      enabled: true,
      stage: 4,
      percentOpen: 100,
    })
    // Still need category send-capable + percent; but layers unlock.
    assert.equal(
      isNearbyDeliveryLayerUnlocked({
        compileTimeSendGate: true,
        config: cfg,
      }),
      true
    )
    // Empty canary still blocks process path; gate compile constant remains false.
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
  })

  it("8–9. deterministic percent bucket; missing id fails closed", () => {
    const a = nearbyRolloutHashBucket("sub-stable", "seed")
    const b = nearbyRolloutHashBucket("sub-stable", "seed")
    assert.equal(a, b)
    const cfg = normalizeNearbyRolloutConfig({
      enabled: true,
      stage: 4,
      percentOpen: 50,
      percentSeed: "seed",
    })
    assert.equal(
      evaluateNearbyRolloutEligibility({
        compileTimeSendGate: true,
        config: cfg,
        subscriptionId: "",
        locationGeohash: "sy10zf",
        reportCategory: "accident",
      }).reason,
      "missing_subscription_id"
    )
  })

  it("10–11. unsupported category / invalid geography fail closed", () => {
    const cfg = normalizeNearbyRolloutConfig({
      enabled: true,
      stage: 3,
      categoryAllowlist: ["accident"],
      geohashAllowPrefixes: ["sy"],
    })
    assert.equal(cfg.normalizeReason, "ok")
    assert.equal(
      evaluateNearbyRolloutEligibility({
        compileTimeSendGate: true,
        config: cfg,
        subscriptionId: "s1",
        locationGeohash: "sy10zf",
        reportCategory: "traffic",
      }).eligible,
      false
    )
    assert.equal(
      evaluateNearbyRolloutEligibility({
        compileTimeSendGate: true,
        config: cfg,
        subscriptionId: "s1",
        locationGeohash: "bad",
        reportCategory: "accident",
      }).reason,
      "invalid_geography"
    )
  })
})

describe("058J budget decisions", () => {
  it("12–17. hourly/daily/medium/high/critical/allow", () => {
    assert.equal(
      decideNearbyBudget({
        state: {
          ...EMPTY_NEARBY_BUDGET_STATE,
          hourWindowStartMs: NOW - 1000,
          hourCount: 3,
        },
        severity: "HIGH",
        nowMs: NOW,
      }).reason,
      "REJECT_HOURLY_BUDGET"
    )
    assert.equal(
      decideNearbyBudget({
        state: {
          ...EMPTY_NEARBY_BUDGET_STATE,
          dayWindowStartMs: NOW - 1000,
          dayCount: 12,
        },
        severity: "HIGH",
        nowMs: NOW,
      }).reason,
      "REJECT_DAILY_BUDGET"
    )
    assert.equal(
      decideNearbyBudget({
        state: {
          ...EMPTY_NEARBY_BUDGET_STATE,
          lastSentAtMs: NOW - 5 * 60 * 1000,
        },
        severity: "MEDIUM",
        nowMs: NOW,
      }).reason,
      "REJECT_MEDIUM_INTERVAL"
    )
    assert.equal(
      decideNearbyBudget({
        state: {
          ...EMPTY_NEARBY_BUDGET_STATE,
          lastSentAtMs: NOW - 5 * 60 * 1000,
        },
        severity: "HIGH",
        nowMs: NOW,
      }).reason,
      "REJECT_HIGH_INTERVAL"
    )
    assert.equal(
      decideNearbyBudget({
        state: {
          ...EMPTY_NEARBY_BUDGET_STATE,
          criticalWindowStartMs: NOW - 1000,
          criticalCount: 2,
          hourWindowStartMs: NOW,
          hourCount: 0,
          dayWindowStartMs: NOW,
          dayCount: 0,
        },
        severity: "CRITICAL",
        nowMs: NOW,
      }).reason,
      "REJECT_CRITICAL_WINDOW"
    )
    assert.equal(
      decideNearbyBudget({
        state: EMPTY_NEARBY_BUDGET_STATE,
        severity: "HIGH",
        nowMs: NOW,
      }).reason,
      "ALLOW"
    )
  })

  it("18. malformed budget fails closed", () => {
    assert.equal(parseNearbyBudgetState({ hourCount: -1 }).ok, false)
    assert.equal(
      decideNearbyBudget({
        state: {
          ...EMPTY_NEARBY_BUDGET_STATE,
          hourCount: Number.NaN,
        },
        severity: "HIGH",
        nowMs: NOW,
      }).reason,
      "REJECT_INVALID_BUDGET_STATE"
    )
  })

  it("CRITICAL still respects hourly budget (safer fail-closed)", () => {
    assert.equal(NEARBY_BUDGET_POLICY.criticalBypassesHourlyDaily, false)
    assert.equal(
      decideNearbyBudget({
        state: {
          ...EMPTY_NEARBY_BUDGET_STATE,
          hourWindowStartMs: NOW,
          hourCount: 3,
        },
        severity: "CRITICAL",
        nowMs: NOW,
      }).reason,
      "REJECT_HOURLY_BUDGET"
    )
  })

  it("atomic reservation: concurrent reports share one remaining slot", () => {
    const store = createNearbyBudgetStore()
    store.set("device-b", {
      ...EMPTY_NEARBY_BUDGET_STATE,
      hourWindowStartMs: NOW,
      hourCount: 2,
      dayWindowStartMs: NOW,
      dayCount: 2,
    })
    const a = reserveNearbyBudgetSlotAtomic({
      store,
      subscriptionId: "device-b",
      severity: "HIGH",
      nowMs: NOW,
    })
    const b = reserveNearbyBudgetSlotAtomic({
      store,
      subscriptionId: "device-b",
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(a.reserved, true)
    assert.equal(b.reserved, false)
    assert.equal(b.reason, "REJECT_HOURLY_BUDGET")
    assert.equal(store.get("device-b")?.hourCount, 3)
  })

  it("retry semantics: transient failure releases reservation", () => {
    assert.equal(
      nearbyBudgetActionAfterSend({
        fcmSuccess: false,
        permanentInvalidToken: false,
        eventClaim: "claimed",
      }),
      "release_reservation"
    )
    assert.equal(
      nearbyBudgetActionAfterSend({
        fcmSuccess: false,
        permanentInvalidToken: true,
        eventClaim: "claimed",
      }),
      "release_reservation"
    )
    assert.equal(
      nearbyBudgetActionAfterSend({
        fcmSuccess: true,
        permanentInvalidToken: false,
        eventClaim: "claimed",
      }),
      "keep_reservation"
    )
    const store = createNearbyBudgetStore()
    const reserved = reserveNearbyBudgetSlotAtomic({
      store,
      subscriptionId: "s1",
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(reserved.reserved, true)
    releaseNearbyBudgetSlot({
      store,
      subscriptionId: "s1",
      previous: reserved.previous,
    })
    assert.equal(store.get("s1")?.hourCount, 0)
  })

  it("pipeline order locked", () => {
    assert.deepEqual(NEARBY_SEND_PIPELINE_ORDER, [
      "rollout",
      "budget_reserve",
      "event_claim",
      "fcm_send",
      "budget_commit_or_release",
      "event_complete",
    ])
    const applied = applyNearbyBudgetReservation(
      EMPTY_NEARBY_BUDGET_STATE,
      "CRITICAL",
      NOW
    )
    assert.equal(applied.ok, true)
    if (applied.ok) assert.equal(applied.next.criticalCount, 1)
  })
})

describe("058J observability + isolation", () => {
  it("observability payload has no PII key fragments", () => {
    const payload = buildNearbyObservabilityPayload({
      category: "accident",
      sendGate: false,
      rolloutStage: 0,
      counts: {
        candidateCount: 1,
        eligibleCount: 1,
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
      },
    })
    assert.equal(assertNearbyObservabilityPayloadSafe(payload), true)
    assert.equal(payload.sendGate, false)
  })

  it("31. assistance lifecycle sender does not use nearby budget", () => {
    const life = readFileSync(
      join(ROOT, "functions/src/shared/processLifecycle.ts"),
      "utf8"
    )
    assert.equal(life.includes("nearbyBudget"), false)
    assert.equal(life.includes("nearbyNotificationBudget"), false)
    assert.equal(life.includes("rolloutConfig"), false)
    const index = readFileSync(join(ROOT, "functions/src/index.ts"), "utf8")
    assert.match(index, /onReportLifecycleUpdated/)
    assert.match(index, /onReportOwnerCancelled/)
  })

  it("22–30. category policy preserved", () => {
    assert.equal(isNearbyCategorySendCapable("accident"), true)
    assert.equal(isNearbyCategorySendCapable("checkpoint"), false)
    assert.equal(isNearbyCategorySendCapable("road_closed"), false)
    assert.equal(isNearbyCategorySendCapable("slippery_road"), false)
    assert.equal(isNearbyCategorySendCapable("traffic"), false)
    assert.equal(isNearbyCategorySendCapable("stolen"), false)
    assert.equal(isNearbyCategorySendCapable("marketplace"), false)
  })

  it("37. gate false keeps process dry_run with zero FCM", async () => {
    const out = await processNearbyReportCreated(
      "r1",
      {
        ownerUid: "o",
        reportCategory: "accident",
        reportFamily: "intelligence",
        resolved: false,
        lat: 33.89,
        lng: 35.5,
        createdAt: NOW,
      },
      {
        listSubscriptionsByGeohashRange: async () => [
          {
            id: "a",
            uid: "u",
            enabled: true,
            permissionState: "granted",
            token: "t",
            locationGeohash: "sy10zf",
            locationUpdatedAt: NOW,
            notificationPreferences: {
              nearbyAlerts: true,
              accident: true,
              checkpoint: true,
              roadClosed: true,
              slippery: true,
              importantIncidents: true,
            },
          },
        ],
        claimEventOnce: async () => "claimed",
        sendDataMessage: async () => {
          throw new Error("must not send")
        },
        disableSubscription: async () => undefined,
        allowSend: false,
        now: () => NOW,
      }
    )
    assert.equal(out.status, "dry_run")
    assert.equal(out.sendGate, false)
    assert.equal(out.attempted, 0)
  })

  it("readNearbyRolloutConfigSafe fails closed on throw", async () => {
    const cfg = await readNearbyRolloutConfigSafe(async () => {
      throw new Error("boom")
    })
    assert.equal(cfg.stage, 0)
    assert.equal(cfg.normalizeReason, "rollout_config_read_failed")
  })

  it("cooldown mode documents hybrid helpers; gate constant false in source", () => {
    assert.equal(NEARBY_COOLDOWN_POLICY.mode, "hybrid_f_v1_helpers")
    const gateSrc = readFileSync(
      join(ROOT, "functions/src/nearby/sendGate.ts"),
      "utf8"
    )
    assert.match(
      gateSrc,
      /ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND:\s*boolean\s*=\s*false/
    )
  })
})
