/**
 * Nearby Rider Intelligence — pure ranking / radius / distance tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  NEARBY_MAX_RESULTS,
  NEARBY_RADIUS_KM_BY_CATEGORY,
} from "../../src/nearby/nearbyConfig.ts"
import {
  distanceKm,
  distanceMeters,
  formatNearbyChipLabel,
  formatNearbyDistance,
  getNearbyReportCandidates,
  isNearbyEligibleReport,
  nearbyCreatesNotificationPath,
  nearbyRequiresConfirmationQueries,
  rankNearbyReports,
} from "../../src/nearby/nearbyIntelligence.ts"

const BEIRUT = { lat: 33.8938, lng: 35.5018 }

function report(overrides = {}) {
  return {
    id: "r1",
    type: "زحمة",
    emoji: "🚗",
    lat: BEIRUT.lat,
    lng: BEIRUT.lng,
    createdAt: Date.now(),
    expiry: 60,
    resolved: false,
    reportFamily: "intelligence",
    reportCategory: "traffic",
    ...overrides,
  }
}

/** Offset ~east by roughly km (approx at Beirut latitude). */
function offsetKm(base, kmEast, kmNorth = 0) {
  const dLat = kmNorth / 111.32
  const dLng = kmEast / (111.32 * Math.cos((base.lat * Math.PI) / 180))
  return { lat: base.lat + dLat, lng: base.lng + dLng }
}

describe("nearby distance helpers", () => {
  it("distance calculation same point = 0", () => {
    assert.equal(
      distanceMeters(BEIRUT.lat, BEIRUT.lng, BEIRUT.lat, BEIRUT.lng),
      0
    )
    assert.equal(distanceKm(BEIRUT.lat, BEIRUT.lng, BEIRUT.lat, BEIRUT.lng), 0)
  })

  it("distance calculation known approximate distance", () => {
    // ~1 degree lat ≈ 111 km
    const km = distanceKm(0, 0, 1, 0)
    assert.ok(km > 110 && km < 112)
  })

  it("meters formatting", () => {
    assert.equal(formatNearbyDistance(0), "0 م")
    assert.equal(formatNearbyDistance(350), "350 م")
    assert.equal(formatNearbyDistance(999), "999 م")
  })

  it("kilometers formatting", () => {
    assert.equal(formatNearbyDistance(1200), "1.2 كم")
    assert.equal(formatNearbyDistance(4800), "4.8 كم")
    assert.equal(formatNearbyDistance(12500), "13 كم")
  })

  it("Arabic distance formatting", () => {
    assert.ok(formatNearbyDistance(500).includes("م"))
    assert.ok(formatNearbyDistance(2500).includes("كم"))
  })
})

