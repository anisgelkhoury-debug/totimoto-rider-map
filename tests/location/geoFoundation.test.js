/**
 * TRN 057A — Geographic query foundation (pure helpers).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  GEO_HASH_STORE_PRECISION,
  RIDER_NEARBY_MAX_RADIUS_M,
  STOLEN_GEO_QUERY_STRATEGY,
  buildReportGeoMetadata,
  dedupeGeohashRanges,
  deriveExpiresAt,
  encodeReportGeohash,
  expiresAtOrNull,
  isValidGeoCoordinate,
  mergeGeoReportSets,
  planGeohashQueryRanges,
  planRiderCenteredGeoQuery,
  planViewportGeoQuery,
  readLegacyGeoFields,
} from "../../src/geo/index.ts"

const BEIRUT = { lat: 33.8938, lng: 35.5018 }
const TRIPOLI = { lat: 34.4367, lng: 35.8497 }
const TYRE = { lat: 33.2705, lng: 35.2033 }

describe("geo coordinates", () => {
  it("valid Beirut coordinates accepted", () => {
    assert.equal(isValidGeoCoordinate(BEIRUT.lat, BEIRUT.lng), true)
  })

  it("valid north Lebanon coordinates accepted", () => {
    assert.equal(isValidGeoCoordinate(TRIPOLI.lat, TRIPOLI.lng), true)
  })

  it("valid south Lebanon coordinates accepted", () => {
    assert.equal(isValidGeoCoordinate(TYRE.lat, TYRE.lng), true)
  })

  it("invalid latitude rejected", () => {
    assert.equal(isValidGeoCoordinate(91, 35), false)
    assert.equal(isValidGeoCoordinate(-91, 35), false)
  })

  it("invalid longitude rejected", () => {
    assert.equal(isValidGeoCoordinate(33, 181), false)
    assert.equal(isValidGeoCoordinate(33, -181), false)
  })

  it("NaN rejected", () => {
    assert.equal(isValidGeoCoordinate(Number.NaN, 35), false)
    assert.equal(isValidGeoCoordinate(33, Number.NaN), false)
  })

  it("extreme latitude rejected for query planning", () => {
    const r = planGeohashQueryRanges(89.5, 0, 1000)
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, "unsafe_latitude")
  })
})

describe("geohash encoding", () => {
  it("valid Beirut coordinates generate geohash", () => {
    const r = encodeReportGeohash(BEIRUT.lat, BEIRUT.lng)
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.geohash.length, GEO_HASH_STORE_PRECISION)
      assert.match(r.geohash, /^[0-9bcdefghjkmnpqrstuvwxyz]+$/)
    }
  })

  it("geohash deterministic", () => {
    const a = encodeReportGeohash(BEIRUT.lat, BEIRUT.lng)
    const b = encodeReportGeohash(BEIRUT.lat, BEIRUT.lng)
    assert.equal(a.ok, true)
    assert.equal(b.ok, true)
    if (a.ok && b.ok) assert.equal(a.geohash, b.geohash)
  })

  it("nearby points share sensible prefix", () => {
    const a = encodeReportGeohash(BEIRUT.lat, BEIRUT.lng)
    const b = encodeReportGeohash(BEIRUT.lat + 0.0005, BEIRUT.lng + 0.0005)
    assert.equal(a.ok && b.ok, true)
    if (a.ok && b.ok) {
      assert.equal(a.geohash.slice(0, 5), b.geohash.slice(0, 5))
    }
  })

  it("far points differ", () => {
    const a = encodeReportGeohash(BEIRUT.lat, BEIRUT.lng)
    const b = encodeReportGeohash(TYRE.lat, TYRE.lng)
    assert.equal(a.ok && b.ok, true)
    if (a.ok && b.ok) {
      assert.notEqual(a.geohash, b.geohash)
      assert.notEqual(a.geohash.slice(0, 4), b.geohash.slice(0, 4))
    }
  })

  it("invalid latitude rejected by encoder", () => {
    const r = encodeReportGeohash(100, 35)
    assert.equal(r.ok, false)
  })
})

describe("expiresAt derivation", () => {
  const createdAt = 1_700_000_000_000

  it("expiresAt basic", () => {
    const r = deriveExpiresAt({ createdAt, expiryMinutes: 15 })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.expiresAt, createdAt + 15 * 60_000)
  })

  it("expiresAt 10 min", () => {
    assert.equal(expiresAtOrNull(createdAt, 10), createdAt + 10 * 60_000)
  })

  it("expiresAt 30 min", () => {
    assert.equal(expiresAtOrNull(createdAt, 30), createdAt + 30 * 60_000)
  })

  it("expiresAt 60 min", () => {
    assert.equal(expiresAtOrNull(createdAt, 60), createdAt + 60 * 60_000)
  })

  it("expiresAt 90 min", () => {
    assert.equal(expiresAtOrNull(createdAt, 90), createdAt + 90 * 60_000)
  })

  it("expiresAt 120 min", () => {
    assert.equal(expiresAtOrNull(createdAt, 120), createdAt + 120 * 60_000)
  })

  it("invalid expiry rejected", () => {
    assert.equal(deriveExpiresAt({ createdAt, expiryMinutes: -1 }).ok, false)
    assert.equal(deriveExpiresAt({ createdAt, expiryMinutes: Number.NaN }).ok, false)
    assert.equal(deriveExpiresAt({ createdAt, expiryMinutes: "60" }).ok, false)
  })

  it("no-expiry case handled", () => {
    const r = deriveExpiresAt({ createdAt, expiryMinutes: null })
    assert.equal(r.ok, false)
    if (!r.ok) assert.equal(r.reason, "missing_expiry")
    assert.equal(expiresAtOrNull(createdAt, undefined), null)
  })

  it("stolen long TTL accepted", () => {
    const r = deriveExpiresAt({ createdAt, expiryMinutes: 43200 })
    assert.equal(r.ok, true)
    if (r.ok) assert.equal(r.expiresAt, createdAt + 43200 * 60_000)
  })
})

describe("geohash query ranges", () => {
  const radii = [250, 300, 500, 1000, 3000, 5000, 8000, 10000, 15000]

  for (const m of radii) {
    it(`${m >= 1000 ? `${m / 1000}km` : `${m}m`} range plan`, () => {
      const r = planGeohashQueryRanges(BEIRUT.lat, BEIRUT.lng, m)
      assert.equal(r.ok, true)
      if (r.ok) {
        assert.ok(r.ranges.length >= 1)
        for (const range of r.ranges) {
          assert.ok(range.start.length > 0)
          assert.ok(range.end.length > 0)
          assert.ok(range.start <= range.end)
        }
      }
    })
  }

  it("range boundaries deterministic", () => {
    const a = planGeohashQueryRanges(BEIRUT.lat, BEIRUT.lng, 3000)
    const b = planGeohashQueryRanges(BEIRUT.lat, BEIRUT.lng, 3000)
    assert.deepEqual(a, b)
  })

  it("duplicate ranges removed", () => {
    const deduped = dedupeGeohashRanges([
      { start: "s", end: "t" },
      { start: "s", end: "t" },
      { start: "u", end: "v" },
    ])
    assert.equal(deduped.length, 2)
  })

  it("invalid radius rejected", () => {
    assert.equal(planGeohashQueryRanges(BEIRUT.lat, BEIRUT.lng, 0).ok, false)
    assert.equal(planGeohashQueryRanges(BEIRUT.lat, BEIRUT.lng, -5).ok, false)
    assert.equal(planGeohashQueryRanges(BEIRUT.lat, BEIRUT.lng, 1e9).ok, false)
  })

  it("antimeridian behavior: library wrap; viewport spanning rejected", () => {
    // Point near antimeridian — encoding may succeed; document wrap support.
    const near = encodeReportGeohash(0, 179.9)
    assert.equal(near.ok, true)
    const vp = planViewportGeoQuery({
      north: 1,
      south: -1,
      east: -170,
      west: 170,
    })
    assert.equal(vp.ok, false)
    if (!vp.ok) assert.equal(vp.reason, "antimeridian_viewport_unsupported")
  })
})

describe("rider-centered 15 km plan", () => {
  it("covers approved Nearby max radius", () => {
    const r = planRiderCenteredGeoQuery(BEIRUT.lat, BEIRUT.lng)
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.plan.kind, "riderCentered")
      assert.equal(r.plan.radiusMeters, RIDER_NEARBY_MAX_RADIUS_M)
      assert.ok(r.plan.ranges.length >= 1)
    }
  })
})

describe("viewport planning", () => {
  it("builds approx plan from Beirut bounds", () => {
    const r = planViewportGeoQuery({
      north: 33.92,
      south: 33.86,
      east: 35.55,
      west: 35.45,
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.plan.kind, "viewportApprox")
      assert.ok(r.plan.ranges.length >= 1)
      assert.ok(r.plan.radiusMeters > 0)
    }
  })
})

describe("merge / dedupe", () => {
  it("report-id dedupe", () => {
    const merged = mergeGeoReportSets({
      batches: [
        [{ id: "a", source: 1 }, { id: "b", source: 1 }],
        [{ id: "a", source: 2 }, { id: "c", source: 2 }],
      ],
    })
    assert.equal(merged.length, 3)
    const a = merged.find((r) => r.id === "a")
    assert.equal(a?.source, 1)
  })

  it("forced selected report survives dedupe", () => {
    const merged = mergeGeoReportSets({
      batches: [[{ id: "x", from: "geo" }]],
      forced: [{ id: "x", from: "forced" }],
    })
    assert.equal(merged.length, 1)
    assert.equal(merged[0].from, "forced")
  })

  it("owner report survives dedupe", () => {
    const merged = mergeGeoReportSets({
      batches: [[{ id: "o1", from: "geo" }]],
      owner: [{ id: "o1", from: "owner" }, { id: "o2", from: "owner" }],
    })
    assert.equal(merged.length, 2)
    assert.equal(merged.find((r) => r.id === "o1")?.from, "owner")
  })
})

describe("legacy compatibility", () => {
  it("legacy missing geohash safe", () => {
    const fields = readLegacyGeoFields({ lat: 33, lng: 35, expiry: 60 })
    assert.equal(fields.hasGeohash, false)
    assert.equal(fields.geohash, null)
  })

  it("legacy missing expiresAt safe", () => {
    const fields = readLegacyGeoFields({ geohash: "s00000000" })
    assert.equal(fields.hasExpiresAt, false)
    assert.equal(fields.expiresAt, null)
  })

  it("does not invent metadata", () => {
    const fields = readLegacyGeoFields({})
    assert.deepEqual(fields, {
      geohash: null,
      expiresAt: null,
      hasGeohash: false,
      hasExpiresAt: false,
    })
  })
})

describe("buildReportGeoMetadata", () => {
  it("builds full metadata for road report", () => {
    const r = buildReportGeoMetadata({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: 1_700_000_000_000,
      expiryMinutes: 60,
      reportFamily: "intelligence",
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.metadata.geohash.length, GEO_HASH_STORE_PRECISION)
      assert.equal(r.metadata.expiresAt, 1_700_000_000_000 + 60 * 60_000)
    }
  })

  it("stolen placeholder strategy is not short-radius", () => {
    assert.equal(STOLEN_GEO_QUERY_STRATEGY.notShortRadius, true)
    assert.equal(STOLEN_GEO_QUERY_STRATEGY.mode, "lebanonWideOrCoarse")
  })
})
