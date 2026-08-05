/**
 * Remaining lifecycle notification unit tests (no real FCM).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  processHelperCancelledUpdate,
  processOwnerCancelledDelete,
  processOwnerResolvedUpdate,
  type LifecycleHandlerDeps,
} from "../lifecycle/handlers"
import {
  buildHelperCancelledPayload,
  buildOwnerCancelledPayload,
  buildOwnerResolvedPayload,
  toFcmDataMap,
} from "../lifecycle/payloads"
import {
  buildHelperCancelledEventKey,
  buildOwnerCancelledEventKey,
  buildOwnerResolvedEventKey,
  isHelperCancelledTransition,
  isOwnerCancelledTransition,
  isOwnerResolvedTransition,
} from "../lifecycle/transitions"
import { payloadContainsForbiddenKeys, payloadValuesAreAllStrings } from "../shared/payloadSafety"
import type { ReportSnapshot } from "../shared/report"
import {
  isPermanentInvalidTokenError,
  selectEnabledSubscriptions,
} from "../shared/subscriptions"

function claimed(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    ownerUid: "owner-1",
    helperUid: "helper-1",
    helperComing: true,
    helperAcceptedAt: 1700000000000,
    resolved: false,
    reportFamily: "assistance",
    ...overrides,
  }
}

function cancelled(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    ownerUid: "owner-1",
    helperUid: "",
    helperComing: false,
    resolved: false,
    reportFamily: "assistance",
    ...overrides,
  }
}

function mockDeps(
  recipientUid: string,
  preference: "helperLifecycle" | "ownerLifecycle",
  overrides: Partial<LifecycleHandlerDeps> = {}
): LifecycleHandlerDeps & { sends: string[]; disabled: string[]; claimedKeys: string[] } {
  const sends: string[] = []
  const disabled: string[] = []
  const claimedKeys: string[] = []
  return {
    sends,
    disabled,
    claimedKeys,
    claimEventOnce: async (key) => {
      claimedKeys.push(key)
      return "claimed"
    },
    listSubscriptions: async (uid, pref) => {
      if (uid !== recipientUid) return []
      return [
        {
          id: "sub-1",
          uid: recipientUid,
          enabled: true,
          permissionState: "granted",
          token: "token-aaaa",
          notificationPreferences: {
            helperLifecycle: preference === "helperLifecycle",
            ownerLifecycle: preference === "ownerLifecycle",
          },
        },
      ].filter((d) => {
        if (pref === "helperLifecycle") {
          return d.notificationPreferences.helperLifecycle === true
        }
        return d.notificationPreferences.ownerLifecycle === true
      })
    },
    sendDataMessage: async (token) => {
      sends.push(token)
      return { success: true }
    },
    disableSubscription: async (id) => {
      disabled.push(id)
    },
    now: () => 1700000000000,
    ...overrides,
  }
}

describe("helper cancelled transition", () => {
  it("detects genuine accepted → cancelled", () => {
    assert.equal(isHelperCancelledTransition(claimed(), cancelled()), true)
  })

  it("supports sharedRide", () => {
    assert.equal(
      isHelperCancelledTransition(
        claimed({ reportFamily: "sharedRide" }),
        cancelled({ reportFamily: "sharedRide" })
      ),
      true
    )
  })

  it("ignores intelligence", () => {
    assert.equal(
      isHelperCancelledTransition(
        claimed({ reportFamily: "intelligence" }),
        cancelled({ reportFamily: "intelligence" })
      ),
      false
    )
  })

  it("ignores stolen", () => {
    assert.equal(
      isHelperCancelledTransition(
        claimed({ reportFamily: "stolen" }),
        cancelled({ reportFamily: "stolen" })
      ),
      false
    )
  })

  it("ignores no previous helper", () => {
    assert.equal(
      isHelperCancelledTransition(
        claimed({ helperUid: "", helperComing: false }),
        cancelled()
      ),
      false
    )
  })

  it("ignores GPS-only update", () => {
    assert.equal(
      isHelperCancelledTransition(
        claimed(),
        claimed({ helperAcceptedAt: 1700000000999 })
      ),
      false
    )
  })

  it("ignores helper replaced directly", () => {
    assert.equal(
      isHelperCancelledTransition(
        claimed({ helperUid: "helper-1" }),
        claimed({ helperUid: "helper-2", helperAcceptedAt: 1700000001111 })
      ),
      false
    )
  })

  it("ignores resolved-at-same-time", () => {
    assert.equal(
      isHelperCancelledTransition(claimed(), cancelled({ resolved: true })),
      false
    )
  })
})

describe("owner resolved transition", () => {
  it("detects accepted active → resolved", () => {
    assert.equal(
      isOwnerResolvedTransition(claimed(), claimed({ resolved: true })),
      true
    )
  })

  it("ignores no helper", () => {
    assert.equal(
      isOwnerResolvedTransition(
        claimed({ helperUid: "", helperComing: false }),
        claimed({ helperUid: "", helperComing: false, resolved: true })
      ),
      false
    )
  })

  it("ignores already resolved", () => {
    assert.equal(
      isOwnerResolvedTransition(
        claimed({ resolved: true }),
        claimed({ resolved: true })
      ),
      false
    )
  })

  it("ignores self-owner/helper", () => {
    assert.equal(
      isOwnerResolvedTransition(
        claimed({ helperUid: "owner-1" }),
        claimed({ helperUid: "owner-1", resolved: true })
      ),
      false
    )
  })

  it("ignores unrelated update", () => {
    assert.equal(
      isOwnerResolvedTransition(claimed(), claimed({ helperAcceptedAt: 99 })),
      false
    )
  })
})

describe("owner cancelled (delete) transition", () => {
  it("detects accepted active request deleted", () => {
    assert.equal(isOwnerCancelledTransition(claimed()), true)
  })

  it("ignores no helper", () => {
    assert.equal(
      isOwnerCancelledTransition(claimed({ helperUid: "", helperComing: false })),
      false
    )
  })

  it("ignores resolved report deleted", () => {
    assert.equal(isOwnerCancelledTransition(claimed({ resolved: true })), false)
  })

  it("ignores intelligence", () => {
    assert.equal(
      isOwnerCancelledTransition(claimed({ reportFamily: "intelligence" })),
      false
    )
  })

  it("ignores stolen", () => {
    assert.equal(
      isOwnerCancelledTransition(claimed({ reportFamily: "stolen" })),
      false
    )
  })

  it("safe deleted payload omits reportId and report deep link", () => {
    const payload = buildOwnerCancelledPayload("rep-gone", 123)
    assert.equal(payload.reportId, undefined)
    assert.equal(payload.deepLink, "https://app.totimoto.com/?notification=owner_cancelled")
    assert.equal(payload.notificationType, "owner_cancelled")
    assert.equal(payload.tag, "trn-owner-cancelled-rep-gone")
    const map = toFcmDataMap(payload)
    assert.equal("reportId" in map, false)
    assert.equal(payloadContainsForbiddenKeys(map), false)
  })
})

describe("lifecycle orchestration shared behaviors", () => {
  it("helper cancelled sends with helperLifecycle preference", async () => {
    const deps = mockDeps("owner-1", "helperLifecycle")
    const outcome = await processHelperCancelledUpdate(
      "r1",
      claimed(),
      cancelled(),
      deps
    )
    assert.equal(outcome.status, "sent")
    assert.deepEqual(deps.claimedKeys, ["helper_cancelled:r1:1700000000000"])
    assert.equal(deps.sends.length, 1)
  })

  it("owner resolved sends with ownerLifecycle preference", async () => {
    const deps = mockDeps("helper-1", "ownerLifecycle")
    const outcome = await processOwnerResolvedUpdate(
      "r1",
      claimed(),
      claimed({ resolved: true }),
      deps
    )
    assert.equal(outcome.status, "sent")
    assert.deepEqual(deps.claimedKeys, ["owner_resolved:r1"])
  })

  it("owner cancelled sends with ownerLifecycle preference", async () => {
    const deps = mockDeps("helper-1", "ownerLifecycle")
    const outcome = await processOwnerCancelledDelete("r1", claimed(), deps)
    assert.equal(outcome.status, "sent")
    assert.deepEqual(deps.claimedKeys, ["owner_cancelled:r1"])
  })

  it("duplicate idempotency event ignored", async () => {
    const deps = mockDeps("owner-1", "helperLifecycle", {
      claimEventOnce: async () => "duplicate",
    })
    const outcome = await processHelperCancelledUpdate(
      "r1",
      claimed(),
      cancelled(),
      deps
    )
    assert.equal(outcome.status, "duplicate")
    assert.equal(deps.sends.length, 0)
  })

  it("no enabled subscriptions", async () => {
    const deps = mockDeps("owner-1", "helperLifecycle", {
      listSubscriptions: async () => [],
    })
    const outcome = await processHelperCancelledUpdate(
      "r1",
      claimed(),
      cancelled(),
      deps
    )
    assert.equal(outcome.status, "no_subscriptions")
  })

  it("preference disabled", () => {
    const selected = selectEnabledSubscriptions(
      [
        {
          id: "off",
          uid: "helper-1",
          enabled: true,
          permissionState: "granted",
          token: "tok",
          notificationPreferences: { ownerLifecycle: false },
        },
      ],
      "helper-1",
      "ownerLifecycle"
    )
    assert.equal(selected.length, 0)
  })

  it("multiple devices", async () => {
    const deps = mockDeps("helper-1", "ownerLifecycle", {
      listSubscriptions: async () => [
        {
          id: "a",
          uid: "helper-1",
          enabled: true,
          permissionState: "granted",
          token: "t1",
          notificationPreferences: { ownerLifecycle: true },
        },
        {
          id: "b",
          uid: "helper-1",
          enabled: true,
          permissionState: "granted",
          token: "t2",
          notificationPreferences: { ownerLifecycle: true },
        },
      ],
    })
    const outcome = await processOwnerResolvedUpdate(
      "r1",
      claimed(),
      claimed({ resolved: true }),
      deps
    )
    assert.equal(outcome.attempted, 2)
    assert.equal(outcome.success, 2)
    assert.deepEqual(deps.sends, ["t1", "t2"])
  })

  it("malformed token skipped", () => {
    const selected = selectEnabledSubscriptions(
      [
        {
          id: "bad",
          uid: "helper-1",
          enabled: true,
          permissionState: "granted",
          token: "",
          notificationPreferences: { ownerLifecycle: true },
        },
      ],
      "helper-1",
      "ownerLifecycle"
    )
    assert.equal(selected.length, 0)
  })

  it("invalid-token cleanup", async () => {
    const deps = mockDeps("helper-1", "ownerLifecycle", {
      sendDataMessage: async () => ({
        success: false,
        errorCode: "messaging/invalid-registration-token",
      }),
    })
    const outcome = await processOwnerCancelledDelete("r1", claimed(), deps)
    assert.equal(outcome.status, "failed")
    assert.equal(outcome.disabledTokens, 1)
    assert.deepEqual(deps.disabled, ["sub-1"])
    assert.equal(isPermanentInvalidTokenError("messaging/invalid-registration-token"), true)
  })

  it("payloads contain no PII keys", () => {
    for (const payload of [
      toFcmDataMap(buildHelperCancelledPayload("r1", 1)),
      toFcmDataMap(buildOwnerResolvedPayload("r1", 1)),
      toFcmDataMap(buildOwnerCancelledPayload("r1", 1)),
    ]) {
      assert.equal(payloadContainsForbiddenKeys(payload), false)
    }
  })

  it("payload values are all strings", () => {
    const payload = toFcmDataMap(buildOwnerResolvedPayload("r1", 1))
    assert.equal(payloadValuesAreAllStrings(payload), true)
    assert.equal(
      payloadValuesAreAllStrings({ ...payload, bad: 1 }),
      false
    )
  })

  it("event keys follow recommended shapes", () => {
    assert.equal(
      buildHelperCancelledEventKey("r1", claimed()),
      "helper_cancelled:r1:1700000000000"
    )
    assert.equal(buildOwnerResolvedEventKey("r9"), "owner_resolved:r9")
    assert.equal(buildOwnerCancelledEventKey("r9"), "owner_cancelled:r9")
  })
})
