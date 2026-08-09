/**
 * TRN 058E — nearby report notification Function tests (no real FCM).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  NEARBY_COPY_FORBIDDEN_PHRASES,
  nearbyNotificationCopyForCategory,
} from "../nearby/copy"
import {
  assertNearbyPayloadSafe,
  buildNearbyReportDeepLink,
  buildNearbyReportEventKey,
  buildNearbyReportPayload,
} from "../nearby/payload"
import {
  NEARBY_COOLDOWN_POLICY,
  NEARBY_REPORT_MAX_AGE_MS,
  NEARBY_V1_SEND_CAPABLE_CATEGORIES,
  NEARBY_V1_SEND_DELAYED_CATEGORIES,
  isNearbyCategorySendCapable,
  isNearbyReportFreshEnough,
  nearbySeverityForCategory,
  passesNearbyTrustGate,
} from "../nearby/policy"
import {
  processNearbyReportCreated,
  type NearbyNotifyDeps,
} from "../nearby/processNearbyReport"
import { ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND } from "../nearby/sendGate"
import type { NearbyRecipientSubscriptionDoc } from "../shared/recipientTargeting"

const NOW = 1_700_000_000_000
const ROOT = join(__dirname, "../../..")

function baseReport(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ownerUid: "owner-1",
    reportCategory: "accident",
    reportFamily: "intelligence",
    resolved: false,
    lat: 33.8938,
    lng: 35.5018,
    createdAt: NOW,
    confirmationPresentCount: 0,
    confirmationGoneCount: 0,
    ...overrides,
  }
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
      checkpoint: true,
      accident: true,
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
): NearbyNotifyDeps & {
  sends: string[]
  claims: string[]
  disabled: string[]
} {
  const sends: string[] = []
  const claims: string[] = []
  const disabled: string[] = []
  const claimed = new Set<string>()
  return {
    sends,
    claims,
    disabled,
    listSubscriptionsByGeohashRange: async () => candidates,
    claimEventOnce: async (eventKey) => {
      if (claimed.has(eventKey)) return "duplicate"
      claimed.add(eventKey)
      claims.push(eventKey)
      return "claimed"
    },
    releaseEventClaim: async (eventKey) => {
      claimed.delete(eventKey)
    },
    markEventComplete: async () => undefined,
    sendDataMessage: async (token) => {
      sends.push(token)
      return { success: true }
    },
    disableSubscription: async (id) => {
      disabled.push(id)
    },
    allowSend: false,
    now: () => NOW,
    ...overrides,
  }
}

describe("058E send gate", () => {
  it("1. send gate false by default", () => {
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
  })
})

describe("058E category policy", () => {
  it("2–6. ineligible families/categories skipped", async () => {
    for (const category of [
      "traffic",
      "otherIncident",
      "stolen",
      "assistance",
      "sharedRide",
    ]) {
      const deps = mockDeps([sub("a")])
      const out = await processNearbyReportCreated(
        "r1",
        baseReport({
          reportCategory: category,
          reportFamily:
            category === "assistance" ||
            category === "sharedRide" ||
            category === "stolen"
              ? category
              : "intelligence",
        }),
        deps
      )
      assert.equal(out.status, "skipped", category)
      assert.equal(deps.sends.length, 0)
    }
  })

  it("7. checkpoint policy delayed", () => {
    assert.equal(isNearbyCategorySendCapable("checkpoint"), false)
    assert.ok(NEARBY_V1_SEND_DELAYED_CATEGORIES.includes("checkpoint"))
  })

  it("8. accident policy send-capable", () => {
    assert.equal(isNearbyCategorySendCapable("accident"), true)
    assert.equal(nearbySeverityForCategory("accident"), "HIGH")
  })

  it("9–10. road_closed / slippery delayed", () => {
    assert.equal(isNearbyCategorySendCapable("road_closed"), false)
    assert.equal(isNearbyCategorySendCapable("slippery_road"), false)
  })

  it("11–14. fire / gunfire / explosion / collapse send-capable", () => {
    for (const c of [
      "fire",
      "gunfire",
      "explosionStrike",
      "collapseDanger",
    ] as const) {
      assert.equal(isNearbyCategorySendCapable(c), true)
      assert.ok(NEARBY_V1_SEND_CAPABLE_CATEGORIES.includes(c))
    }
  })

  it("40. no weather/marketplace", async () => {
    for (const category of ["weather", "marketplace"]) {
      const deps = mockDeps([sub("a")])
      const out = await processNearbyReportCreated(
        "r1",
        baseReport({ reportCategory: category }),
        deps
      )
      assert.equal(out.status, "skipped")
    }
  })
})

describe("058E freshness / structure", () => {
  it("15. stale report skipped", async () => {
    const deps = mockDeps([sub("a")])
    const out = await processNearbyReportCreated(
      "r1",
      baseReport({
        createdAt: NOW - NEARBY_REPORT_MAX_AGE_MS.accident - 1,
      }),
      deps
    )
    assert.equal(out.status, "skipped")
    assert.equal(out.reason, "report_stale")
  })

  it("16. malformed coords skipped", async () => {
    const deps = mockDeps([sub("a")])
    const out = await processNearbyReportCreated(
      "r1",
      baseReport({ lat: null, lng: 35.5 }),
      deps
    )
    assert.equal(out.reason, "malformed_report")
  })

  it("17. resolved report skipped", async () => {
    const deps = mockDeps([sub("a")])
    const out = await processNearbyReportCreated(
      "r1",
      baseReport({ resolved: true }),
      deps
    )
    assert.equal(out.status, "skipped")
  })

  it("freshness helper", () => {
    assert.equal(
      isNearbyReportFreshEnough({
        category: "gunfire",
        createdAtMs: NOW - 5 * 60 * 1000,
        nowMs: NOW,
      }),
      true
    )
  })
})

describe("058E recipient filters via process", () => {
  it("19. disabled sub skipped", async () => {
    const deps = mockDeps([sub("a", { enabled: false })])
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "no_recipients")
  })

  it("20. nearbyAlerts off skipped", async () => {
    const deps = mockDeps([
      sub("a", {
        notificationPreferences: { nearbyAlerts: false, accident: true },
      }),
    ])
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "no_recipients")
  })

  it("21. stale location skipped", async () => {
    const deps = mockDeps([
      sub("a", { locationUpdatedAt: NOW - 31 * 60 * 1000 }),
    ])
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "no_recipients")
  })

  it("22. category pref off skipped", async () => {
    const deps = mockDeps([
      sub("a", {
        notificationPreferences: { nearbyAlerts: true, accident: false },
      }),
    ])
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "no_recipients")
  })

  it("23. self reporter skipped", async () => {
    const deps = mockDeps([sub("a", { uid: "owner-1" })])
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "no_recipients")
  })

  it("24. multi-device both eligible in dry-run", async () => {
    const deps = mockDeps([
      sub("phone", { uid: "rider-x" }),
      sub("tablet", { uid: "rider-x" }),
    ])
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "dry_run")
    assert.equal(out.eligibleCount, 2)
    assert.equal(deps.sends.length, 0)
  })

  it("25. duplicate range result deduped", async () => {
    const one = sub("same")
    const deps = mockDeps([])
    deps.listSubscriptionsByGeohashRange = async () => [one, one]
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.eligibleCount, 1)
  })
})

describe("058E dry-run / send path", () => {
  it("36. send gate false → zero FCM sends", async () => {
    const deps = mockDeps([sub("a")], { allowSend: false })
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "dry_run")
    assert.equal(out.sendGate, false)
    assert.equal(deps.sends.length, 0)
    assert.equal(deps.claims.length, 0)
  })

  it("37. sender gate true fixture → expected send path", async () => {
    const deps = mockDeps([sub("a"), sub("b")], { allowSend: true })
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "sent")
    assert.equal(out.success, 2)
    assert.equal(deps.sends.length, 2)
    assert.equal(deps.claims.length, 2)
  })

  it("26–27. event key per subscription + retry duplicate prevented", async () => {
    assert.equal(
      buildNearbyReportEventKey("r1", "sub-a"),
      "nearby_report:r1:sub-a"
    )
    const deps = mockDeps([sub("a")], { allowSend: true })
    await processNearbyReportCreated("r1", baseReport(), deps)
    const again = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(again.status, "skipped")
    assert.equal(again.reason, "all_duplicate_events")
    assert.equal(deps.sends.length, 1)
  })

  it("28. invalid token cleanup reused", async () => {
    const deps = mockDeps([sub("a")], {
      allowSend: true,
      sendDataMessage: async () => ({
        success: false,
        errorCode: "messaging/registration-token-not-registered",
      }),
    })
    const out = await processNearbyReportCreated("r1", baseReport(), deps)
    assert.equal(out.status, "failed")
    assert.deepEqual(deps.disabled, ["a"])
  })
})

describe("058E trust / copy / deep link", () => {
  it("38. likelyGone skipped", () => {
    assert.equal(
      passesNearbyTrustGate({
        category: "accident",
        likelyGoneSince: NOW,
      }).ok,
      false
    )
  })

  it("39. disputed skipped", () => {
    assert.equal(
      passesNearbyTrustGate({
        category: "fire",
        confirmationPresentCount: 1,
        confirmationGoneCount: 1,
      }).ok,
      false
    )
  })

  it("29–33. Arabic copy exact + safety", () => {
    const accident = nearbyNotificationCopyForCategory("accident")
    assert.equal(accident?.title, "حادث قريب منك")
    assert.match(accident?.body || "", /بلاغ من دراج/)
    const gun = nearbyNotificationCopyForCategory("gunfire")
    assert.equal(gun?.title, "بلاغ مهم قريب منك")
    const checkpoint = nearbyNotificationCopyForCategory("checkpoint")
    assert.equal(checkpoint?.body, "بلاغ عن حاجز قريب من منطقتك.")
    for (const cat of NEARBY_V1_SEND_CAPABLE_CATEGORIES) {
      const c = nearbyNotificationCopyForCategory(cat)
      assert.ok(c)
      const blob = `${c.title} ${c.body}`
      for (const bad of NEARBY_COPY_FORBIDDEN_PHRASES) {
        assert.equal(blob.toLowerCase().includes(bad.toLowerCase()), false, bad)
      }
      assert.equal(/\d+(\.\d+)?\s*كم/.test(blob), false)
    }
    const payload = buildNearbyReportPayload({
      reportId: "abc",
      category: "accident",
      createdAtMs: NOW,
    })
    assert.ok(payload)
    assert.equal(
      payload.deepLink,
      "https://app.totimoto.com/?report=abc&notification=nearby_accident"
    )
    assert.equal(assertNearbyPayloadSafe(payload), true)
    assert.equal(
      buildNearbyReportDeepLink("abc", "gunfire"),
      "https://app.totimoto.com/?report=abc&notification=nearby_gunfire"
    )
  })

  it("31. checkpoint no evasion wording", () => {
    const c = nearbyNotificationCopyForCategory("checkpoint")
    assert.ok(c)
    assert.equal(c.body.includes("تجنب"), false)
    assert.equal(c.body.includes("تفادي"), false)
  })
})

describe("058E architecture invariants", () => {
  it("34. no confirmation subcollection read in nearby modules", () => {
    const dir = join(ROOT, "functions/src/nearby")
    for (const name of [
      "processNearbyReport.ts",
      "policy.ts",
      "payload.ts",
      "reportParse.ts",
    ]) {
      const src = readFileSync(join(dir, name), "utf8")
      assert.equal(src.includes("confirmations"), false, name)
      assert.equal(src.includes("collection("), false, name)
    }
  })

  it("35. no raw rider lat/lng in payloads", () => {
    const p = buildNearbyReportPayload({
      reportId: "r",
      category: "fire",
    })
    assert.ok(p)
    assert.equal("lat" in p, false)
    assert.equal("lng" in p, false)
  })

  it("cooldown postponed documented", () => {
    assert.equal(NEARBY_COOLDOWN_POLICY.mode, "postponed_v1")
  })

  it("41. assistance Functions export untouched in nearby process", () => {
    const index = readFileSync(join(ROOT, "functions/src/index.ts"), "utf8")
    assert.match(index, /onReportLifecycleUpdated/)
    assert.match(index, /onReportCreatedNearbyNotify/)
    assert.match(index, /ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND/)
  })

  it("18. recipient query uses enabled+locationGeohash", () => {
    const index = readFileSync(join(ROOT, "functions/src/index.ts"), "utf8")
    assert.match(index, /where\("enabled", "==", true\)/)
    assert.match(index, /where\("locationGeohash", ">=", start\)/)
    assert.match(index, /where\("locationGeohash", "<=", end\)/)
  })

  it("delayed categories skipped by process", async () => {
    const deps = mockDeps([sub("a")])
    const out = await processNearbyReportCreated(
      "r1",
      baseReport({ reportCategory: "checkpoint" }),
      deps
    )
    assert.equal(out.reason, "category_send_disabled_v1")
    assert.equal(deps.sends.length, 0)
  })
})
