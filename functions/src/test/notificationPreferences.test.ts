import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  isNearbyCategoryEnabled,
  isSubscriptionEligibleForNearbyAlert,
  normalizeNotificationPreferences,
} from "../shared/notificationPreferences"

describe("functions notificationPreferences (058B foundation)", () => {
  it("nearbyAlerts absent → false", () => {
    assert.equal(normalizeNotificationPreferences({}).nearbyAlerts, false)
  })

  it("traffic / stolen never eligible", () => {
    const prefs = normalizeNotificationPreferences({ nearbyAlerts: true })
    assert.equal(isNearbyCategoryEnabled(prefs, "traffic"), false)
    assert.equal(isNearbyCategoryEnabled(prefs, "stolen"), false)
  })

  it("disabled subscription never eligible", () => {
    assert.equal(
      isSubscriptionEligibleForNearbyAlert(
        {
          enabled: false,
          permissionState: "granted",
          notificationPreferences: { nearbyAlerts: true, checkpoint: true },
        },
        "checkpoint"
      ),
      false
    )
  })

  it("does not change assistance preference defaults", () => {
    const n = normalizeNotificationPreferences({})
    assert.equal(n.helperLifecycle, true)
    assert.equal(n.ownerLifecycle, true)
  })
})