describe("nearby radius filtering", () => {
  const now = Date.now()

  it("traffic inside 3 km included", () => {
    const pos = offsetKm(BEIRUT, 2)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "t-in",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list.length, 1)
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.traffic, 3)
  })

  it("traffic outside 3 km excluded", () => {
    const pos = offsetKm(BEIRUT, 4)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "t-out",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list.length, 0)
  })

  it("checkpoint inside 5 km included", () => {
    const pos = offsetKm(BEIRUT, 4)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "cp-in",
          type: "حاجز",
          reportCategory: "checkpoint",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list.length, 1)
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.checkpoint, 5)
  })

  it("checkpoint outside 5 km excluded", () => {
    const pos = offsetKm(BEIRUT, 6)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "cp-out",
          type: "حاجز",
          reportCategory: "checkpoint",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list.length, 0)
  })

  it("explosion/strike inside 15 km included", () => {
    const pos = offsetKm(BEIRUT, 12)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "ex-in",
          type: "انفجار / غارة",
          reportFamily: "incident",
          reportCategory: "explosionStrike",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now,
          expiry: 90,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list.length, 1)
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.explosionStrike, 15)
  })

  it("explosion/strike outside 15 km excluded", () => {
    const pos = offsetKm(BEIRUT, 16)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "ex-out",
          type: "انفجار / غارة",
          reportFamily: "incident",
          reportCategory: "explosionStrike",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now,
          expiry: 90,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list.length, 0)
  })

  it("road closure radius 7 km", () => {
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.road_closed, 7)
    const inside = offsetKm(BEIRUT, 6)
    const outside = offsetKm(BEIRUT, 8)
    assert.equal(
      getNearbyReportCandidates({
        reports: [
          report({
            id: "rc-in",
            type: "طريق مسكر",
            reportCategory: "road_closed",
            lat: inside.lat,
            lng: inside.lng,
            createdAt: now,
          }),
        ],
        rider: BEIRUT,
        now,
      }).length,
      1
    )
    assert.equal(
      getNearbyReportCandidates({
        reports: [
          report({
            id: "rc-out",
            type: "طريق مسكر",
            reportCategory: "road_closed",
            lat: outside.lat,
            lng: outside.lng,
            createdAt: now,
          }),
        ],
        rider: BEIRUT,
        now,
      }).length,
      0
    )
  })

  it("gunfire radius 8 km", () => {
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.gunfire, 8)
    const pos = offsetKm(BEIRUT, 7)
    assert.equal(
      getNearbyReportCandidates({
        reports: [
          report({
            id: "gf",
            type: "إطلاق نار",
            reportFamily: "incident",
            reportCategory: "gunfire",
            lat: pos.lat,
            lng: pos.lng,
            createdAt: now,
            expiry: 30,
          }),
        ],
        rider: BEIRUT,
        now,
      }).length,
      1
    )
  })

  it("collapse radius 10 km", () => {
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.collapseDanger, 10)
  })

  it("fire radius 5 km", () => {
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.fire, 5)
  })

  it("other incident radius 5 km", () => {
    assert.equal(NEARBY_RADIUS_KM_BY_CATEGORY.otherIncident, 5)
  })
})

describe("nearby eligibility and exclusions", () => {
  const now = Date.now()

  it("assistance excluded", () => {
    assert.equal(
      isNearbyEligibleReport({
        reportFamily: "assistance",
        type: "عطل بالدراجة",
      }),
      false
    )
    const pos = offsetKm(BEIRUT, 0.5)
    assert.equal(
      getNearbyReportCandidates({
        reports: [
          report({
            id: "a1",
            type: "عطل بالدراجة",
            reportFamily: "assistance",
            reportCategory: "bike_broken",
            lat: pos.lat,
            lng: pos.lng,
            createdAt: now,
          }),
        ],
        rider: BEIRUT,
        now,
      }).length,
      0
    )
  })

  it("sharedRide excluded", () => {
    assert.equal(
      isNearbyEligibleReport({
        reportFamily: "sharedRide",
        type: "وصلني معك",
      }),
      false
    )
  })

  it("stolen excluded", () => {
    assert.equal(
      isNearbyEligibleReport({
        reportFamily: "stolen",
        type: "بلاغ عن دراجة مسروقة",
      }),
      false
    )
  })

  it("expired report excluded", () => {
    const pos = offsetKm(BEIRUT, 1)
    const createdAt = now - 120 * 60_000
    assert.equal(
      getNearbyReportCandidates({
        reports: [
          report({
            id: "exp",
            lat: pos.lat,
            lng: pos.lng,
            createdAt,
            expiry: 60,
          }),
        ],
        rider: BEIRUT,
        now,
      }).length,
      0
    )
  })

  it("missing coordinates excluded", () => {
    assert.equal(
      getNearbyReportCandidates({
        reports: [report({ id: "nc", lat: undefined, lng: undefined })],
        rider: BEIRUT,
        now,
      }).length,
      0
    )
  })

  it("missing rider GPS returns no nearby results", () => {
    assert.deepEqual(
      getNearbyReportCandidates({
        reports: [report({ id: "x" })],
        rider: null,
        now,
      }),
      []
    )
  })
})

