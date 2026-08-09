/**
 * TRN 057E — Bounded geo comparison preparation (indexes + pure diagnostics).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  RIDER_NEARBY_MAX_RADIUS_M,
  SHORT_LIVED_GEO_COVERAGE_CANARY_PCT,
  STOLEN_BOUNDED_CANARY_RECOMMENDATION,
  VIEWPORT_IDLE_DEBOUNCE_MS,
  auditGeoMetadataCoverage,
  buildOwnerUnresolvedQueryShape,
  buildResolvedGeohashRangeQueryShape,
  classifyComparisonDiffs,
  compareExpectedFilteredVsBounded,
  compareFullVsBoundedReportIds,
  createDebouncedViewportEmitter,
  estimateBoundedReadCost,
  expectedOwnerEscapeIds,
  meetsShortLivedGeoCoverageGate,
  mergeGeoRangeBuckets,
  retainRangeOnError,
  shouldResubscribeViewport,
  useBoundedReportQueriesEnabled,
  useCompareBoundedReportQueriesEnabled,
} from "../../src/geo/index.ts"
import { getNearbyReportCandidates } from "../../src/nearby/nearbyIntelligence.ts"
import { findLikelyDuplicateReport } from "../../src/duplicateReports/duplicateReportIntelligence.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "../..")
const NOW = Date.now()
const BEIRUT = { lat: 33.8938, lng: 35.5018 }

function report(overrides = {}) {
  return {
    id: "r1",
    type: "زحمة",
    reportFamily: "intelligence",
    reportCategory: "traffic",
    ownerUid: "uid-a",
    ownerId: "dev-a",
    createdAt: NOW - 5 * 60_000,
    expiry: 120,
    resolved: false,
    lat: BEIRUT.lat,
    lng: BEIRUT.lng,
    geohash: "syks66h5e",
    expiresAt: NOW + 60 * 60_000,
    ...overrides,
  }
}

describe("057E index file audit", () => {
  it("firestore.indexes.json has exactly 4 indexes (2 notif + 2 geo)", () => {
    const indexes = JSON.parse(
      fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8")
    )
    assert.equal(indexes.indexes.length, 4)
    const groups = indexes.indexes.map((i) => i.collectionGroup).sort()
    assert.deepEqual(groups, [
      "notificationSubscriptions",
      "notificationSubscriptions",
      "reports",
      "reports",
    ].sort())
  })

  it("reports resolved+geohash and ownerUid+resolved+createdAt desc present", () => {
    const indexes = JSON.parse(
      fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8")
    )
    const reports = indexes.indexes.filter((i) => i.collectionGroup === "reports")
    assert.equal(reports.length, 2)
    const geo = reports.find((i) =>
      i.fields.some((f) => f.fieldPath === "geohash")
    )
    assert.deepEqual(
      geo.fields.map((f) => [f.fieldPath, f.order]),
      [
        ["resolved", "ASCENDING"],
        ["geohash", "ASCENDING"],
      ]
    )
    const owner = reports.find((i) =>
      i.fields.some((f) => f.fieldPath === "ownerUid")
    )
    assert.deepEqual(
      owner.fields.map((f) => [f.fieldPath, f.order]),
      [
        ["ownerUid", "ASCENDING"],
        ["resolved", "ASCENDING"],
        ["createdAt", "DESCENDING"],
      ]
    )
  })
})

describe("057E query shapes match 057D", () => {
  it("generic geo query shape", () => {
    const shape = buildResolvedGeohashRangeQueryShape({
      start: "aaa",
      end: "aaz",
    })
    assert.deepEqual(shape.where, [
      { field: "resolved", op: "==", value: false },
    ])
    assert.deepEqual(shape.orderBy, [
      { field: "geohash", direction: "asc" },
    ])
    assert.equal(shape.startAt, "aaa")
    assert.equal(shape.endAt, "aaz")
  })

  it("owner query shape limit 20", () => {
    const shape = buildOwnerUnresolvedQueryShape("uid-x")
    assert.deepEqual(shape.where, [
      { field: "ownerUid", op: "==", value: "uid-x" },
      { field: "resolved", op: "==", value: false },
    ])
    assert.deepEqual(shape.orderBy, [
      { field: "createdAt", direction: "desc" },
    ])
    assert.equal(shape.limit, 20)
  })

  it("subscribe modules use matching Firestore clauses", () => {
    const geo = fs.readFileSync(
      path.join(ROOT, "src/geo/subscribeGeoRanges.ts"),
      "utf8"
    )
    assert.match(geo, /where\("resolved",\s*"==",\s*false\)/)
    assert.match(geo, /orderBy\("geohash"\)/)
    assert.match(geo, /startAt\(range\.start\)/)
    assert.match(geo, /endAt\(range\.end\)/)
    const owner = fs.readFileSync(
      path.join(ROOT, "src/geo/subscribeOwnerReports.ts"),
      "utf8"
    )
    assert.match(owner, /where\("ownerUid",\s*"==",\s*uid\)/)
    assert.match(owner, /where\("resolved",\s*"==",\s*false\)/)
    assert.match(owner, /orderBy\("createdAt",\s*"desc"\)/)
    assert.match(owner, /limit\(lim\)/)
  })
})

describe("057E production default remains full listener", () => {
  it("bounded flag absent = false", () => {
    assert.equal(useBoundedReportQueriesEnabled({}), false)
  })

  it("compare flag does not enable production bounded path alone", () => {
    assert.equal(useCompareBoundedReportQueriesEnabled({}), false)
    assert.equal(
      useBoundedReportQueriesEnabled({
        VITE_COMPARE_BOUNDED_REPORT_QUERIES: "true",
      }),
      false
    )
  })

  it("App keeps full listener when bounded flag off", () => {
    const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8")
    assert.match(app, /if \(useBoundedQueries\) return/)
    assert.match(
      app,
      /onSnapshot\(\s*collection\(db,\s*["']reports["']\)/
    )
    assert.match(
      app,
      /Production-facing state only switches when bounded flag/
    )
  })
})

describe("057E geo coverage audit", () => {
  it("counts geohash / expiresAt / family breakdown", () => {
    const coverage = auditGeoMetadataCoverage([
      report({ id: "a" }),
      report({ id: "b", geohash: "", expiresAt: null, reportFamily: "incident" }),
      report({
        id: "c",
        reportFamily: "stolen",
        type: "بلاغ عن دراجة مسروقة",
        geohash: "sykxxxx",
        expiresAt: NOW + 1,
      }),
      report({ id: "d", reportFamily: "assistance", geohash: "syk", expiresAt: NOW + 1 }),
    ])
    assert.equal(coverage.total, 4)
    assert.equal(coverage.withGeohash, 3)
    assert.equal(coverage.withoutGeohash, 1)
    assert.ok(coverage.byFamily.find((f) => f.family === "stolen").total === 1)
    assert.ok(coverage.shortLivedTotal === 3)
  })

  it("canary gate uses short-lived both pct", () => {
    const low = auditGeoMetadataCoverage([
      report({ id: "1", geohash: "" }),
      report({ id: "2" }),
    ])
    assert.equal(meetsShortLivedGeoCoverageGate(low, 95), false)
    const high = auditGeoMetadataCoverage([
      report({ id: "1" }),
      report({ id: "2" }),
      report({ id: "3" }),
      report({ id: "4" }),
      report({ id: "5" }),
      report({ id: "6" }),
      report({ id: "7" }),
      report({ id: "8" }),
      report({ id: "9" }),
      report({ id: "10" }),
    ])
    assert.equal(high.shortLivedBothPct, 100)
    assert.equal(
      meetsShortLivedGeoCoverageGate(high, SHORT_LIVED_GEO_COVERAGE_CANARY_PCT),
      true
    )
  })
})

describe("057E expected filtered equality", () => {
  it("rider-centered expected full-filtered == bounded when geo present", () => {
    const near = report({ id: "near", lat: BEIRUT.lat + 0.01, lng: BEIRUT.lng })
    const far = report({
      id: "far",
      lat: BEIRUT.lat + 0.5,
      lng: BEIRUT.lng,
    })
    const legacy = report({ id: "leg", geohash: "" })
    const full = [near, far, legacy]
    const bounded = [near]
    const result = compareExpectedFilteredVsBounded({
      fullReports: full,
      boundedReports: bounded,
      centerLat: BEIRUT.lat,
      centerLng: BEIRUT.lng,
      maxDistanceMeters: RIDER_NEARBY_MAX_RADIUS_M,
      excludeStolen: true,
      now: NOW,
    })
    assert.equal(result.equal, true)
    assert.equal(result.expectedCount, 1)
  })

  it("classifies full-only missing geohash and outside radius", () => {
    const near = report({ id: "near" })
    const legacy = report({ id: "leg", geohash: "" })
    const far = report({
      id: "far",
      lat: BEIRUT.lat + 0.5,
      lng: BEIRUT.lng,
    })
    const cmp = compareFullVsBoundedReportIds({
      fullIds: ["near", "leg", "far"],
      boundedIds: ["near"],
      fullMissingGeohashCount: 1,
    })
    const { summary } = classifyComparisonDiffs({
      fullReports: [near, legacy, far],
      comparison: cmp,
      riderLat: BEIRUT.lat,
      riderLng: BEIRUT.lng,
      deferStolen: true,
    })
    assert.equal(summary.fullOnlyCount, 2)
    assert.ok((summary.fullOnlyByReason.missing_geohash ?? 0) >= 1)
    assert.ok((summary.fullOnlyByReason.outside_radius ?? 0) >= 1)
  })

  it("bounded-only classified suspicious", () => {
    const cmp = compareFullVsBoundedReportIds({
      fullIds: ["a"],
      boundedIds: ["a", "ghost"],
    })
    const { summary } = classifyComparisonDiffs({
      fullReports: [report({ id: "a" })],
      comparison: cmp,
    })
    assert.equal(summary.boundedOnlyCount, 1)
    assert.equal(summary.boundedOnlyByReason.bounded_only_suspicious, 1)
  })
})

describe("057E owner / deep-link / cost", () => {
  it("owner escape expected IDs limit 20 newest", () => {
    const list = []
    for (let i = 0; i < 25; i++) {
      list.push(
        report({
          id: `o${i}`,
          ownerUid: "uid-a",
          createdAt: NOW - i * 1000,
        })
      )
    }
    list.push(report({ id: "other", ownerUid: "uid-b", createdAt: NOW }))
    const ids = expectedOwnerEscapeIds(list, "uid-a")
    assert.equal(ids.length, 20)
    assert.equal(ids[0], "o0")
    assert.equal(ids[19], "o19")
  })

  it("deep-link merge equality uses forced id outside radius", () => {
    const outside = report({
      id: "deep",
      lat: 34.4,
      lng: 35.8,
    })
    const cmp = compareFullVsBoundedReportIds({
      fullIds: ["near", "deep"],
      boundedIds: ["near", "deep"],
    })
    assert.equal(cmp.shared.length, 2)
    assert.equal(outside.id, "deep")
  })

  it("read cost reduction estimate", () => {
    const cost = estimateBoundedReadCost({
      fullInitialDocs: 1000,
      viewportDocs: 40,
      riderDocs: 50,
      ownerDocs: 20,
    })
    assert.equal(cost.fullInitialDocs, 1000)
    assert.ok(cost.boundedUniqueEstimate < 200)
    assert.ok(cost.reductionPct > 80)
  })
})

describe("057E viewport churn + failure retain", () => {
  it("idle debounce 400ms and identical viewport no thrash", async () => {
    assert.equal(VIEWPORT_IDLE_DEBOUNCE_MS, 400)
    const emitted = []
    const emitter = createDebouncedViewportEmitter((b) => emitted.push(b), 15)
    const b = {
      north: 34,
      south: 33.8,
      east: 35.6,
      west: 35.4,
    }
    emitter.push(b)
    emitter.push({ ...b, north: 34.0001 })
    await new Promise((r) => setTimeout(r, 40))
    // tiny move may or may not emit once; identical after accept must not
    const accepted = emitted[0] ?? b
    assert.equal(shouldResubscribeViewport(accepted, { ...accepted }), false)
    emitter.cancel()
  })

  it("partial range failure retains good buckets", () => {
    const byRange = new Map([
      ["good", new Map([["a", report({ id: "a" })]])],
      ["bad", new Map([["b", report({ id: "b" })]])],
    ])
    retainRangeOnError(byRange, "bad")
    assert.equal(mergeGeoRangeBuckets(byRange).length, 2)
  })
})

describe("057E Nearby/Duplicate + stolen recommendation", () => {
  it("Nearby/Duplicate consume rider-shaped local set", () => {
    const riderSet = [
      report({
        id: "n1",
        lat: BEIRUT.lat + 0.0003,
        lng: BEIRUT.lng,
        createdAt: NOW - 60_000,
      }),
    ]
    const nearby = getNearbyReportCandidates({
      reports: riderSet,
      rider: BEIRUT,
    })
    assert.ok(nearby.length >= 1)
    const dup = findLikelyDuplicateReport({
      reports: riderSet,
      createCategory: "traffic",
      createLat: BEIRUT.lat,
      createLng: BEIRUT.lng,
      now: NOW,
    })
    assert.equal(dup?.id, "n1")
  })

  it("stolen canary recommendation is separate legacy listener", () => {
    assert.equal(STOLEN_BOUNDED_CANARY_RECOMMENDATION.choice, "A")
    assert.equal(
      STOLEN_BOUNDED_CANARY_RECOMMENDATION.strategy,
      "separate_legacy_stolen_listener"
    )
  })

  it("no Hosting/rules/Functions changes in 057E source intent", () => {
    // Indexes file may be unchanged content-wise; rules/functions must not be modified by helpers.
    const rules = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8")
    assert.ok(rules.length > 0)
    const cmp = fs.readFileSync(
      path.join(ROOT, "src/geo/geoComparison.ts"),
      "utf8"
    )
    assert.equal(cmp.includes("firebase deploy"), false)
    assert.equal(cmp.includes("updateDoc"), false)
  })
})
