/**
 * TRN Task 034B — notification support / hash unit tests.
 * Run: node --experimental-strip-types --test tests/notifications/notificationSupport.test.js
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import {
  evaluateNotificationSupport,
  isInSoftDismissCooldown,
  NOTIFICATION_COOLDOWN_MS,
  resolveSettingsNotificationState,
  settingsStateLabelAr,
  shouldOfferNotificationPromptAfterCreate,
  NOTIF_STORAGE,
} from "../../src/notifications/notificationSupport.ts"
import {
  sha256Hex,
  subscriptionIdFromToken,
} from "../../src/notifications/notificationCrypto.ts"

const memory = new Map()

function mockStorage() {
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => {
      memory.set(k, String(v))
    },
    removeItem: (k) => {
      memory.delete(k)
    },
    clear: () => memory.clear(),
  }
}

describe("notification support detection", () => {
  let prevLocal
  let prevSession

  beforeEach(() => {
    memory.clear()
    prevLocal = globalThis.localStorage
    prevSession = globalThis.sessionStorage
    globalThis.localStorage = mockStorage()
    globalThis.sessionStorage = mockStorage()
  })

  afterEach(() => {
    globalThis.localStorage = prevLocal
    globalThis.sessionStorage = prevSession
  })

  it("1. unsupported browser when APIs missing", () => {
    const r = evaluateNotificationSupport({
      hasNotificationApi: false,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "default",
      isIos: false,
      isStandalone: true,
    })
    assert.equal(r.code, "unsupported_browser")
  })

  it("2. missing vapid key", () => {
    const r = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: false,
      permission: "default",
      isIos: false,
      isStandalone: true,
    })
    assert.equal(r.code, "missing_vapid_key")
    assert.equal(resolveSettingsNotificationState(r), "needs_setup")
  })

  it("3. iPhone Safari not installed", () => {
    const r = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "default",
      isIos: true,
      isStandalone: false,
    })
    assert.equal(r.code, "ios_requires_install")
    assert.equal(settingsStateLabelAr(resolveSettingsNotificationState(r)), "تحتاج تثبيت التطبيق")
  })

  it("4. installed / support-capable", () => {
    const r = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "default",
      isIos: true,
      isStandalone: true,
    })
    assert.equal(r.code, "supported")
  })

  it("5. permission default stays supported", () => {
    const r = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "default",
      isIos: false,
      isStandalone: true,
    })
    assert.equal(r.code, "supported")
    assert.equal(r.permission, "default")
    assert.equal(resolveSettingsNotificationState(r), "inactive")
  })

  it("6. permission granted without local flags is inactive/needs setup path", () => {
    const r = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "granted",
      isIos: false,
      isStandalone: true,
    })
    assert.equal(r.code, "supported")
    assert.equal(resolveSettingsNotificationState(r), "inactive")
  })

  it("7. permission denied", () => {
    const r = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "denied",
      isIos: false,
      isStandalone: true,
    })
    assert.equal(r.code, "permission_denied")
    assert.equal(settingsStateLabelAr(resolveSettingsNotificationState(r)), "مرفوضة من المتصفح")
  })

  it("8–9. soft dismiss cooldown 7 days", () => {
    const now = 1_700_000_000_000
    localStorage.setItem(NOTIF_STORAGE.dismissUntil, String(now + NOTIFICATION_COOLDOWN_MS))
    assert.equal(isInSoftDismissCooldown(now + 1000), true)
    assert.equal(isInSoftDismissCooldown(now + NOTIFICATION_COOLDOWN_MS + 1), false)
  })

  it("10. offer after assistance create respects cooldown", () => {
    const capable = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "default",
      isIos: false,
      isStandalone: true,
    })
    assert.equal(
      shouldOfferNotificationPromptAfterCreate({
        reportFamily: "assistance",
        now: Date.now(),
        support: capable,
      }),
      true
    )
    assert.equal(
      shouldOfferNotificationPromptAfterCreate({
        reportFamily: "intelligence",
        now: Date.now(),
        support: capable,
      }),
      false
    )
    localStorage.setItem(NOTIF_STORAGE.dismissUntil, String(Date.now() + NOTIFICATION_COOLDOWN_MS))
    assert.equal(
      shouldOfferNotificationPromptAfterCreate({
        reportFamily: "sharedRide",
        now: Date.now(),
        support: capable,
      }),
      false
    )
  })

  it("16. subscription id deterministic from token hash", async () => {
    const a = await subscriptionIdFromToken("token-alpha")
    const b = await subscriptionIdFromToken("token-alpha")
    const c = await subscriptionIdFromToken("token-beta")
    if (a === null) {
      // Environment without subtle — acceptable fallback path
      assert.equal(await sha256Hex("x"), null)
      return
    }
    assert.equal(a, b)
    assert.notEqual(a, c)
    assert.equal(a.length, 32)
  })
})
