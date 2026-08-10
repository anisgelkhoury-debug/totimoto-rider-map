/**
 * TRN 058G-DIAG — notification activation UX / permission branching.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  deniedRequiresBrowserSettingsHint,
  shouldRequestBrowserPermission,
} from "../../src/notifications/notificationActivationFlow.ts"
import {
  NOTIFICATION_SETTINGS_COPY_AR,
  defaultNotificationPreferences,
} from "../../src/notifications/notificationPreferences.ts"
import {
  resolveSettingsNotificationState,
  shouldCloseSettingsBeforeNotificationEnable,
  evaluateNotificationSupport,
  NOTIF_STORAGE,
} from "../../src/notifications/notificationSupport.ts"

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

describe("058G-DIAG notification activation flow", () => {
  let prevLocal

  it("1. settings enable must not close parent sheet first", () => {
    assert.equal(shouldCloseSettingsBeforeNotificationEnable(), false)
  })

  it("2. permission default requests browser permission", () => {
    assert.equal(shouldRequestBrowserPermission("default"), true)
  })

  it("3. permission granted skips re-prompt", () => {
    assert.equal(shouldRequestBrowserPermission("granted"), false)
  })

  it("4. denied requires browser-settings Arabic hint", () => {
    assert.equal(deniedRequiresBrowserSettingsHint("denied"), true)
    assert.match(
      NOTIFICATION_SETTINGS_COPY_AR.deniedHint,
      /إعدادات المتصفح/
    )
  })

  it("5. activate copy is explicit", () => {
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.enable, "تفعيل الإشعارات")
    assert.ok(NOTIFICATION_SETTINGS_COPY_AR.enabling)
  })

  it("6. nearby remains separate default OFF", () => {
    const prefs = defaultNotificationPreferences()
    assert.equal(prefs.nearbyAlerts, false)
    assert.equal(prefs.accident, true)
  })

  it("7. inactive when local flags missing even if APIs ok", () => {
    prevLocal = globalThis.localStorage
    memory.clear()
    globalThis.localStorage = mockStorage()
    try {
      const support = evaluateNotificationSupport({
        hasNotificationApi: true,
        hasServiceWorker: true,
        hasPushManager: true,
        hasVapidKey: true,
        permission: "granted",
        isIos: false,
        isStandalone: true,
      })
      assert.equal(resolveSettingsNotificationState(support), "inactive")
    } finally {
      globalThis.localStorage = prevLocal
    }
  })

  it("8. active only with local+server flags and granted", () => {
    prevLocal = globalThis.localStorage
    memory.clear()
    globalThis.localStorage = mockStorage()
    try {
      localStorage.setItem(NOTIF_STORAGE.localEnabled, "1")
      localStorage.setItem(NOTIF_STORAGE.serverRegistered, "1")
      const support = evaluateNotificationSupport({
        hasNotificationApi: true,
        hasServiceWorker: true,
        hasPushManager: true,
        hasVapidKey: true,
        permission: "granted",
        isIos: false,
        isStandalone: true,
      })
      assert.equal(resolveSettingsNotificationState(support), "active")
    } finally {
      globalThis.localStorage = prevLocal
    }
  })

  it("9. denied state surfaces actionable UI path", () => {
    const support = evaluateNotificationSupport({
      hasNotificationApi: true,
      hasServiceWorker: true,
      hasPushManager: true,
      hasVapidKey: true,
      permission: "denied",
      isIos: false,
      isStandalone: true,
    })
    assert.equal(resolveSettingsNotificationState(support), "denied")
  })

  it("10. location not required for basic notification activation copy", () => {
    assert.doesNotMatch(
      NOTIFICATION_SETTINGS_COPY_AR.enable,
      /موقع/
    )
    assert.match(NOTIFICATION_SETTINGS_COPY_AR.needLocation, /الموقع/)
  })
})
