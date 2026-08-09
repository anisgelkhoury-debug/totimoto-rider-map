/**
 * TRN 058B — disable / re-enable preference preservation + id stability.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  mergePreferencesForReenable,
  normalizeNotificationPreferences,
  subscriptionDisableUpdateFields,
} from "../../src/notifications/notificationPreferences.ts"
import { subscriptionIdFromToken } from "../../src/notifications/notificationCrypto.ts"

describe("subscription disable / re-enable", () => {
  it("15. server-side disable writes enabled false", () => {
    assert.deepEqual(subscriptionDisableUpdateFields(), { enabled: false })
  })

  it("16. re-enable keeps token out of disable patch (enabled flips separately)", () => {
    const disable = subscriptionDisableUpdateFields()
    assert.equal("token" in disable, false)
    assert.equal(disable.enabled, false)
  })

  it("17. preferences preserved on re-enable", () => {
    const existing = {
      helperLifecycle: false,
      ownerLifecycle: false,
      stolenNearby: false,
      criticalRoads: false,
      sharedRides: false,
      communityRides: false,
      announcements: false,
      marketing: false,
      nearbyAlerts: true,
      checkpoint: false,
      accident: true,
      roadClosed: true,
      slippery: false,
      importantIncidents: true,
    }
    const merged = mergePreferencesForReenable(existing)
    assert.equal(merged.nearbyAlerts, true)
    assert.equal(merged.helperLifecycle, false)
    assert.equal(merged.checkpoint, false)
    assert.equal(merged.accident, true)
    assert.deepEqual(
      mergePreferencesForReenable(existing, undefined),
      normalizeNotificationPreferences(existing)
    )
  })

  it("18. no duplicate subscription id for same token", async () => {
    const a = await subscriptionIdFromToken("same-token-value")
    const b = await subscriptionIdFromToken("same-token-value")
    const c = await subscriptionIdFromToken("other-token-value")
    assert.ok(a)
    assert.equal(a, b)
    assert.notEqual(a, c)
  })

  it("first create uses defaults when no existing doc", () => {
    const prefs = mergePreferencesForReenable(null)
    assert.equal(prefs.nearbyAlerts, false)
    assert.equal(prefs.helperLifecycle, true)
  })
})
