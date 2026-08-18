/**
 * TRN 058M — multi-device nearby test-control coverage (no real FCM / no gate flip).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  applyCommitNearbyBudgetTransactionBody,
  applyReleaseNearbyBudgetTransactionBody,
  applyReserveNearbyBudgetTransactionBody,
} from "../nearby/firestoreBudget"
import { buildNearbyBudgetReservationId } from "../nearby/budgetPersistence"
import { serializeNearbyBudgetDoc } from "../nearby/budgetPersistence"
import {
  TRN058M_INVALID_TOKEN_ERROR,
  TRN058M_OBSERVABILITY_GAPS,
  TRN058M_OUTSIDE_RADIUS_OFFSET_KM,
  TRN058M_OUTSIDE_RADIUS_WHY,
  TRN058M_ROLES,
  TRN058M_SAME_UID_SUB_IDS,
  TRN058M_SENDER_COUNT_FIELDS,
  TRN058M_SYNTHETIC_SUB_IDS,
  TRN058M_SYNTHETIC_UIDS,
  TRN058M_WAVE1_REPORT,
  accidentRadiusMeters,
  assertTrn058mProductionClosed,
  buildTrn058mSubscription,
  buildTrn058mWave1Subscriptions,
  evaluateTrn058mWave1Expectations,
  expectHighCooldownReject,
  highIntervalStillOpen,
  invalidTokenBudgetAction,
  trn058mAccidentQueryPlan,
  trn058mGeohashAt,
  trn058mGeohashInAccidentQuery,
  trn058mOutsideRadiusCoords,
  trn058mSyntheticToken,
  trn058mWave1Stage1Allowlist,
} from "../nearby/multideviceTestControls"
import {
  NEARBY_BUDGET_POLICY,
  createNearbyBudgetStore,
  nearbyBudgetActionAfterSend,
  reserveNearbyBudgetSlotAtomic,
  type NearbyBudgetState,
} from "../nearby/nearbyBudget"
import { buildNearbyReportEventKey } from "../nearby/payload"
import {
  processNearbyReportCreated,
  type NearbyNotifyDeps,
} from "../nearby/processNearbyReport"
import { NEARBY_V1_SEND_DELAYED_CATEGORIES } from "../nearby/policy"
import {
  NEARBY_ROLLOUT_DEFAULT_CONFIG,
  normalizeNearbyRolloutConfig,
} from "../nearby/rolloutConfig"
import {
  ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND,
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
} from "../nearby/sendGate"
import { isPermanentInvalidTokenError } from "../shared/subscriptions"
import type { NearbyRecipientSubscriptionDoc } from "../shared/recipientTargeting"
import { normalizeNotificationPreferences } from "../shared/notificationPreferences"
import { LOCATION_MAX_NOTIFICATION_STALENESS_MS } from "../shared/recipientTargeting"
import { isNearbyNotificationReportEligible } from "../shared/nearbyNotificationRadii"

const ROOT = join(__dirname, "../../..")
const NOW = 1_700_000_000_000

function stage1(ids: string[]) {
  return normalizeNearbyRolloutConfig({
    enabled: true,
    stage: 1,
    subscriptionAllowlist: ids,
  })
}

const accidentReport: Record<string, unknown> = {
  ownerUid: TRN058M_WAVE1_REPORT.ownerUid,
  reportCategory: TRN058M_WAVE1_REPORT.reportCategory,
  reportFamily: TRN058M_WAVE1_REPORT.reportFamily,
  resolved: false,
  lat: TRN058M_WAVE1_REPORT.lat,
  lng: TRN058M_WAVE1_REPORT.lng,
  createdAt: NOW,
}

function uniqueFirstRangeQuery(docs: NearbyRecipientSubscriptionDoc[]) {
  return async (start: string, end: string) => {
    return docs.filter((doc) => {
      const gh = String(doc.locationGeohash || "")
      return gh.length === 6 && gh >= start && gh <= end
    })
  }
}

function mockDeps(
  candidates: NearbyRecipientSubscriptionDoc[],
  overrides: Partial<NearbyNotifyDeps> = {}
) {
  const sends: string[] = []
  const claims: string[] = []
  const disabled: string[] = []
  const released: string[] = []
  const committed: string[] = []
  const claimed = new Set<string>()
  const eventStatus: Record<string, string> = {}
  return {
    sends,
    claims,
    disabled,
    released,
    committed,
    eventStatus,
    listSubscriptionsByGeohashRange: uniqueFirstRangeQuery(candidates),
    claimEventOnce: async (eventKey: string) => {
      if (claimed.has(eventKey)) return "duplicate" as const
      claimed.add(eventKey)
      claims.push(eventKey)
      eventStatus[eventKey] = "processing"
      return "claimed" as const
    },
    releaseEventClaim: async (eventKey: string) => {
      claimed.delete(eventKey)
      delete eventStatus[eventKey]
    },
    markEventComplete: async (eventKey: string, status: string) => {
      eventStatus[eventKey] = status
    },
    sendDataMessage: async (token: string) => {
      sends.push(token)
      return { success: true }
    },
    disableSubscription: async (subscriptionId: string) => {
      disabled.push(subscriptionId)
    },
    allowSend: false,
    now: () => NOW,
    ...overrides,
  }
}

function memoryBudgetHooks() {
  const store = createNearbyBudgetStore()
  return {
    store,
    reserveNearbyBudget: async (input: {
      reportId: string
      subscriptionId: string
      severity: "HIGH" | "MEDIUM" | "CRITICAL"
      nowMs: number
    }) => {
      const r = reserveNearbyBudgetSlotAtomic({
        store,
        subscriptionId: input.subscriptionId,
        severity: input.severity,
        nowMs: input.nowMs,
      })
      return {
        reserved: r.reserved,
        reason: r.reason,
        reservationId: buildNearbyBudgetReservationId(
          input.reportId,
          input.subscriptionId
        ),
        releaseHandle: r.previous,
      }
    },
    releaseNearbyBudget: async (input: {
      subscriptionId: string
      releaseHandle?: NearbyBudgetState
    }) => {
      if (input.releaseHandle) {
        store.set(input.subscriptionId, input.releaseHandle)
      }
    },
  }
}

describe("058M production closed + fixture hygiene", () => {
  it("1. production gate source remains false; Stage 0; canary empty", () => {
    const closed = assertTrn058mProductionClosed()
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
    assert.equal(NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS.size, 0)
    assert.equal(NEARBY_ROLLOUT_DEFAULT_CONFIG.stage, 0)
    assert.equal(NEARBY_ROLLOUT_DEFAULT_CONFIG.enabled, false)
    assert.deepEqual(closed, {
      sendGate: false,
      canaryEmpty: true,
      defaultStage: 0,
      defaultEnabled: false,
    })
    const src = readFileSync(
      join(ROOT, "functions/src/nearby/sendGate.ts"),
      "utf8"
    )
    assert.match(
      src,
      /ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND:\s*boolean\s*=\s*false/
    )
    assert.match(src, /new Set\(\[\]\)/)
  })

  it("4–5. fixtures are synthetic; no FCM tokens / production ids", () => {
    for (const role of TRN058M_ROLES) {
      const id = TRN058M_SYNTHETIC_SUB_IDS[role]
      assert.match(id, /^trn058m-sub-/)
      const tok = trn058mSyntheticToken(role)
      assert.match(tok, /^tok-synth-058m-/)
      assert.ok(tok.length < 80)
    }
    for (const id of Object.values(TRN058M_SYNTHETIC_UIDS)) {
      assert.match(id, /^trn058m-uid-/)
    }
  })

  it("6. no raw lat/lng in observability payload builder keys", () => {
    const obs = readFileSync(
      join(ROOT, "functions/src/nearby/nearbyObservability.ts"),
      "utf8"
    )
    assert.equal(obs.includes("locationGeohash"), false)
    assert.equal(obs.includes("\"lat\""), false)
    const log = readFileSync(join(ROOT, "functions/src/index.ts"), "utf8")
    assert.match(log, /nearby_report_outcome/)
    const outcomeFn = log.slice(log.indexOf("function logNearbyOutcome"))
    const end = outcomeFn.indexOf("function throwIfRetryable")
    const body = end > 0 ? outcomeFn.slice(0, end) : outcomeFn.slice(0, 800)
    assert.equal(/\btoken:/.test(body), false)
    assert.equal(body.includes("locationGeohash"), false)
  })

  it("7–8. assistance + Smart Lifecycle isolation", () => {
    const life = readFileSync(
      join(ROOT, "functions/src/shared/processLifecycle.ts"),
      "utf8"
    )
    assert.equal(life.includes("multideviceTestControls"), false)
    assert.equal(life.includes("opsRolloutConfig"), false)
    const process = readFileSync(
      join(ROOT, "functions/src/nearby/processNearbyReport.ts"),
      "utf8"
    )
    assert.equal(process.includes("multideviceTestControls"), false)
    const index = readFileSync(join(ROOT, "functions/src/index.ts"), "utf8")
    assert.equal(index.includes("multideviceTestControls"), false)
    assert.match(index, /onReportLifecycleUpdated/)
  })

  it("9–17. nearbyAlerts default false; delayed/no-push categories unchanged", () => {
    assert.equal(normalizeNotificationPreferences({}).nearbyAlerts, false)
    assert.deepEqual([...NEARBY_V1_SEND_DELAYED_CATEGORIES].sort(), [
      "checkpoint",
      "road_closed",
      "slippery_road",
    ].sort())
    assert.equal(
      isNearbyNotificationReportEligible({ reportCategory: "traffic" }),
      false
    )
    assert.equal(
      isNearbyNotificationReportEligible({
        reportCategory: "stolen",
        reportFamily: "stolen",
      }),
      false
    )
  })

  it("18–21. tests do not deploy; bounded flag default off; Leaflet absent", () => {
    const helper = readFileSync(
      join(ROOT, "functions/src/nearby/multideviceTestControls.ts"),
      "utf8"
    )
    const sender = readFileSync(
      join(ROOT, "functions/src/nearby/processNearbyReport.ts"),
      "utf8"
    )
    assert.equal(helper.includes("firebase deploy"), false)
    assert.equal(sender.includes("firebase deploy"), false)
    const flag = readFileSync(join(ROOT, "src/geo/featureFlag.ts"), "utf8")
    assert.match(flag, /absent\/empty\/false → false/)
    const pkg = readFileSync(join(ROOT, "package.json"), "utf8")
    assert.equal(pkg.toLowerCase().includes("leaflet"), false)
  })
})

describe("058M device fixture model + Wave 1 helper", () => {
  it("D is clearly outside accident covering cells (~5 km, not 1.6 km)", () => {
    assert.ok(TRN058M_OUTSIDE_RADIUS_OFFSET_KM >= 4)
    assert.ok(TRN058M_OUTSIDE_RADIUS_WHY.includes("geohash"))
    assert.equal(accidentRadiusMeters(), 1500)
    const inside = trn058mGeohashAt(
      TRN058M_WAVE1_REPORT.lat,
      TRN058M_WAVE1_REPORT.lng
    )
    const far = trn058mGeohashAt(
      trn058mOutsideRadiusCoords().lat,
      trn058mOutsideRadiusCoords().lng
    )
    assert.notEqual(inside, far)
    assert.equal(trn058mGeohashInAccidentQuery(inside), true)
    assert.equal(trn058mGeohashInAccidentQuery(far), false)
    const plan = trn058mAccidentQueryPlan()
    assert.equal(plan.ok, true)
  })

  it("Wave-1 helper: A self-excluded; B+C send; D/E/F zero", () => {
    const exp = evaluateTrn058mWave1Expectations(NOW)
    assert.equal(exp.selfExcludedCount, 1)
    assert.deepEqual(exp.sendRoles, ["B_ELIGIBLE_1", "C_ELIGIBLE_2"])
    assert.equal(exp.attempted, 2)
    assert.equal(exp.success, 2)
    assert.equal(exp.failed, 0)
    assert.equal(exp.staleRejectedCount, 1)
    assert.equal(exp.preferenceRejectedCount, 1)
    assert.ok(!exp.uniqueGeoCandidateRoles.includes("D_OUTSIDE_RADIUS"))
    assert.equal(exp.uniqueGeoCandidateCount, 5)
    const byRole = Object.fromEntries(exp.devices.map((d) => [d.role, d]))
    assert.equal(byRole.A_REPORTER.fcm, 0)
    assert.equal(byRole.A_REPORTER.budgetHourDelta, 0)
    assert.equal(byRole.B_ELIGIBLE_1.fcm, 1)
    assert.equal(byRole.C_ELIGIBLE_2.eventSent, 1)
    assert.equal(byRole.D_OUTSIDE_RADIUS.geoCandidate, false)
    assert.equal(byRole.E_STALE.staleExcluded, true)
    assert.equal(byRole.F_ALERTS_OFF.preferenceExcluded, true)
  })
})

describe("058M Stage-1 N-allowlist", () => {
  it("empty Stage-1 allowlist => nobody", () => {
    const cfg = normalizeNearbyRolloutConfig({
      enabled: true,
      stage: 1,
      subscriptionAllowlist: [],
    })
    assert.equal(cfg.stage, 0)
  })

  it("one ID => only one; B+C => B+C only; A not allowlisted", async () => {
    const docs = buildTrn058mWave1Subscriptions(NOW)
    const one = mockDeps(docs, {
      allowSend: true,
      canarySubscriptionIds: new Set([TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1]),
      getRolloutConfig: () => stage1([TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1]),
      reserveNearbyBudget: async () => ({
        reserved: true,
        reason: "ALLOW",
        reservationId: "r",
      }),
    })
    const outOne = await processNearbyReportCreated("r-one", accidentReport, one)
    assert.equal(outOne.success, 1)
    assert.deepEqual(one.sends, [trn058mSyntheticToken("B_ELIGIBLE_1")])

    const two = mockDeps(docs, {
      allowSend: true,
      canarySubscriptionIds: new Set([
        TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1,
        TRN058M_SYNTHETIC_SUB_IDS.C_ELIGIBLE_2,
      ]),
      getRolloutConfig: () =>
        stage1([
          TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1,
          TRN058M_SYNTHETIC_SUB_IDS.C_ELIGIBLE_2,
        ]),
      reserveNearbyBudget: async () => ({
        reserved: true,
        reason: "ALLOW",
        reservationId: "r",
      }),
    })
    const outTwo = await processNearbyReportCreated("r-two", accidentReport, two)
    assert.equal(outTwo.success, 2)
    assert.equal(two.sends.length, 2)
    assert.equal(
      two.sends.includes(trn058mSyntheticToken("A_REPORTER")),
      false
    )
  })

  it("D/E/F may be allowlisted but still fail independent gates", async () => {
    const docs = buildTrn058mWave1Subscriptions(NOW)
    const deps = mockDeps(docs, {
      allowSend: true,
      canarySubscriptionIds: new Set(trn058mWave1Stage1Allowlist()),
      getRolloutConfig: () => stage1(trn058mWave1Stage1Allowlist()),
      reserveNearbyBudget: async () => ({
        reserved: true,
        reason: "ALLOW",
        reservationId: "r",
      }),
    })
    const out = await processNearbyReportCreated("r-w1", accidentReport, deps)
    assert.equal(out.status, "sent")
    assert.equal(out.eligibleCount, 2)
    assert.equal(out.attempted, 2)
    assert.equal(out.success, 2)
    assert.equal(out.failed, 0)
    assert.ok(out.candidateCount >= 5)
    assert.deepEqual(
      [...deps.sends].sort(),
      [
        trn058mSyntheticToken("B_ELIGIBLE_1"),
        trn058mSyntheticToken("C_ELIGIBLE_2"),
      ].sort()
    )
    assert.equal(deps.sends.includes(trn058mSyntheticToken("D_OUTSIDE_RADIUS")), false)
    assert.equal(deps.sends.includes(trn058mSyntheticToken("E_STALE")), false)
    assert.equal(deps.sends.includes(trn058mSyntheticToken("F_ALERTS_OFF")), false)
  })

  it("allowlist does not override self / stale / prefs / geo", async () => {
    const onlyExcluded = [
      TRN058M_SYNTHETIC_SUB_IDS.A_REPORTER,
      TRN058M_SYNTHETIC_SUB_IDS.D_OUTSIDE_RADIUS,
      TRN058M_SYNTHETIC_SUB_IDS.E_STALE,
      TRN058M_SYNTHETIC_SUB_IDS.F_ALERTS_OFF,
    ]
    const deps = mockDeps(buildTrn058mWave1Subscriptions(NOW), {
      allowSend: true,
      canarySubscriptionIds: new Set(onlyExcluded),
      getRolloutConfig: () => stage1(onlyExcluded),
      reserveNearbyBudget: async () => ({
        reserved: true,
        reason: "ALLOW",
        reservationId: "r",
      }),
    })
    const out = await processNearbyReportCreated("r-ex", accidentReport, deps)
    assert.equal(deps.sends.length, 0)
    assert.ok(
      out.status === "no_recipients" || out.status === "skipped" || out.status === "dry_run"
    )
  })

  it("gate false and Stage 0 override Stage-1 N-allowlist", async () => {
    const docs = [buildTrn058mSubscription("B_ELIGIBLE_1", NOW)]
    const ids = [TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1]
    const gateOff = mockDeps(docs, {
      allowSend: false,
      canarySubscriptionIds: new Set(ids),
      getRolloutConfig: () => stage1(ids),
    })
    const outOff = await processNearbyReportCreated("r-g", accidentReport, gateOff)
    assert.equal(outOff.status, "dry_run")
    assert.equal(outOff.sendGate, false)
    assert.equal(gateOff.sends.length, 0)

    const stage0 = mockDeps(docs, {
      allowSend: true,
      canarySubscriptionIds: new Set(ids),
      getRolloutConfig: () => NEARBY_ROLLOUT_DEFAULT_CONFIG,
    })
    const out0 = await processNearbyReportCreated("r-s0", accidentReport, stage0)
    assert.equal(out0.status, "skipped")
    assert.equal(out0.reason, "no_rollout_recipients")
    assert.equal(out0.rolloutStage, 0)
    assert.equal(stage0.sends.length, 0)
  })
})

describe("058M Wave 1 process path", () => {
  it("B+C receive; A/D/E/F zero FCM/events; candidateCount at least unique geo hits", async () => {
    const hooks = memoryBudgetHooks()
    const deps = mockDeps(buildTrn058mWave1Subscriptions(NOW), {
      allowSend: true,
      canarySubscriptionIds: new Set(trn058mWave1Stage1Allowlist()),
      getRolloutConfig: () => stage1(trn058mWave1Stage1Allowlist()),
      reserveNearbyBudget: hooks.reserveNearbyBudget,
    })
    const out = await processNearbyReportCreated("r-wave1", accidentReport, deps)
    assert.ok(out.candidateCount >= 5)
    assert.equal(out.eligibleCount, 2)
    assert.equal(out.attempted, 2)
    assert.equal(out.success, 2)
    assert.equal(out.failed, 0)
    assert.equal(out.disabledTokens, 0)
    assert.equal(deps.claims.length, 2)
    assert.ok(
      deps.claims.includes(
        buildNearbyReportEventKey("r-wave1", TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1)
      )
    )
    assert.ok(
      deps.claims.includes(
        buildNearbyReportEventKey("r-wave1", TRN058M_SYNTHETIC_SUB_IDS.C_ELIGIBLE_2)
      )
    )
    const b = hooks.store.get(TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1)
    const c = hooks.store.get(TRN058M_SYNTHETIC_SUB_IDS.C_ELIGIBLE_2)
    assert.equal(b?.hourCount, 1)
    assert.equal(b?.dayCount, 1)
    assert.equal(c?.hourCount, 1)
    assert.equal(hooks.store.get(TRN058M_SYNTHETIC_SUB_IDS.A_REPORTER), undefined)
    assert.equal(TRN058M_SENDER_COUNT_FIELDS.eligibleCount, true)
    assert.equal(TRN058M_SENDER_COUNT_FIELDS.selfExcludedCount, false)
    assert.ok(TRN058M_OBSERVABILITY_GAPS.length >= 3)
  })
})

describe("058M stale / preference / same-uid", () => {
  it("E stale even when allowlisted + opted in + fresh-looking otherwise", async () => {
    const e = buildTrn058mSubscription("E_STALE", NOW)
    assert.ok(
      typeof e.locationUpdatedAt === "number" &&
        NOW - e.locationUpdatedAt > LOCATION_MAX_NOTIFICATION_STALENESS_MS
    )
    const deps = mockDeps([e, buildTrn058mSubscription("B_ELIGIBLE_1", NOW)], {
      allowSend: true,
      canarySubscriptionIds: new Set([
        e.id,
        TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1,
      ]),
      getRolloutConfig: () =>
        stage1([e.id, TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1]),
      reserveNearbyBudget: async () => ({
        reserved: true,
        reason: "ALLOW",
        reservationId: "r",
      }),
    })
    const out = await processNearbyReportCreated("r-stale", accidentReport, deps)
    assert.equal(out.success, 1)
    assert.equal(deps.sends.includes(trn058mSyntheticToken("E_STALE")), false)
  })

  it("F nearbyAlerts false and accident pref false each block send", async () => {
    for (const role of ["F_ALERTS_OFF", "F_ACCIDENT_PREF_OFF"] as const) {
      const docs = [
        buildTrn058mSubscription(role, NOW),
        buildTrn058mSubscription("B_ELIGIBLE_1", NOW),
      ]
      const deps = mockDeps(docs, {
        allowSend: true,
        canarySubscriptionIds: new Set([
          TRN058M_SYNTHETIC_SUB_IDS[role],
          TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1,
        ]),
        getRolloutConfig: () =>
          stage1([
            TRN058M_SYNTHETIC_SUB_IDS[role],
            TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1,
          ]),
        reserveNearbyBudget: async () => ({
          reserved: true,
          reason: "ALLOW",
          reservationId: "r",
        }),
      })
      const out = await processNearbyReportCreated(
        `r-${role}`,
        accidentReport,
        deps
      )
      assert.equal(out.success, 1)
      assert.equal(deps.sends.includes(trn058mSyntheticToken(role)), false)
    }
  })

  it("same uid two subscriptions may both receive (per-subscription budget)", async () => {
    const uid = TRN058M_SYNTHETIC_UIDS.SHARED_B
    const b1 = buildTrn058mSubscription("B_ELIGIBLE_1", NOW, {
      id: TRN058M_SAME_UID_SUB_IDS.B1,
      uid,
      token: trn058mSyntheticToken("shared-b1"),
    })
    const b2 = buildTrn058mSubscription("C_ELIGIBLE_2", NOW, {
      id: TRN058M_SAME_UID_SUB_IDS.B2,
      uid,
      token: trn058mSyntheticToken("shared-b2"),
    })
    const hooks = memoryBudgetHooks()
    const deps = mockDeps([b1, b2], {
      allowSend: true,
      canarySubscriptionIds: new Set([
        TRN058M_SAME_UID_SUB_IDS.B1,
        TRN058M_SAME_UID_SUB_IDS.B2,
      ]),
      getRolloutConfig: () =>
        stage1([TRN058M_SAME_UID_SUB_IDS.B1, TRN058M_SAME_UID_SUB_IDS.B2]),
      reserveNearbyBudget: hooks.reserveNearbyBudget,
    })
    const out = await processNearbyReportCreated("r-sameuid", accidentReport, deps)
    assert.equal(out.success, 2)
    assert.equal(hooks.store.get(TRN058M_SAME_UID_SUB_IDS.B1)?.hourCount, 1)
    assert.equal(hooks.store.get(TRN058M_SAME_UID_SUB_IDS.B2)?.hourCount, 1)
  })
})

describe("058M cooldown / duplicate / invalid token", () => {
  it("second accident inside HIGH 10 min interval rejects B/C with cooldown count", async () => {
    const hooks = memoryBudgetHooks()
    const docs = [
      buildTrn058mSubscription("B_ELIGIBLE_1", NOW),
      buildTrn058mSubscription("C_ELIGIBLE_2", NOW),
    ]
    const allow = [
      TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1,
      TRN058M_SYNTHETIC_SUB_IDS.C_ELIGIBLE_2,
    ]
    const first = mockDeps(docs, {
      allowSend: true,
      canarySubscriptionIds: new Set(allow),
      getRolloutConfig: () => stage1(allow),
      reserveNearbyBudget: hooks.reserveNearbyBudget,
      now: () => NOW,
    })
    const out1 = await processNearbyReportCreated("r-cd1", accidentReport, first)
    assert.equal(out1.success, 2)
    const soon = NOW + 60_000
    assert.equal(highIntervalStillOpen(NOW, soon), false)
    assert.equal(expectHighCooldownReject({ lastSentAtMs: NOW, nowMs: soon }), true)
    const second = mockDeps(docs, {
      allowSend: true,
      canarySubscriptionIds: new Set(allow),
      getRolloutConfig: () => stage1(allow),
      reserveNearbyBudget: hooks.reserveNearbyBudget,
      now: () => soon,
    })
    const out2 = await processNearbyReportCreated(
      "r-cd2",
      { ...accidentReport, createdAt: soon },
      second
    )
    assert.equal(out2.status, "skipped")
    assert.equal(out2.reason, "all_budget_rejected")
    assert.equal(out2.attempted, 0)
    assert.equal(out2.success, 0)
    assert.ok(out2.cooldownRejectedCount >= 2)
    assert.equal(second.sends.length, 0)
    assert.equal(hooks.store.get(TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1)?.hourCount, 1)
    assert.equal(hooks.store.get(TRN058M_SYNTHETIC_SUB_IDS.C_ELIGIBLE_2)?.dayCount, 1)
    assert.ok(soon - NOW < NEARBY_BUDGET_POLICY.highMinIntervalMs)
  })

  it("same report retry for B and C: no second FCM / budget / event", async () => {
    for (const role of ["B_ELIGIBLE_1", "C_ELIGIBLE_2"] as const) {
      const reportId = `r-dup-${role}`
      const reservationId = buildNearbyBudgetReservationId(
        reportId,
        TRN058M_SYNTHETIC_SUB_IDS[role]
      )
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
        reservationId,
        severity: "HIGH",
        nowMs: NOW,
      })
      assert.equal(first.result.reserved, true)
      budgetRaw = first.nextBudgetDoc
      const replay = applyReserveNearbyBudgetTransactionBody({
        subscriptionExists: true,
        budgetRaw,
        reservationId,
        severity: "HIGH",
        nowMs: NOW,
      })
      assert.equal(replay.result.idempotentReplay, true)
      const committed = applyCommitNearbyBudgetTransactionBody({
        subscriptionExists: true,
        budgetRaw,
        reservationId,
      })
      assert.equal(committed.ok, true)

      const deps = mockDeps([buildTrn058mSubscription(role, NOW)], {
        allowSend: true,
        canarySubscriptionIds: new Set([TRN058M_SYNTHETIC_SUB_IDS[role]]),
        getRolloutConfig: () => stage1([TRN058M_SYNTHETIC_SUB_IDS[role]]),
      })
      await processNearbyReportCreated(reportId, accidentReport, deps)
      const again = await processNearbyReportCreated(
        reportId,
        accidentReport,
        deps
      )
      assert.equal(deps.sends.length, 1)
      assert.equal(again.reason, "all_duplicate_events")
      assert.equal(again.dedupeRejectedCount, 1)
    }
  })

  it("G invalid token: disable + release reservation + failed_invalid_token", async () => {
    assert.equal(isPermanentInvalidTokenError(TRN058M_INVALID_TOKEN_ERROR), true)
    assert.equal(invalidTokenBudgetAction(), "release_reservation")
    assert.equal(
      nearbyBudgetActionAfterSend({
        fcmSuccess: false,
        permanentInvalidToken: true,
        eventClaim: "claimed",
      }),
      "release_reservation"
    )

    const g = buildTrn058mSubscription("G_INVALID_TOKEN", NOW)
    const reservationId = buildNearbyBudgetReservationId("r-inv", g.id)
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
    const reserved = applyReserveNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw,
      reservationId,
      severity: "HIGH",
      nowMs: NOW,
    })
    assert.equal(reserved.result.reserved, true)
    budgetRaw = reserved.nextBudgetDoc
    const released = applyReleaseNearbyBudgetTransactionBody({
      subscriptionExists: true,
      budgetRaw,
      reservationId,
    })
    assert.equal(released.ok, true)
    assert.equal(released.reason, "released")

    const deps = mockDeps([g], {
      allowSend: true,
      canarySubscriptionIds: new Set([g.id]),
      getRolloutConfig: () => stage1([g.id]),
      sendDataMessage: async () => ({
        success: false,
        errorCode: TRN058M_INVALID_TOKEN_ERROR,
      }),
      reserveNearbyBudget: async () => ({
        reserved: true,
        reason: "ALLOW",
        reservationId,
      }),
      releaseNearbyBudget: async () => undefined,
      commitNearbyBudget: async () => {
        throw new Error("must not commit after invalid token")
      },
    })
    const out = await processNearbyReportCreated("r-inv", accidentReport, deps)
    assert.equal(out.attempted, 1)
    assert.equal(out.success, 0)
    assert.equal(out.failed, 1)
    assert.equal(out.disabledTokens, 1)
    assert.deepEqual(deps.disabled, [g.id])
    assert.equal(
      deps.eventStatus[buildNearbyReportEventKey("r-inv", g.id)],
      "failed_invalid_token"
    )
  })
})

describe("058M operator artifacts exist and stay privacy-safe", () => {
  it("checklist markdown has no production ids and required sections", () => {
    const md = readFileSync(
      join(ROOT, "TRN_058M_MULTIDEVICE_TEST_CONTROLS.md"),
      "utf8"
    )
    assert.match(md, /Operator checklist/)
    assert.match(md, /Wave 1/)
    assert.match(md, /rollback/)
    assert.equal(md.includes("trn058m-sub-"), true)
    assert.doesNotMatch(md, /AAAA[A-Za-z0-9_-]{80,}/)
    const names = readdirSync(ROOT)
    assert.ok(names.includes("TRN_058M_MULTIDEVICE_TEST_CONTROLS.md"))
  })
})
