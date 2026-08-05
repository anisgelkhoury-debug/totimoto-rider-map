/**
 * Arabic report time-label helpers.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { timeAgo, timeLeft } from "../../src/utils/reportTimeLabels.ts"

describe("reportTimeLabels", () => {
  const now = Date.UTC(2026, 6, 29, 12, 0, 0)

  it("timeAgo: الآن for current / future skew", () => {
    assert.equal(timeAgo(now, now), "الآن")
    assert.equal(timeAgo(now + 30_000, now), "الآن")
  })

  it("timeAgo: singular and plural minutes", () => {
    assert.equal(timeAgo(now - 60_000, now), "منذ دقيقة")
    assert.equal(timeAgo(now - 5 * 60_000, now), "منذ 5 دقائق")
  })

  it("timeAgo: singular and plural hours", () => {
    assert.equal(timeAgo(now - 60 * 60_000, now), "منذ ساعة")
    assert.equal(timeAgo(now - 3 * 60 * 60_000, now), "منذ 3 ساعات")
  })

  it("timeLeft: expired / singular / plural", () => {
    assert.equal(timeLeft({ createdAt: now - 20 * 60_000, expiry: 10 }, now), "انتهى")
    assert.equal(timeLeft({ createdAt: now - 9 * 60_000, expiry: 10 }, now), "ينتهي خلال دقيقة")
    assert.equal(
      timeLeft({ createdAt: now - 5 * 60_000, expiry: 30 }, now),
      "ينتهي خلال 25 دقيقة"
    )
  })
})
