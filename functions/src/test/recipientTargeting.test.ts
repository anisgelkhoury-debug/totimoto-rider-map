import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  NEARBY_NOTIFICATION_RADIUS_KM,
  isNearbyNotificationReportEligible,
} from "../shared/nearbyNotificationRadii"
import {
  planNotificationRecipientCells,
  planNotificationRecipientCellsForCategory,
} from "../shared/recipientGeoPlan"
import {
  dedupeSubscriptionsById,
  filterNearbyNotificationRecipients,
} from "../shared/recipientTargeting"

describe("functions recipient targeting (058D)", () => {
  it("locks V1 radii", () => {
    assert.equal(NEARBY_NOTIFICATION_RADIUS_KM.accident, 1.5)
    assert.equal(NEARBY_NOTIFICATION_RADIUS_KM.explosionStrike, 10)
  })

  it("traffic ineligible", () => {
    assert.equal(
      isNearbyNotificationReportEligible({ reportCategory: "traffic" }),
      false
    )
  })

  it("plans geohash range queries", () => {
    const plan = planNotificationRecipientCells({
      reportLat: 33.8938,
      reportLng: 35.5018,
      radiusMeters: 2000,
    })
    assert.equal(plan.ok, true)
    if (plan.ok) {
      assert.ok(plan.queryCount >= 1)
      assert.equal(plan.queries[0].equality.value, true)
    }
  })

  it("category plan uses radius map", () => {
    const plan = planNotificationRecipientCellsForCategory({
      reportLat: 33.8938,
      reportLng: 35.5018,
      reportCategory: "gunfire",
    })
    assert.equal(plan.ok, true)
    if (plan.ok) assert.equal(plan.radiusMeters, 6000)
  })

  it("filters + dedupes candidates without sending", () => {
    const now = Date.now()
    const docs = [
      {
        id: "a",
        uid: "u1",
        enabled: true,
        permissionState: "granted",
        token: "tok-a",
        locationGeohash: "sy10zf",
        locationUpdatedAt: now,
        notificationPreferences: { nearbyAlerts: true, checkpoint: true },
      },
      {
        id: "a",
        uid: "u1",
        enabled: true,
        permissionState: "granted",
        token: "tok-a",
        locationGeohash: "sy10zf",
        locationUpdatedAt: now,
        notificationPreferences: { nearbyAlerts: true, checkpoint: true },
      },
    ]
    assert.equal(dedupeSubscriptionsById(docs).length, 1)
    const eligible = filterNearbyNotificationRecipients({
      candidates: docs,
      report: {
        ownerUid: "owner",
        reportCategory: "checkpoint",
        reportFamily: "intelligence",
      },
      nowMs: now,
    })
    assert.equal(eligible.length, 1)
  })
})
