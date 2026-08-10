/**
 * TRN 058K — Firestore rollout config + atomic budget tests (no real FCM).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  buildNearbyBudgetReservationId,
  deserializeNearbyBudgetDoc,
  serializeNearbyBudgetDoc,
} from "../nearby/budgetPersistence"
import {
  applyCommitNearbyBudgetTransactionBody,
  applyReleaseNearbyBudgetTransactionBody,
  applyReserveNearbyBudgetTransactionBody,
  concurrentReserveRaceHarness,
} from "../nearby/firestoreBudget"
import {
  getCachedNearbyOpsConfig,
  loadNearbyOpsRolloutConfig,
  mapNearbyOpsConfigRaw,
  NEARBY_OPS_CONFIG_CACHE_TTL_MS,
  resetNearbyOpsConfigCache,
} from "../nearby/opsRolloutConfig"
import { processNearbyReportCreated } from "../nearby/processNearbyReport"
import { ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND } from "../nearby/sendGate"
import { normalizeNearbyRolloutConfig } from "../nearby/rolloutConfig"

const ROOT = join(__dirname, "../../..")
const NOW = 1_700_000_000_000

describe("058K ops config + cache", () => {
  it("3–7. missing/malformed/disabled/empty allowlist → Stage 0", () => {
    assert.equal(normalizeNearbyRolloutConfig(null).stage, 0)
    assert.equal(normalizeNearbyRolloutConfig({ stage: "x" }).stage, 0)
    assert.equal(
      normalizeNearbyRolloutConfig({ enabled: false, stage: 2 }).stage,
      0
    )
    assert.equal(
      normalizeNearbyRolloutConfig({
        enabled: true,
        stage: 1,
        allowlistedSubscriptionIds: [],
      }).stage,
      0
    )
    const mapped = mapNearbyOpsConfigRaw({
      enabled: true,
      stage: 1,
      allowlistedSubscriptionIds: [],
    })
    assert.equal(normalizeNearbyRolloutConfig(mapped).stage, 0)
  })

  it("8–10. Stage 3 both required; Stage 4 percent; invalid percent", () => {
    assert.equal(
      normalizeNearbyRolloutConfig({
        enabled: true,
        stage: 3,
        allowedCategories: ["accident"],
        allowedGeoPrefixes: [],
      }).stage,
      0
    )
    assert.equal(
      normalizeNearbyRolloutConfig(
        mapNearbyOpsConfigRaw({
          enabled: true,
          stage: 3,
          allowedCategories: ["accident"],
          allowedGeoPrefixes: ["sy"],
        })
      ).normalizeReason,
      "ok"
    )
    assert.equal(
      normalizeNearbyRolloutConfig({
        enabled: true,
        stage: 4,
        percentage: 0,
      }).stage,
      0
    )
  })

  it("11–12. cache TTL + expiry failure → Stage 0", async () => {
    resetNearbyOpsConfigCache()
    let reads = 0
    const cfg1 = await loadNearbyOpsRolloutConfig({
      nowMs: NOW,
      ttlMs: 1000,
      fetchRaw: async () => {
        reads += 1
        return {
          enabled: true,
          stage: 1,
          allowlistedSubscriptionIds: ["a"],
        }
      },
    })
    assert.equal(cfg1.stage, 1)
    assert.equal(reads, 1)
    const cached = getCachedNearbyOpsConfig(NOW + 500)
    assert.equal(cached?.stage, 1)
    assert.equal(getCachedNearbyOpsConfig(NOW + 2000), null)

    const cfgFail = await loadNearbyOpsRolloutConfig({
      nowMs: NOW + 2000,
      ttlMs: 1000,
      fetchRaw: async () => {
        throw new Error("boom")
      },
    })
    assert.equal(cfgFail.stage, 0)
    assert.equal(cfgFail.normalizeReason, "rollout_config_read_failed")
    assert.equal(NEARBY_OPS_CONFIG_CACHE_TTL_MS, 45_000)
  })
})

describe("058K atomic budget transaction body", () => {
  it("13–20. reserve / reject / critical / concurrent one slot", () => {
    const initial = serializeNearbyBudgetDoc(
      {
        hourWindowStartMs: NOW,
        hourCount: 2,
        dayWindowStartMs: NOW,
        dayCount: 2,
        lastSentAtMs: NOW - 60_000 * 15,
        criticalWindowStartMs: null,
        criticalCount: 0,
      },
      {}
    )
    const race = concurrentReserveRaceHarness({
      initialBudgetRaw: initial,
      reservationIds: [
        "nearby_budget:rA:device-b",
        "nearby_budget:rB:device-b",
      ],
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(race.first.reserved, true)
    assert.equal(race.second.reserved, false)
    assert.equal(race.second.reason, "REJECT_HOURLY_BUDGET")
    assert.equal(race.finalHourlyCount, 3)

    const daily = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: serializeNearbyBudgetDoc(
        {
          hourWindowStartMs: NOW,
          hourCount: 0,
          dayWindowStartMs: NOW,
          dayCount: 12,
          lastSentAtMs: null,
          criticalWindowStartMs: null,
          criticalCount: 0,
        },
        {}
      ),
      reservationId: "nearby_budget:r1:s1",
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(daily.result.reason, "REJECT_DAILY_BUDGET")

    const medium = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: serializeNearbyBudgetDoc(
        {
          hourWindowStartMs: NOW,
          hourCount: 0,
          dayWindowStartMs: NOW,
          dayCount: 0,
          lastSentAtMs: NOW - 5 * 60_000,
          criticalWindowStartMs: null,
          criticalCount: 0,
        },
        {}
      ),
      reservationId: "x",
      severity: "MEDIUM",
      nowMs: NOW,
    })
    assert.equal(medium.result.reason, "REJECT_MEDIUM_INTERVAL")

    const high = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: serializeNearbyBudgetDoc(
        {
          hourWindowStartMs: NOW,
          hourCount: 0,
          dayWindowStartMs: NOW,
          dayCount: 0,
          lastSentAtMs: NOW - 5 * 60_000,
          criticalWindowStartMs: null,
          criticalCount: 0,
        },
        {}
      ),
      reservationId: "y",
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(high.result.reason, "REJECT_HIGH_INTERVAL")

    const critCap = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: serializeNearbyBudgetDoc(
        {
          hourWindowStartMs: NOW,
          hourCount: 0,
          dayWindowStartMs: NOW,
          dayCount: 0,
          lastSentAtMs: NOW - 1000,
          criticalWindowStartMs: NOW,
          criticalCount: 2,
        },
        {}
      ),
      reservationId: "z",
      severity: "CRITICAL",
      nowMs: NOW,
    })
    assert.equal(critCap.result.reason, "REJECT_CRITICAL_WINDOW")

    const critHourly = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: serializeNearbyBudgetDoc(
        {
          hourWindowStartMs: NOW,
          hourCount: 3,
          dayWindowStartMs: NOW,
          dayCount: 3,
          lastSentAtMs: null,
          criticalWindowStartMs: null,
          criticalCount: 0,
        },
        {}
      ),
      reservationId: "c",
      severity: "CRITICAL",
      nowMs: NOW,
    })
    assert.equal(critHourly.result.reason, "REJECT_HOURLY_BUDGET")
  })

  it("21. same reservation retry does not consume second slot", () => {
    const id = buildNearbyBudgetReservationId("r1", "s1")
    let budget: unknown = serializeNearbyBudgetDoc(
      {
        hourWindowStartMs: NOW,
        hourCount: 0,
        dayWindowStartMs: NOW,
        dayCount: 0,
        lastSentAtMs: null,
        criticalWindowStartMs: null,
        criticalCount: 0,
      },
      {}
    )
    const first = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: budget,
      reservationId: id,
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(first.result.reserved, true)
    assert.equal(first.result.idempotentReplay, false)
    budget = first.nextBudgetDoc
    const replay = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: budget,
      reservationId: id,
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(replay.result.reserved, true)
    assert.equal(replay.result.idempotentReplay, true)
    assert.equal(replay.nextBudgetDoc, null)
    const decoded = deserializeNearbyBudgetDoc(budget)
    assert.equal(decoded.state.hourCount, 1)
  })

  it("22–23. malformed fails closed; transient release restores", () => {
    const bad = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: { hourlyCount: -1 },
      reservationId: "r",
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(bad.result.reason, "REJECT_INVALID_BUDGET_STATE")

    const id = "nearby_budget:r1:s1"
    const reserved = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: null,
      reservationId: id,
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(reserved.result.reserved, true)
    const released = applyReleaseNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: reserved.nextBudgetDoc,
      reservationId: id,
    })
    assert.equal(released.ok, true)
    assert.equal(released.reason, "released")
    const after = deserializeNearbyBudgetDoc(released.nextBudgetDoc)
    assert.equal(after.state.hourCount, 0)

    const committed = applyCommitNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw: reserved.nextBudgetDoc,
      reservationId: id,
    })
    assert.equal(committed.ok, true)
    const afterCommit = deserializeNearbyBudgetDoc(committed.nextBudgetDoc)
    assert.equal(afterCommit.state.hourCount, 1)
    assert.equal(Object.keys(afterCommit.pending).length, 0)
  })
})

describe("058K dry-run short-circuit", () => {
  it("1–2,26–27. gate false skips config + budget + events", async () => {
    let configReads = 0
    let budgetWrites = 0
    let claims = 0
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
        claimEventOnce: async () => {
          claims += 1
          return "claimed"
        },
        sendDataMessage: async () => ({ success: true }),
        disableSubscription: async () => undefined,
        allowSend: false,
        getRolloutConfig: () => {
          configReads += 1
          return normalizeNearbyRolloutConfig({
            enabled: true,
            stage: 1,
            subscriptionAllowlist: ["a"],
          })
        },
        reserveNearbyBudget: async () => {
          budgetWrites += 1
          return { reserved: true, reason: "ALLOW", reservationId: "x" }
        },
        now: () => NOW,
      }
    )
    assert.equal(out.status, "dry_run")
    assert.equal(out.sendGate, false)
    assert.equal(out.rolloutStage, 0)
    assert.equal(configReads, 0)
    assert.equal(budgetWrites, 0)
    assert.equal(claims, 0)
  })

  it("40. production send gate source remains false", () => {
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
    const src = readFileSync(
      join(ROOT, "functions/src/nearby/sendGate.ts"),
      "utf8"
    )
    assert.match(
      src,
      /ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND:\s*boolean\s*=\s*false/
    )
  })

  it("31–32. assistance lifecycle does not use rollout/budget", () => {
    const life = readFileSync(
      join(ROOT, "functions/src/shared/processLifecycle.ts"),
      "utf8"
    )
    assert.equal(life.includes("opsRolloutConfig"), false)
    assert.equal(life.includes("firestoreBudget"), false)
    assert.equal(life.includes("nearbyNotificationBudget"), false)
    const index = readFileSync(join(ROOT, "functions/src/index.ts"), "utf8")
    assert.match(index, /onReportLifecycleUpdated/)
    assert.match(index, /fetchNearbyOpsConfigFromFirestore/)
    assert.match(index, /reserveNearbyNotificationBudget/)
  })
})
