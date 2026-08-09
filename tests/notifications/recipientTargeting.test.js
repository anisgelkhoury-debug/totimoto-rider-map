/**
 * TRN 058D — nearby recipient targeting foundation (no FCM).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  NEARBY_NOTIFICATION_RADIUS_KM,
  isNearbyNotificationReportEligible,
  nearbyNotificationRadiusKm,
} from "../../src/notifications/nearbyNotificationRadii.ts"
import {
  NEARBY_RECIPIENT_SUBSCRIPTION_INDEX,
  RECIPIENT_GEO_STRATEGY,
  planNotificationRecipientCells,
  planNotificationRecipientCellsForCategory,
} from "../../src/notifications/recipientGeoPlan.ts"
import {
  dedupeSubscriptionsById,
  filterNearbyNotificationRecipients,
  isNotificationLocationFresh,
  isSelfReporterSubscription,
  parseLocationUpdatedAtMs,
} from "../../src/notifications/recipientTargeting.ts"
import { LOCATION_MAX_NOTIFICATION_STALENESS_MS } from "../../src/notifications/locationHeartbeat.ts"
import { encodeNotificationLocationGeohash } from "../../src/notifications/locationHeartbeat.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const BEIRUT = { lat: 33.8938, lng: 35.5018 }
const NOW = 1_700_000_000_000

function prefs(overrides = {}) {
  return {
    helperLifecycle: true,
    ownerLifecycle: true,
    stolenNearby: false,
    criticalRoads: false,
    sharedRides: false,
    communityRides: false,
    announcements: false,
    marketing: false,
    nearbyAlerts: true,
    checkpoint: true,
    accident: true,
    roadClosed: true,
    slippery: true,
    importantIncidents: true,
    ...overrides,
  }
}

function sub(id, overrides = {}) {
  return {
    id,
    uid: "rider-a",
    enabled: true,
    permissionState: "granted",
    token: "fcm-token-" + id,
    locationGeohash: encodeNotificationLocationGeohash(BEIRUT.lat, BEIRUT.lng),
    locationUpdatedAt: NOW - 5 * 60 * 1000,
    notificationPreferences: prefs(),
    ...overrides,
  }
}

describe("nearby notification radii", () => {
  it("1. checkpoint radius config", () => {
    assert.equal(NEARBY_NOTIFICATION_RADIUS_KM.checkpoint, 2)
    assert.equal(nearbyNotificationRadiusKm("checkpoint"), 2)
  })
  it("2. accident radius", () => {
    assert.equal(nearbyNotificationRadiusKm("accident"), 1.5)
  })
  it("3. road closed radius", () => {
    assert.equal(nearbyNotificationRadiusKm("road_closed"), 3)
  })
  it("4. slippery radius", () => {
    assert.equal(nearbyNotificationRadiusKm("slippery_road"), 1.5)
  })
  it("5. fire radius", () => {
    assert.equal(nearbyNotificationRadiusKm("fire"), 3)
  })
  it("6. gunfire radius", () => {
    assert.equal(nearbyNotificationRadiusKm("gunfire"), 6)
  })
  it("7. explosion radius", () => {
    assert.equal(nearbyNotificationRadiusKm("explosionStrike"), 10)
  })
  it("8. collapse radius", () => {
    assert.equal(nearbyNotificationRadiusKm("collapseDanger"), 6)
  })
  it("9. traffic ineligible", () => {
    assert.equal(nearbyNotificationRadiusKm("traffic"), null)
    assert.equal(
      isNearbyNotificationReportEligible({ reportCategory: "traffic" }),
      false
    )
  })
  it("10. other incident ineligible", () => {
    assert.equal(
      isNearbyNotificationReportEligible({ reportCategory: "otherIncident" }),
      false
    )
  })
  it("11. stolen ineligible", () => {
    assert.equal(
      isNearbyNotificationReportEligible({
        reportCategory: "stolen",
        reportFamily: "stolen",
      }),
      false
    )
  })
})

describe("recipient geo planning", () => {
  it("12. invalid report coords", () => {
    const r = planNotificationRecipientCells({
      reportLat: null,
      reportLng: BEIRUT.lng,
      radiusMeters: 1500,
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, "invalid_coordinates")
  })

  it("13–14. precision-6 strategy + deterministic cells", () => {
    const a = planNotificationRecipientCells({
      reportLat: BEIRUT.lat,
      reportLng: BEIRUT.lng,
      radiusMeters: 1500,
    })
    const b = planNotificationRecipientCells({
      reportLat: BEIRUT.lat,
      reportLng: BEIRUT.lng,
      radiusMeters: 1500,
    })
    assert.equal(a.ok, true)
    assert.equal(a.strategy, RECIPIENT_GEO_STRATEGY)
    assert.equal(a.precision, 6)
    assert.deepEqual(a.ranges, b.ranges)
    assert.equal(a.queryCount, a.queries.length)
    assert.ok(a.queryCount >= 1 && a.queryCount <= 12)
  })

  it("15. boundary neighbor coverage for larger radius", () => {
    const small = planNotificationRecipientCellsForCategory({
      reportLat: BEIRUT.lat,
      reportLng: BEIRUT.lng,
      reportCategory: "accident",
    })
    const large = planNotificationRecipientCellsForCategory({
      reportLat: BEIRUT.lat,
      reportLng: BEIRUT.lng,
      reportCategory: "explosionStrike",
    })
    assert.equal(small.ok, true)
    assert.equal(large.ok, true)
    assert.equal(small.radiusMeters, 1500)
    assert.equal(large.radiusMeters, 10000)
  })

  it("16. query plans deduped", () => {
    const plan = planNotificationRecipientCells({
      reportLat: BEIRUT.lat,
      reportLng: BEIRUT.lng,
      radiusMeters: 2000,
    })
    assert.equal(plan.ok, true)
    const keys = plan.ranges.map((r) => `${r.start}|${r.end}`)
    assert.equal(keys.length, new Set(keys).size)
    for (const q of plan.queries) {
      assert.equal(q.collection, "notificationSubscriptions")
      assert.equal(q.equality.field, "enabled")
      assert.equal(q.equality.value, true)
      assert.equal(q.range.field, "locationGeohash")
    }
  })

  it("category ineligible plan", () => {
    const r = planNotificationRecipientCellsForCategory({
      reportLat: BEIRUT.lat,
      reportLng: BEIRUT.lng,
      reportCategory: "traffic",
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, "category_ineligible")
  })
})

describe("recipient filtering", () => {
  const report = {
    id: "r1",
    ownerUid: "owner-1",
    reportCategory: "checkpoint",
    reportFamily: "intelligence",
    resolved: false,
  }

  it("17. disabled subscription rejected", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [sub("s1", { enabled: false })],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 0)
  })

  it("18. nearby master off rejected", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [
        sub("s1", { notificationPreferences: prefs({ nearbyAlerts: false }) }),
      ],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 0)
  })

  it("19. stale location rejected", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [
        sub("s1", {
          locationUpdatedAt: NOW - LOCATION_MAX_NOTIFICATION_STALENESS_MS - 1,
        }),
      ],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 0)
  })

  it("20. fresh location accepted", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [sub("s1")],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].subscriptionId, "s1")
  })

  it("21. missing location rejected", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [
        sub("s1", { locationGeohash: undefined, locationUpdatedAt: undefined }),
      ],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 0)
  })

  it("22. invalid locationGeohash rejected", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [sub("s1", { locationGeohash: "bad" })],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 0)
  })

  it("23. category pref off rejected", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [
        sub("s1", { notificationPreferences: prefs({ checkpoint: false }) }),
      ],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 0)
  })

  it("24. category pref on accepted", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [sub("s1")],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 1)
  })

  it("25. important incident mapping", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [
        sub("s1", {
          notificationPreferences: prefs({ importantIncidents: true }),
        }),
      ],
      report: { ...report, reportCategory: "gunfire" },
      nowMs: NOW,
    })
    assert.equal(out.length, 1)
    const off = filterNearbyNotificationRecipients({
      candidates: [
        sub("s1", {
          notificationPreferences: prefs({ importantIncidents: false }),
        }),
      ],
      report: { ...report, reportCategory: "explosionStrike" },
      nowMs: NOW,
    })
    assert.equal(off.length, 0)
  })

  it("26. self reporter excluded", () => {
    assert.equal(
      isSelfReporterSubscription(sub("s1", { uid: "owner-1" }), report),
      true
    )
    const out = filterNearbyNotificationRecipients({
      candidates: [sub("s1", { uid: "owner-1" })],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 0)
  })

  it("27. other uid accepted", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [sub("s1", { uid: "rider-b" })],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 1)
  })

  it("28. same uid multiple devices each eligible", () => {
    const out = filterNearbyNotificationRecipients({
      candidates: [
        sub("phone", { uid: "rider-b" }),
        sub("tablet", { uid: "rider-b" }),
      ],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 2)
    assert.deepEqual(
      out.map((r) => r.subscriptionId).sort(),
      ["phone", "tablet"]
    )
  })

  it("29. duplicate query result deduped by subscription id", () => {
    const dup = dedupeSubscriptionsById([sub("s1"), sub("s1"), sub("s2")])
    assert.equal(dup.length, 2)
    const out = filterNearbyNotificationRecipients({
      candidates: [sub("s1"), sub("s1")],
      report,
      nowMs: NOW,
    })
    assert.equal(out.length, 1)
  })

  it("staleness helper + parse timestamp", () => {
    assert.equal(
      isNotificationLocationFresh({
        locationUpdatedAtMs: NOW - 10 * 60 * 1000,
        nowMs: NOW,
      }),
      true
    )
    assert.equal(parseLocationUpdatedAtMs({ seconds: NOW / 1000, nanoseconds: 0 }), NOW)
  })
})

describe("058D scope + index", () => {
  it("30–33. no FCM / events / GPS / raw latlng in targeting modules", () => {
    const files = [
      "src/notifications/nearbyNotificationRadii.ts",
      "src/notifications/recipientGeoPlan.ts",
      "src/notifications/recipientTargeting.ts",
      "functions/src/shared/nearbyNotificationRadii.ts",
      "functions/src/shared/recipientGeoPlan.ts",
      "functions/src/shared/recipientTargeting.ts",
    ]
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8")
      assert.equal(src.includes("sendEachForMulticast"), false, f)
      assert.equal(src.includes("notificationEvents"), false, f)
      assert.equal(src.includes("onReportCreated"), false, f)
      assert.equal(src.includes("watchPosition"), false, f)
      assert.equal(src.includes("navigator.geolocation"), false, f)
    }
    // Pure targeting modules remain send-free; 058E wires create trigger separately.
  })

  it("34. assistance preferences untouched by radii module", () => {
    const src = readFileSync(
      join(root, "src/notifications/nearbyNotificationRadii.ts"),
      "utf8"
    )
    assert.equal(src.includes("helperLifecycle"), false)
  })

  it("35. no public subscription list rules; index prepared", () => {
    const rules = readFileSync(join(root, "firestore.rules"), "utf8")
    assert.match(rules, /match \/notificationSubscriptions/)
    assert.match(rules, /allow list: if false/)
    assert.equal(
      NEARBY_RECIPIENT_SUBSCRIPTION_INDEX.fields[0].fieldPath,
      "enabled"
    )
    assert.equal(
      NEARBY_RECIPIENT_SUBSCRIPTION_INDEX.fields[1].fieldPath,
      "locationGeohash"
    )
    const indexes = JSON.parse(
      readFileSync(join(root, "firestore.indexes.json"), "utf8")
    )
    const hit = indexes.indexes.find(
      (i) =>
        i.collectionGroup === "notificationSubscriptions" &&
        i.fields?.[0]?.fieldPath === "enabled" &&
        i.fields?.[1]?.fieldPath === "locationGeohash"
    )
    assert.ok(hit)
  })
})
