/**
 * Guardrails for production subscription writes + platform labels.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  ALLOW_PRODUCTION_SUBSCRIPTION_WRITE,
  detectBrowserLabel,
  detectPlatform,
} from "../../src/notifications/subscriptionMeta.ts"

const supportedBase = {
  code: "supported",
  permission: "default",
  isIos: false,
  isStandalone: true,
  hasNotificationApi: true,
  hasServiceWorker: true,
  hasPushManager: true,
  hasVapidKey: true,
}

describe("notification subscription guardrails", () => {
  it("allows production subscription writes when enabled", () => {
    assert.equal(ALLOW_PRODUCTION_SUBSCRIPTION_WRITE, true)
  })

  it("detectPlatform: ios from support flag", () => {
    assert.equal(detectPlatform({ ...supportedBase, isIos: true }), "ios")
  })

  it("detectPlatform: android / desktop from UA", () => {
    const prev = globalThis.navigator
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (Linux; Android 14)" },
    })
    try {
      assert.equal(detectPlatform(supportedBase), "android")
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: prev,
      })
    }

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "Mozilla/5.0 (Windows NT 10.0)" },
    })
    try {
      assert.equal(detectPlatform(supportedBase), "desktop")
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: prev,
      })
    }
  })

  it("detectBrowserLabel covers common engines", () => {
    const prev = globalThis.navigator
    const cases = [
      ["Mozilla/5.0 Edg/120.0", "edge"],
      ["Mozilla/5.0 Chrome/120.0", "chrome"],
      ["Mozilla/5.0 Version/17 Safari/605", "safari"],
      ["Mozilla/5.0 Firefox/120.0", "firefox"],
      ["TotimotoCustom/1.0", "other"],
    ]
    try {
      for (const [ua, expected] of cases) {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: { userAgent: ua },
        })
        assert.equal(detectBrowserLabel(), expected, ua)
      }
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: prev,
      })
    }
  })
})
