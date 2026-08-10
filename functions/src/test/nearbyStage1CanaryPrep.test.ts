/**
 * TRN 058L — Stage-1 canary preparation tests (no real FCM / no gate flip).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  applyReserveNearbyBudgetTransactionBody,
  applyCommitNearbyBudgetTransactionBody,
} from "../nearby/firestoreBudget"
import { buildNearbyBudgetReservationId } from "../nearby/budgetPersistence"
import { serializeNearbyBudgetDoc } from "../nearby/budgetPersistence"
import {
  isCachedConfigDeliveryUnlocked,
  loadNearbyOpsRolloutConfig,
  resetNearbyOpsConfigCache,
} from "../nearby/opsRolloutConfig"
import {
  buildNearbyReportDeepLink,
  buildNearbyReportEventKey,
  buildNearbyReportPayload,
} from "../nearby/payload"
import {
  processNearbyReportCreated,
  type NearbyNotifyDeps,
} from "../nearby/processNearbyReport"
import { normalizeNearbyRolloutConfig } from "../nearby/rolloutConfig"
import { ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND } from "../nearby/sendGate"
import type { NearbyRecipientSubscriptionDoc } from "../shared/recipientTargeting"
import { isSelfReporterSubscription } from "../shared/recipientTargeting"

const ROOT = join(__dirname, "../../..")
const NOW = 1_700_000_000_000

function stage1(ids: string[]) {
  return normalizeNearbyRolloutConfig({
    enabled: true,
    stage: 1,
    subscriptionAllowlist: ids,
  })
}

function sub(
  id: string,
  overrides: Partial<NearbyRecipientSubscriptionDoc> = {}
): NearbyRecipientSubscriptionDoc {
  return {
    id,
    uid: "rider-" + id,
    enabled: true,
    permissionState: "granted",
    token: "token-" + id,
    locationGeohash: "sy10zf",
    locationUpdatedAt: NOW - 60_000,
    notificationPreferences: {
      nearbyAlerts: true,
      accident: true,
      checkpoint: true,
      roadClosed: true,
      slippery: true,
      importantIncidents: true,
    },
    ...overrides,
  }
}

function mockDeps(
  candidates: NearbyRecipientSubscriptionDoc[],
  overrides: Partial<NearbyNotifyDeps> = {}
) {
  const sends: string[] = []
  const claims: string[] = []
  const budgetCalls: string[] = []
  const claimed = new Set<string>()
  return {
    sends,
    claims,
    budgetCalls,
    listSubscriptionsByGeohashRange: async () => candidates,
    claimEventOnce: async (eventKey: string) => {
      if (claimed.has(eventKey)) return "duplicate" as const
      claimed.add(eventKey)
      claims.push(eventKey)
      return "claimed" as const
    },
    releaseEventClaim: async (eventKey: string) => {
      claimed.delete(eventKey)
    },
    markEventComplete: async () => undefined,
    sendDataMessage: async (token: string) => {
      sends.push(token)
      return { success: true }
    },
    disableSubscription: async () => undefined,
    allowSend: false,
    now: () => NOW,
    ...overrides,
  }
}

const accidentReport = {
  ownerUid: "owner-a",
  reportCategory: "accident",
  reportFamily: "intelligence",
  resolved: false,
  lat: 33.8938,
  lng: 35.5018,
  createdAt: NOW,
}

describe("058L self-exclusion ordering", () => {
  it("1–5. self rejected before rollout/budget/event/FCM", async () => {
    let configReads = 0
    let budgetCalls = 0
    const deps = mockDeps([sub("device-a", { uid: "owner-a" })], {
      allowSend: true,
      canarySubscriptionIds: new Set(["device-a"]),
      getRolloutConfig: () => {
        configReads += 1
        return stage1(["device-a"])
      },
      reserveNearbyBudget: async () => {
        budgetCalls += 1
        return { reserved: true, reason: "ALLOW", reservationId: "x" }
      },
    })
    assert.equal(
      isSelfReporterSubscription(sub("device-a", { uid: "owner-a" }), {
        ownerUid: "owner-a",
        reportCategory: "accident",
      }),
      true
    )
    const out = await processNearbyReportCreated("r-self", accidentReport, deps)
    assert.equal(out.status, "no_recipients")
    assert.equal(out.eligibleCount, 0)
    assert.equal(deps.sends.length, 0)
    assert.equal(deps.claims.length, 0)
    assert.equal(budgetCalls, 0)
    // Self-only exits before rollout config read when eligible empty.
    assert.equal(configReads, 0)
  })

  it("6,14–16. Device B-only Stage 1; A self cannot pass B allowlist", async () => {
    const deps = mockDeps(
      [
        sub("device-a", { uid: "owner-a" }),
        sub("device-b", { uid: "rider-b" }),
      ],
      {
        allowSend: true,
        canarySubscriptionIds: new Set(["device-b"]),
        getRolloutConfig: () => stage1(["device-b"]),
        reserveNearbyBudget: async (input) => {
          return {
            reserved: true,
            reason: "ALLOW",
            reservationId: buildNearbyBudgetReservationId(
              input.reportId,
              input.subscriptionId
            ),
          }
        },
      }
    )
    const out = await processNearbyReportCreated("r-ab", accidentReport, deps)
    assert.equal(out.eligibleCount, 1)
    assert.equal(out.status, "sent")
    assert.equal(out.success, 1)
    assert.equal(deps.sends.length, 1)
    assert.equal(deps.sends[0], "token-device-b")
    assert.equal(
      deps.claims[0],
      buildNearbyReportEventKey("r-ab", "device-b")
    )
  })

  it("17–18. gate false / Stage 0 override Stage 1", async () => {
    const gateOff = mockDeps([sub("device-b")], {
      allowSend: false,
      canarySubscriptionIds: new Set(["device-b"]),
      getRolloutConfig: () => stage1(["device-b"]),
    })
    const outOff = await processNearbyReportCreated(
      "r1",
      accidentReport,
      gateOff
    )
    assert.equal(outOff.status, "dry_run")
    assert.equal(gateOff.sends.length, 0)

    const stage0 = mockDeps([sub("device-b")], {
      allowSend: true,
      canarySubscriptionIds: new Set(["device-b"]),
      getRolloutConfig: () =>
        normalizeNearbyRolloutConfig({ enabled: true, stage: 0 }),
    })
    const out0 = await processNearbyReportCreated("r2", accidentReport, stage0)
    assert.equal(out0.status, "skipped")
    assert.equal(out0.reason, "no_rollout_recipients")
    assert.equal(stage0.sends.length, 0)
  })

  it("13. Stage 1 empty allowlist nobody", () => {
    assert.equal(
      normalizeNearbyRolloutConfig({
        enabled: true,
        stage: 1,
        subscriptionAllowlist: [],
      }).stage,
      0
    )
  })
})

describe("058L deep link + payload", () => {
  it("7–8. accident payload includes exact reportId and deep link URL", () => {
    const payload = buildNearbyReportPayload({
      reportId: "ExactReportId99",
      category: "accident",
      createdAtMs: NOW,
    })
    assert.equal(payload?.reportId, "ExactReportId99")
    assert.equal(
      payload?.deepLink,
      "https://app.totimoto.com/?report=ExactReportId99&notification=nearby_accident"
    )
    assert.equal(
      buildNearbyReportDeepLink("ExactReportId99", "accident"),
      payload?.deepLink
    )
  })

  it("22–23. same report retry: no second budget / event claim path", async () => {
    const id = buildNearbyBudgetReservationId("r-retry", "device-b")
    let budgetRaw: unknown = serializeNearbyBudgetDoc(
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
      budgetRaw,
      reservationId: id,
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(first.result.reserved, true)
    budgetRaw = first.nextBudgetDoc
    const replay = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw,
      reservationId: id,
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(replay.result.idempotentReplay, true)
    const committed = applyCommitNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw,
      reservationId: id,
    })
    assert.equal(committed.ok, true)

    const deps = mockDeps([sub("device-b")], {
      allowSend: true,
      canarySubscriptionIds: new Set(["device-b"]),
      getRolloutConfig: () => stage1(["device-b"]),
    })
    await processNearbyReportCreated("r-retry", accidentReport, deps)
    const again = await processNearbyReportCreated("r-retry", accidentReport, deps)
    assert.equal(deps.sends.length, 1)
    assert.equal(again.reason, "all_duplicate_events")
  })
})

describe("058L kill-switch cache", () => {
  it("open config is not served from cache; ops disable applies next read", async () => {
    resetNearbyOpsConfigCache()
    let reads = 0
    let enabled = true
    const fetchRaw = async () => {
      reads += 1
      return {
        enabled,
        stage: 1,
        subscriptionAllowlist: ["device-b"],
      }
    }
    const open = await loadNearbyOpsRolloutConfig({
      fetchRaw,
      nowMs: NOW,
      ttlMs: 60_000,
    })
    assert.equal(open.stage, 1)
    assert.equal(isCachedConfigDeliveryUnlocked(open), true)
    assert.equal(reads, 1)

    // Second call within TTL must re-fetch because open configs bypass cache.
    const still = await loadNearbyOpsRolloutConfig({
      fetchRaw,
      nowMs: NOW + 1000,
      ttlMs: 60_000,
    })
    assert.equal(still.stage, 1)
    assert.equal(reads, 2)

    enabled = false
    const killed = await loadNearbyOpsRolloutConfig({
      fetchRaw,
      nowMs: NOW + 2000,
      ttlMs: 60_000,
    })
    assert.equal(killed.stage, 0)
    assert.equal(killed.normalizeReason, "config_disabled")
    assert.equal(reads, 3)
  })

  it("34. master gate remains false", () => {
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

  it("30. assistance isolation preserved", () => {
    const life = readFileSync(
      join(ROOT, "functions/src/shared/processLifecycle.ts"),
      "utf8"
    )
    assert.equal(life.includes("opsRolloutConfig"), false)
    assert.equal(life.includes("firestoreBudget"), false)
  })
})
