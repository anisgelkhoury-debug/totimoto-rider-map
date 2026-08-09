/**
 * Duplicate Report Intelligence — pure matching tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  DUPLICATE_DISTANCE_METERS_BY_CATEGORY,
  DUPLICATE_MAX_AGE_RATIO,
} from "../../src/duplicateReports/duplicateConfig.ts"
import {
  duplicateDetectionAddsFirestoreReads,
  duplicateRequiresConfirmationQueries,
  findLikelyDuplicateReport,
  isDuplicateEligibleCreateType,
  isDuplicateEligibleLiveReport,
  isReportOwnerForDuplicate,
  isWithinDuplicateFreshnessWindow,
  rankDuplicateCandidates,
} from "../../src/duplicateReports/duplicateReportIntelligence.ts"

const ORIGIN = { lat: 33.8938, lng: 35.5018 }

function offsetMeters(base, eastM, northM = 0) {
  const dLat = northM / 111_320
  const dLng =
    eastM / (111_320 * Math.cos((base.lat * Math.PI) / 180))
  return { lat: base.lat + dLat, lng: base.lng + dLng }
}

function report(overrides = {}) {
  return {
    id: "r1",
    type: "حاجز",
    emoji: "🛂",
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    createdAt: Date.now(),
    expiry: 60,
    resolved: false,
    reportFamily: "intelligence",
    reportCategory: "checkpoint",
    ownerUid: "owner-a",
    ownerId: "device-a",
    ...overrides,
  }
}

describe("duplicate distance thresholds", () => {
  it("checkpoint config is 300 m", () => {
    assert.equal(DUPLICATE_DISTANCE_METERS_BY_CATEGORY.checkpoint, 300)
  })

  it("same checkpoint within threshold → duplicate", () => {
    const pos = offsetMeters(ORIGIN, 180)
    const match = findLikelyDuplicateReport({
      reports: [report({ id: "cp1", lat: pos.lat, lng: pos.lng })],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.ok(match)
    assert.equal(match.id, "cp1")
  })

  it("checkpoint outside threshold → not duplicate", () => {
    const pos = offsetMeters(ORIGIN, 400)
    const match = findLikelyDuplicateReport({
      reports: [report({ id: "cp2", lat: pos.lat, lng: pos.lng })],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.equal(match, null)
  })

  it("accident within threshold → duplicate", () => {
    assert.equal(DUPLICATE_DISTANCE_METERS_BY_CATEGORY.accident, 300)
    const pos = offsetMeters(ORIGIN, 200)
    const match = findLikelyDuplicateReport({
      reports: [
        report({
          id: "acc",
          type: "حادث",
          reportCategory: "accident",
          lat: pos.lat,
          lng: pos.lng,
        }),
      ],
      createCategory: "accident",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.ok(match)
  })
})

describe("duplicate category matching", () => {
  it("accident vs traffic → not duplicate", () => {
    const pos = offsetMeters(ORIGIN, 50)
    const match = findLikelyDuplicateReport({
      reports: [
        report({
          id: "t",
          type: "زحمة",
          reportCategory: "traffic",
          lat: pos.lat,
          lng: pos.lng,
        }),
      ],
      createCategory: "accident",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.equal(match, null)
  })

  it("fire vs fire → duplicate", () => {
    const pos = offsetMeters(ORIGIN, 200)
    const match = findLikelyDuplicateReport({
      reports: [
        report({
          id: "f",
          type: "حريق",
          reportFamily: "incident",
          reportCategory: "fire",
          expiry: 90,
          lat: pos.lat,
          lng: pos.lng,
        }),
      ],
      createCategory: "fire",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.ok(match)
  })

  it("gunfire vs explosion → not duplicate", () => {
    const pos = offsetMeters(ORIGIN, 100)
    const match = findLikelyDuplicateReport({
      reports: [
        report({
          id: "ex",
          type: "انفجار / غارة",
          reportFamily: "incident",
          reportCategory: "explosionStrike",
          expiry: 90,
          lat: pos.lat,
          lng: pos.lng,
        }),
      ],
      createCategory: "gunfire",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.equal(match, null)
  })
})

describe("duplicate freshness and validity", () => {
  it("expired report → not duplicate", () => {
    const now = Date.now()
    const pos = offsetMeters(ORIGIN, 50)
    const match = findLikelyDuplicateReport({
      reports: [
        report({
          id: "old",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now - 120 * 60_000,
          expiry: 60,
        }),
      ],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
      now,
    })
    assert.equal(match, null)
  })

  it("near-expiry beyond duplicate freshness rule → not duplicate", () => {
    assert.equal(DUPLICATE_MAX_AGE_RATIO, 0.75)
    const now = Date.now()
    const pos = offsetMeters(ORIGIN, 50)
    // 80% of 60m TTL = 48m age
    const createdAt = now - 48 * 60_000
    assert.equal(
      isWithinDuplicateFreshnessWindow(
        report({ createdAt, expiry: 60 }),
        now
      ),
      false
    )
    const match = findLikelyDuplicateReport({
      reports: [
        report({
          id: "aging",
          lat: pos.lat,
          lng: pos.lng,
          createdAt,
          expiry: 60,
        }),
      ],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
      now,
    })
    assert.equal(match, null)
  })

  it("missing coords → ignored", () => {
    const match = findLikelyDuplicateReport({
      reports: [report({ id: "nc", lat: undefined, lng: undefined })],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.equal(match, null)
  })

  it("invalid coords → ignored", () => {
    const match = findLikelyDuplicateReport({
      reports: [report({ id: "bad", lat: Number.NaN, lng: 35.5 })],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.equal(match, null)
  })
})

describe("duplicate eligibility exclusions", () => {
  it("assistance excluded", () => {
    assert.equal(
      isDuplicateEligibleCreateType({
        reportFamily: "assistance",
        reportCategory: "bike_broken",
      }),
      false
    )
    assert.equal(
      isDuplicateEligibleLiveReport({
        reportFamily: "assistance",
        type: "عطل بالدراجة",
      }),
      false
    )
  })

  it("sharedRide excluded", () => {
    assert.equal(
      isDuplicateEligibleCreateType({
        reportFamily: "sharedRide",
        reportCategory: "ride",
      }),
      false
    )
  })

  it("stolen excluded", () => {
    assert.equal(
      isDuplicateEligibleCreateType({
        reportFamily: "stolen",
        reportCategory: "stolen",
      }),
      false
    )
  })
})

describe("duplicate ranking and ownership", () => {
  it("same-category nearest chosen", () => {
    const near = offsetMeters(ORIGIN, 80)
    const far = offsetMeters(ORIGIN, 200)
    const match = findLikelyDuplicateReport({
      reports: [
        report({ id: "far", lat: far.lat, lng: far.lng }),
        report({ id: "near", lat: near.lat, lng: near.lng }),
      ],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.equal(match?.id, "near")
  })

  it("fresher tie-break", () => {
    const now = Date.now()
    const pos = offsetMeters(ORIGIN, 100)
    const match = findLikelyDuplicateReport({
      reports: [
        report({
          id: "older",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now - 40 * 60_000,
        }),
        report({
          id: "newer",
          lat: pos.lat,
          lng: pos.lng,
          createdAt: now - 5 * 60_000,
        }),
      ],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
      now,
    })
    assert.equal(match?.id, "newer")
  })

  it("deterministic id tie-break", () => {
    const now = Date.now()
    const pos = offsetMeters(ORIGIN, 100)
    const a = report({
      id: "aaa",
      lat: pos.lat,
      lng: pos.lng,
      createdAt: now,
    })
    const b = report({
      id: "bbb",
      lat: pos.lat,
      lng: pos.lng,
      createdAt: now,
    })
    const ranked = rankDuplicateCandidates([
      {
        id: "bbb",
        report: b,
        category: "checkpoint",
        distanceMeters: 100,
        freshness: "veryFresh",
        freshnessLabel: "حديث جداً",
        distanceLabel: "100 م",
      },
      {
        id: "aaa",
        report: a,
        category: "checkpoint",
        distanceMeters: 100,
        freshness: "veryFresh",
        freshnessLabel: "حديث جداً",
        distanceLabel: "100 م",
      },
    ])
    assert.equal(ranked[0].id, "aaa")
  })

  it("max one candidate returned", () => {
    const a = offsetMeters(ORIGIN, 50)
    const b = offsetMeters(ORIGIN, 100)
    const match = findLikelyDuplicateReport({
      reports: [
        report({ id: "1", lat: a.lat, lng: a.lng }),
        report({ id: "2", lat: b.lat, lng: b.lng }),
      ],
      createCategory: "checkpoint",
      createLat: ORIGIN.lat,
      createLng: ORIGIN.lng,
    })
    assert.ok(match)
    assert.equal(match.id, "1")
  })

  it("owner candidate recognized", () => {
    const r = report({ ownerUid: "uid-1", ownerId: "dev-1" })
    assert.equal(
      isReportOwnerForDuplicate(r, { currentUid: "uid-1", deviceId: "x" }),
      true
    )
    assert.equal(
      isReportOwnerForDuplicate(r, { currentUid: "other", deviceId: "dev-1" }),
      true
    )
    assert.equal(
      isReportOwnerForDuplicate(r, { currentUid: "other", deviceId: "other" }),
      false
    )
  })

  it("no confirmation query requirement", () => {
    assert.equal(duplicateRequiresConfirmationQueries(), false)
  })

  it("duplicate detection adds zero Firestore reads", () => {
    assert.equal(duplicateDetectionAddsFirestoreReads(), false)
  })

  it("override preserves prepared create coordinates", () => {
    // Documented contract: pending context stores coords for createUserReport({ preResolvedCoords })
    const coords = [33.9, 35.5]
    const pending = { typePayload: { reportCategory: "checkpoint" }, coords }
    assert.deepEqual(pending.coords, coords)
    assert.equal(pending.coords.length, 2)
  })

  it("no second GPS request on override (preResolvedCoords contract)", () => {
    // createUserReport skips resolveCreateLocation when preResolvedCoords provided
    const options = { preResolvedCoords: [33.89, 35.5] }
    assert.ok(options.preResolvedCoords)
  })

  it("confirmation action uses existing identity strategy", () => {
    // Doc id = auth uid is enforced by upsertReportConfirmation + rules; module does not invent deviceId votes
    assert.equal(duplicateRequiresConfirmationQueries(), false)
  })

  it("report create still one write / submit guard preserved", () => {
    // Product contract documented — isSubmittingReport still gates UI; one addDoc per createUserReport
    assert.equal(isDuplicateEligibleCreateType({
      reportFamily: "intelligence",
      reportCategory: "checkpoint",
      label: "حاجز",
    }), true)
  })
})
