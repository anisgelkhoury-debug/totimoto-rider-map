/**
 * Helper-accepted notification unit tests (no real FCM / production writes).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  processHelperAcceptedUpdate,
  type HelperAcceptedDeps,
} from "../helperAccepted/handler"
import {
  buildHelperAcceptedPayload,
  payloadContainsForbiddenKeys,
} from "../helperAccepted/payload"
import {
  isPermanentInvalidTokenError,
  selectEnabledHelperLifecycleSubscriptions,
} from "../helperAccepted/subscriptions"
import {
  buildHelperAcceptedEventKey,
  isHelperAcceptedTransition,
  type ReportSnapshot,
} from "../helperAccepted/transition"

function baseAfter(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
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

function baseBefore(overrides: Partial<ReportSnapshot> = {}): ReportSnapshot {
  return {
    ownerUid: "owner-1",
    helperUid: "",
    helperComing: false,
    resolved: false,
    reportFamily: "assistance",
    ...overrides,
  }
}

function mockDeps(overrides: Partial<HelperAcceptedDeps> = {}): HelperAcceptedDeps & {
  sends: string[]
  disabled: string[]
} {
  const sends: string[] = []
  const disabled: string[] = []
  return {
    sends,
    disabled,
    claimEventOnce: async () => "claimed",
    listSubscriptions: async () => [
      {
        id: "sub-1",
        uid: "owner-1",
        enabled: true,
        permissionState: "granted",
        token: "token-aaaa",
        notificationPreferences: { helperLifecycle: true },
      },
    ],
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

describe("helper accepted transition detection", () => {
  it("detects assistance accepted", () => {
    assert.equal(isHelperAcceptedTransition(baseBefore(), baseAfter()), true)
  })

  it("detects sharedRide accepted", () => {
    assert.equal(
      isHelperAcceptedTransition(
        baseBefore({ reportFamily: "sharedRide" }),
        baseAfter({ reportFamily: "sharedRide" })
      ),
      true
    )
  })

  it("ignores road-intelligence", () => {
    assert.equal(
      isHelperAcceptedTransition(
        baseBefore({ reportFamily: "intelligence" }),
        baseAfter({ reportFamily: "intelligence" })
      ),
      false
    )
  })

  it("ignores stolen", () => {
    assert.equal(
      isHelperAcceptedTransition(
        baseBefore({ reportFamily: "stolen" }),
        baseAfter({ reportFamily: "stolen" })
      ),
      false
    )
  })

  it("ignores missing ownerUid", () => {
    assert.equal(
      isHelperAcceptedTransition(baseBefore(), baseAfter({ ownerUid: "" })),
      false
    )
  })

  it("ignores missing helperUid", () => {
    assert.equal(
      isHelperAcceptedTransition(baseBefore(), baseAfter({ helperUid: "" })),
      false
    )
  })

  it("ignores owner == helper", () => {
    assert.equal(
      isHelperAcceptedTransition(
        baseBefore(),
        baseAfter({ helperUid: "owner-1" })
      ),
      false
    )
  })

  it("ignores already claimed update", () => {
    assert.equal(
      isHelperAcceptedTransition(
        baseBefore({ helperUid: "helper-1", helperComing: true }),
        baseAfter()
      ),
      false
    )
  })

  it("ignores helper GPS-only update", () => {
    assert.equal(
      isHelperAcceptedTransition(
        baseBefore({ helperUid: "helper-1", helperComing: true }),
        baseAfter({ helperAcceptedAt: 1700000000999 })
      ),
      false
    )
  })

  it("ignores resolved report", () => {
    assert.equal(
      isHelperAcceptedTransition(baseBefore(), baseAfter({ resolved: true })),
      false
    )
  })
})

describe("helper accepted orchestration", () => {
  it("ignores duplicate event", async () => {
    const deps = mockDeps({
      claimEventOnce: async () => "duplicate",
    })
    const outcome = await processHelperAcceptedUpdate(
      "r1",
      baseBefore(),
      baseAfter(),
      deps
    )
    assert.equal(outcome.status, "duplicate")
    assert.equal(deps.sends.length, 0)
  })

  it("ignores preference off / no subscriptions", async () => {
    const deps = mockDeps({
      listSubscriptions: async () => [],
    })
    const outcome = await processHelperAcceptedUpdate(
      "r1",
      baseBefore(),
      baseAfter(),
      deps
    )
    assert.equal(outcome.status, "no_subscriptions")
  })

  it("selects multiple subscriptions", async () => {
    const deps = mockDeps({
      listSubscriptions: async () => [
        {
          id: "a",
          uid: "owner-1",
          enabled: true,
          permissionState: "granted",
          token: "t1",
          notificationPreferences: { helperLifecycle: true },
        },
        {
          id: "b",
          uid: "owner-1",
          enabled: true,
          permissionState: "granted",
          token: "t2",
          notificationPreferences: { helperLifecycle: true },
        },
        {
          id: "c",
          uid: "owner-1",
          enabled: true,
          permissionState: "granted",
          token: "",
          notificationPreferences: { helperLifecycle: true },
        },
      ],
    })
    const outcome = await processHelperAcceptedUpdate(
      "r1",
      baseBefore(),
      baseAfter(),
      deps
    )
    assert.equal(outcome.status, "sent")
    assert.equal(outcome.attempted, 2)
    assert.equal(outcome.success, 2)
    assert.deepEqual(deps.sends, ["t1", "t2"])
  })

  it("skips malformed token", () => {
    const selected = selectEnabledHelperLifecycleSubscriptions(
      [
        {
          id: "bad",
          uid: "owner-1",
          enabled: true,
          permissionState: "granted",
          token: "   ",
          notificationPreferences: { helperLifecycle: true },
        },
      ],
      "owner-1"
    )
    assert.equal(selected.length, 0)
  })

  it("disables permanently invalid tokens", async () => {
    const deps = mockDeps({
      sendDataMessage: async () => ({
        success: false,
        errorCode: "messaging/registration-token-not-registered",
      }),
    })
    const outcome = await processHelperAcceptedUpdate(
      "r1",
      baseBefore(),
      baseAfter(),
      deps
    )
    assert.equal(outcome.status, "failed")
    assert.equal(outcome.reason, "all_sends_failed")
    assert.equal(outcome.disabledTokens, 1)
    assert.deepEqual(deps.disabled, ["sub-1"])
  })

  it("releases claim on total transient FCM failure", async () => {
    const released: string[] = []
    const deps = mockDeps({
      sendDataMessage: async () => ({
        success: false,
        errorCode: "messaging/server-unavailable",
      }),
      releaseEventClaim: async (key) => {
        released.push(key)
      },
    })
    const outcome = await processHelperAcceptedUpdate(
      "r1",
      baseBefore(),
      baseAfter(),
      deps
    )
    assert.equal(outcome.status, "failed")
    assert.equal(outcome.reason, "transient_all_failed_retryable")
    assert.deepEqual(released, ["helper_accepted:r1:1700000000000"])
  })

  it("invalid-token cleanup decision helpers", () => {
    assert.equal(
      isPermanentInvalidTokenError("messaging/invalid-registration-token"),
      true
    )
    assert.equal(isPermanentInvalidTokenError("messaging/server-unavailable"), false)
  })

  it("safe payload contains no PII", () => {
    const payload = buildHelperAcceptedPayload("rep-9", 123)
    assert.equal(payload.notificationType, "helper_accepted")
    assert.equal(
      payload.deepLink,
      "https://app.totimoto.com/?report=rep-9&notification=helper_accepted"
    )
    assert.equal(payload.tag, "trn-helper-accepted-rep-9")
    assert.equal(
      payloadContainsForbiddenKeys(payload as unknown as Record<string, unknown>),
      false
    )
    assert.equal(
      payloadContainsForbiddenKeys({ ...payload, phone: "03123456" }),
      true
    )
  })

  it("event key uses helperAcceptedAt when present", () => {
    assert.equal(
      buildHelperAcceptedEventKey("r1", baseAfter()),
      "helper_accepted:r1:1700000000000"
    )
  })

  it("filters preference off", () => {
    const selected = selectEnabledHelperLifecycleSubscriptions(
      [
        {
          id: "off",
          uid: "owner-1",
          enabled: true,
          permissionState: "granted",
          token: "tok",
          notificationPreferences: { helperLifecycle: false },
        },
      ],
      "owner-1"
    )
    assert.equal(selected.length, 0)
  })
})