describe("nearby ranking", () => {
  const now = Date.now()

  it("severe incident outranks ordinary traffic when both relevant", () => {
    const trafficPos = offsetKm(BEIRUT, 1)
    const gunPos = offsetKm(BEIRUT, 6)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "traffic",
          lat: trafficPos.lat,
          lng: trafficPos.lng,
          createdAt: now,
        }),
        report({
          id: "gun",
          type: "إطلاق نار",
          emoji: "⚠️",
          reportFamily: "incident",
          reportCategory: "gunfire",
          lat: gunPos.lat,
          lng: gunPos.lng,
          createdAt: now,
          expiry: 30,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list[0].id, "gun")
    assert.equal(list[1].id, "traffic")
  })

  it("closer report wins within equivalent severity", () => {
    const near = offsetKm(BEIRUT, 1)
    const far = offsetKm(BEIRUT, 2.5)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "far",
          lat: far.lat,
          lng: far.lng,
          createdAt: now,
        }),
        report({
          id: "near",
          lat: near.lat,
          lng: near.lng,
          createdAt: now,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    assert.equal(list[0].id, "near")
  })

  it("fresher report wins reasonable tie", () => {
    const pos = offsetKm(BEIRUT, 1)
    const list = getNearbyReportCandidates({
      reports: [
        report({
          id: "older",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now - 40 * 60_000,
          expiry: 60,
        }),
        report({
          id: "newer",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now - 5 * 60_000,
          expiry: 60,
        }),
      ],
      rider: BEIRUT,
      now,
    })
    // Same severity + same distance → fresher first
    assert.equal(list[0].id, "newer")
  })

  it("result capped at 5", () => {
    assert.equal(NEARBY_MAX_RESULTS, 5)
    const reports = []
    for (let i = 0; i < 8; i++) {
      const pos = offsetKm(BEIRUT, 0.2 * (i + 1))
      reports.push(
        report({
          id: `cap-${i}`,
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now,
        })
      )
    }
    const list = getNearbyReportCandidates({
      reports,
      rider: BEIRUT,
      now,
    })
    assert.equal(list.length, 5)
  })

  it("deterministic ordering", () => {
    const a = offsetKm(BEIRUT, 1)
    const b = offsetKm(BEIRUT, 2)
    const reports = [
      report({ id: "b", lat: b.lat, lng: b.lng, createdAt: now }),
      report({ id: "a", lat: a.lat, lng: a.lng, createdAt: now }),
    ]
    const first = getNearbyReportCandidates({ reports, rider: BEIRUT, now })
    const second = getNearbyReportCandidates({ reports, rider: BEIRUT, now })
    assert.deepEqual(
      first.map((c) => c.id),
      second.map((c) => c.id)
    )
    assert.deepEqual(
      rankNearbyReports(first).map((c) => c.id),
      first.map((c) => c.id)
    )
  })

  it("chip labels Arabic singular/plural", () => {
    assert.equal(formatNearbyChipLabel(1), "بلاغ قريب منك")
    assert.equal(formatNearbyChipLabel(3), "3 بلاغات قريبة منك")
    assert.equal(formatNearbyChipLabel(0), "")
  })

  it("no confirmation query requirement", () => {
    assert.equal(nearbyRequiresConfirmationQueries(), false)
  })

  it("no notification integration", () => {
    assert.equal(nearbyCreatesNotificationPath(), false)
  })

  it("existing selected-report identity preserved", () => {
    const pos = offsetKm(BEIRUT, 1)
    const source = report({
      id: "preserve-me",
      lat: pos.lat,
      lng: pos.lng,
      createdAt: now,
    })
    const list = getNearbyReportCandidates({
      reports: [source],
      rider: BEIRUT,
      now,
    })
    assert.equal(list[0].id, "preserve-me")
    assert.equal(list[0].report.id, "preserve-me")
  })
})
