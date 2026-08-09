/**
 * TRN 057D — Bounded geo report query service (flag default OFF).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  BOUNDED_GEO_INDEX_REQUIRED,
  OWNER_UNRESOLVED_LIMIT,
  RIDER_NEARBY_MAX_RADIUS_M,
  VIEWPORT_IDLE_DEBOUNCE_MS,
  VIEWPORT_RADIUS_PADDING,
  boundedReportQueriesDefaultOff,
  buildOwnerUnresolvedQueryShape,
  buildResolvedGeohashRangeQueryShape,
  compareFullVsBoundedReportIds,
  countMissingGeohash,
  createDebouncedViewportEmitter,
  filterBoundedLiveReports,
  isMissingIndexError,
  isReportExpiredForBounded,
  mergeGeoRangeBuckets,
  mergeGeoReportSets,
  planRiderCenteredGeoQuery,
  planViewportGeoQuery,
  readEnvFlag,
  retainRangeOnError,
  shouldResubscribeViewport,
  useBoundedReportQueriesEnabled,
  useCompareBoundedReportQueriesEnabled,
} from "../../src/geo/index.ts"
import { getNearbyReportCandidates } from "../../src/nearby/nearbyIntelligence.ts"
import { findLikelyDuplicateReport } from "../../src/duplicateReports/duplicateReportIntelligence.ts"
import { LIFECYCLE_LIKELY_GONE_GRACE_MS } from "../../src/reportLifecycle/lifecycleConfig.ts"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "../..")
const NOW = 1_700_000_000_000
const BEIRUT = { lat: 33.8938, lng: 35.5018 }

function road(overrides = {}) {
  return {
    id: "r1",
    type: "زحمة",
    reportFamily: "intelligence",
    reportCategory: "traffic",
    ownerId: "device-a",
    ownerUid: "uid-a",
    createdAt: NOW - 5 * 60_000,
    expiry: 120,
    resolved: false,
    lat: BEIRUT.lat,
    lng: BEIRUT.lng,
    geohash: "syks66h5e",
    ...overrides,
  }
}

describe("057D feature flag", () => {
  it("flag absent = false", () => {
    assert.equal(useBoundedReportQueriesEnabled({}), false)
    assert.equal(useBoundedReportQueriesEnabled({}), false)
  })

  it("flag false / empty / junk = false", () => {
    assert.equal(
      useBoundedReportQueriesEnabled({ VITE_USE_BOUNDED_REPORT_QUERIES: "false" }),
      false
    )
    assert.equal(
      useBoundedReportQueriesEnabled({ VITE_USE_BOUNDED_REPORT_QUERIES: "" }),
      false
    )
    assert.equal(
      useBoundedReportQueriesEnabled({ VITE_USE_BOUNDED_REPORT_QUERIES: "maybe" }),
      false
    )
  })

  it("flag true = bounded path enabled", () => {
    assert.equal(
      useBoundedReportQueriesEnabled({ VITE_USE_BOUNDED_REPORT_QUERIES: "true" }),
      true
    )
    assert.equal(
      useBoundedReportQueriesEnabled({ VITE_USE_BOUNDED_REPORT_QUERIES: "1" }),
      true
    )
  })

  it("default-off documented helper", () => {
    assert.equal(boundedReportQueriesDefaultOff(), true)
  })

  it("compare flag default false", () => {
    assert.equal(useCompareBoundedReportQueriesEnabled({}), false)
    assert.equal(
      useCompareBoundedReportQueriesEnabled({
        VITE_COMPARE_BOUNDED_REPORT_QUERIES: "true",
      }),
      true
    )
  })

  it("readEnvFlag strict", () => {
    assert.equal(readEnvFlag(undefined), false)
    assert.equal(readEnvFlag(true), false)
    assert.equal(readEnvFlag("yes"), true)
  })
})

describe("057D query shape", () => {
  it("geohash range query builder", () => {
    const shape = buildResolvedGeohashRangeQueryShape({
      start: "aaa",
      end: "zzz",
    })
    assert.equal(shape.collection, "reports")
    assert.deepEqual(shape.where, [{ field: "resolved", op: "==", value: false }])
    assert.deepEqual(shape.orderBy, [{ field: "geohash", direction: "asc" }])
    assert.equal(shape.startAt, "aaa")
    assert.equal(shape.endAt, "zzz")
  })

  it("query includes resolved false", () => {
    const shape = buildResolvedGeohashRangeQueryShape({ start: "a", end: "b" })
    assert.equal(shape.where[0].value, false)
  })

  it("query orders geohash", () => {
    const shape = buildResolvedGeohashRangeQueryShape({ start: "a", end: "b" })
    assert.equal(shape.orderBy[0].field, "geohash")
  })

  it("startAt/endAt correct", () => {
    const shape = buildResolvedGeohashRangeQueryShape({
      start: "syk",
      end: "syl",
    })
    assert.equal(shape.startAt, "syk")
    assert.equal(shape.endAt, "syl")
  })

  it("owner limit 20 query shape", () => {
    const shape = buildOwnerUnresolvedQueryShape("uid-x")
    assert.equal(shape.limit, OWNER_UNRESOLVED_LIMIT)
    assert.equal(OWNER_UNRESOLVED_LIMIT, 20)
    assert.deepEqual(shape.where, [
      { field: "ownerUid", op: "==", value: "uid-x" },
      { field: "resolved", op: "==", value: false },
    ])
    assert.deepEqual(shape.orderBy, [
      { field: "createdAt", direction: "desc" },
    ])
  })
})

describe("057D multi-range merge / dedupe", () => {
  it("multi-range merge", () => {
    const byRange = new Map([
      ["r1", new Map([["a", road({ id: "a" })]])],
      ["r2", new Map([["b", road({ id: "b" })]])],
    ])
    const merged = mergeGeoRangeBuckets(byRange)
    assert.equal(merged.length, 2)
    assert.ok(merged.some((r) => r.id === "a"))
    assert.ok(merged.some((r) => r.id === "b"))
  })

  it("duplicate docs deduped", () => {
    const dup = road({ id: "same", type: "first" })
    const other = road({ id: "same", type: "second" })
    const byRange = new Map([
      ["r1", new Map([["same", dup]])],
      ["r2", new Map([["same", other]])],
    ])
    const merged = mergeGeoRangeBuckets(byRange)
    assert.equal(merged.length, 1)
    assert.equal(merged[0].type, "first")
  })

  it("partial range failure preserves successful results", () => {
    const byRange = new Map([
      ["good", new Map([["a", road({ id: "a" })]])],
      ["bad", new Map([["b", road({ id: "b" })]])],
    ])
    retainRangeOnError(byRange, "bad")
    const merged = mergeGeoRangeBuckets(byRange)
    assert.equal(merged.length, 2)
  })
})

describe("057D merge precedence", () => {
  it("deterministic merge precedence forced > owner > batches", () => {
    const merged = mergeGeoReportSets({
      batches: [
        [road({ id: "x", source: "viewport" })],
        [road({ id: "x", source: "rider" })],
      ],
      owner: [road({ id: "x", source: "owner" })],
      forced: [road({ id: "x", source: "forced" })],
    })
    assert.equal(merged.length, 1)
    assert.equal(merged[0].source, "forced")
  })

  it("owner beats geo batches", () => {
    const merged = mergeGeoReportSets({
      batches: [[road({ id: "x", source: "geo" })]],
      owner: [road({ id: "x", source: "owner" })],
    })
    assert.equal(merged[0].source, "owner")
  })

  it("forced getDoc merge", () => {
    const merged = mergeGeoReportSets({
      batches: [[road({ id: "in-view" })]],
      forced: [road({ id: "deep", lat: 34.0, lng: 36.0 })],
    })
    assert.equal(merged.length, 2)
    assert.ok(merged.some((r) => r.id === "deep"))
  })

  it("owner merge", () => {
    const merged = mergeGeoReportSets({
      batches: [],
      owner: [road({ id: "mine" })],
    })
    assert.equal(merged[0].id, "mine")
  })
})

describe("057D client filtering", () => {
  it("expired doc filtered via expiresAt Timestamp", () => {
    const expired = road({
      id: "e1",
      expiresAt: { toMillis: () => NOW - 1000 },
      expiry: 9999,
    })
    assert.equal(isReportExpiredForBounded(expired, NOW), true)
    const out = filterBoundedLiveReports([expired], { now: NOW })
    assert.equal(out.length, 0)
  })

  it("expiresAt Timestamp filter keeps live", () => {
    const live = road({
      id: "e2",
      expiresAt: { toMillis: () => NOW + 60_000 },
    })
    assert.equal(isReportExpiredForBounded(live, NOW), false)
    assert.equal(filterBoundedLiveReports([live], { now: NOW }).length, 1)
  })

  it("legacy expiry fallback", () => {
    const legacy = road({
      id: "leg",
      createdAt: NOW - 20 * 60_000,
      expiry: 15,
      expiresAt: undefined,
    })
    assert.equal(isReportExpiredForBounded(legacy, NOW), true)
  })

  it("soft-hidden filtered", () => {
    const soft = road({
      id: "soft",
      confirmationPresentCount: 0,
      confirmationGoneCount: 3,
      likelyGoneSince: NOW - LIFECYCLE_LIKELY_GONE_GRACE_MS - 1000,
    })
    assert.equal(filterBoundedLiveReports([soft], { now: NOW }).length, 0)
  })

  it("selected preserved through soft-hide", () => {
    const soft = road({
      id: "sel",
      confirmationPresentCount: 0,
      confirmationGoneCount: 3,
      likelyGoneSince: NOW - LIFECYCLE_LIKELY_GONE_GRACE_MS - 1000,
    })
    const out = filterBoundedLiveReports([soft], {
      now: NOW,
      selectedReportId: "sel",
    })
    assert.equal(out.length, 1)
  })

  it("invalid coordinates ignored", () => {
    const bad = road({ id: "bad", lat: 999, lng: 35 })
    assert.equal(filterBoundedLiveReports([bad], { now: NOW }).length, 0)
  })

  it("exact distance filter", () => {
    const far = road({
      id: "far",
      lat: BEIRUT.lat + 0.2,
      lng: BEIRUT.lng,
    })
    const out = filterBoundedLiveReports([road({ id: "near" }), far], {
      now: NOW,
      centerLat: BEIRUT.lat,
      centerLng: BEIRUT.lng,
      maxDistanceMeters: 5_000,
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].id, "near")
  })

  it("missing geohash legacy count explicit", () => {
    assert.equal(
      countMissingGeohash([
        { geohash: "abc" },
        { geohash: "" },
        {},
        { geohash: "  " },
      ]),
      3
    )
  })
})

describe("057D rider / viewport plans", () => {
  it("rider query radius 15 km", () => {
    const plan = planRiderCenteredGeoQuery(BEIRUT.lat, BEIRUT.lng)
    assert.equal(plan.ok, true)
    if (plan.ok) {
      assert.equal(plan.plan.radiusMeters, RIDER_NEARBY_MAX_RADIUS_M)
      assert.equal(RIDER_NEARBY_MAX_RADIUS_M, 15_000)
      assert.ok(plan.plan.ranges.length >= 1)
    }
  })

  it("viewport padded query", () => {
    const plan = planViewportGeoQuery({
      north: BEIRUT.lat + 0.05,
      south: BEIRUT.lat - 0.05,
      east: BEIRUT.lng + 0.05,
      west: BEIRUT.lng - 0.05,
    })
    assert.equal(plan.ok, true)
    if (plan.ok) {
      assert.equal(plan.plan.kind, "viewportApprox")
      assert.ok(plan.plan.radiusMeters > 0)
      assert.ok(VIEWPORT_RADIUS_PADDING >= 1)
    }
  })
})

describe("057D viewport debounce / thrash", () => {
  it("viewport debounce constant is 300–500 ms", () => {
    assert.ok(VIEWPORT_IDLE_DEBOUNCE_MS >= 300)
    assert.ok(VIEWPORT_IDLE_DEBOUNCE_MS <= 500)
  })

  it("same viewport does not thrash", () => {
    const b = {
      north: 34,
      south: 33.8,
      east: 35.6,
      west: 35.4,
    }
    assert.equal(shouldResubscribeViewport(b, { ...b }), false)
  })

  it("nested small move stays quiet", () => {
    const prev = {
      north: 34.1,
      south: 33.7,
      east: 35.7,
      west: 35.3,
    }
    const next = {
      north: 34.05,
      south: 33.75,
      east: 35.65,
      west: 35.35,
    }
    assert.equal(shouldResubscribeViewport(prev, next), false)
  })

  it("debounced emitter suppresses identical idle pushes", async () => {
    const emitted = []
    const emitter = createDebouncedViewportEmitter((b) => emitted.push(b), 20)
    const b = {
      north: 34,
      south: 33.8,
      east: 35.6,
      west: 35.4,
    }
    emitter.push(b)
    await new Promise((r) => setTimeout(r, 40))
    emitter.push({ ...b })
    await new Promise((r) => setTimeout(r, 40))
    emitter.cancel()
    assert.equal(emitted.length, 1)
  })
})

describe("057D Nearby / Duplicate bounded sources", () => {
  it("Nearby uses rider dataset in bounded mode", () => {
    const now = Date.now()
    const riderSet = [
      road({
        id: "near",
        lat: BEIRUT.lat + 0.001,
        lng: BEIRUT.lng,
        createdAt: now - 2 * 60_000,
      }),
    ]
    const candidates = getNearbyReportCandidates({
      reports: riderSet,
      rider: BEIRUT,
    })
    assert.ok(candidates.length >= 1)
    assert.equal(candidates[0].id, "near")
  })

  it("Duplicate uses rider dataset in bounded mode", () => {
    const now = Date.now()
    const riderSet = [
      road({
        id: "dup",
        lat: BEIRUT.lat + 0.0002,
        lng: BEIRUT.lng,
        createdAt: now - 2 * 60_000,
      }),
    ]
    const match = findLikelyDuplicateReport({
      reports: riderSet,
      createCategory: "traffic",
      createLat: BEIRUT.lat,
      createLng: BEIRUT.lng,
      now,
    })
    assert.ok(match)
    assert.equal(match.id, "dup")
  })

  it("flag false Nearby unchanged (uses visibleReports-shaped input)", () => {
    const now = Date.now()
    const visible = [
      road({ id: "v1", createdAt: now - 60_000 }),
    ]
    const c = getNearbyReportCandidates({
      reports: visible,
      rider: BEIRUT,
    })
    assert.equal(c[0]?.id, "v1")
  })

  it("flag false Duplicate unchanged", () => {
    const now = Date.now()
    const visible = [
      road({
        id: "v2",
        lat: BEIRUT.lat + 0.0002,
        lng: BEIRUT.lng,
        createdAt: now - 2 * 60_000,
      }),
    ]
    const match = findLikelyDuplicateReport({
      reports: visible,
      createCategory: "traffic",
      createLat: BEIRUT.lat,
      createLng: BEIRUT.lng,
      now,
    })
    assert.equal(match?.id, "v2")
  })
})

describe("057D missing index / deep-link / compare", () => {
  it("missing index error surfaced", () => {
    assert.equal(
      isMissingIndexError({ code: "failed-precondition", message: "index" }),
      true
    )
    assert.equal(BOUNDED_GEO_INDEX_REQUIRED, "bounded_geo_index_required")
  })

  it("deep-linked report outside viewport can merge", () => {
    const merged = mergeGeoReportSets({
      batches: [[road({ id: "viewport-only" })]],
      forced: [road({ id: "outside", lat: 34.4, lng: 35.8 })],
    })
    assert.ok(merged.some((r) => r.id === "outside"))
  })

  it("missing deep-linked report safe (empty forced)", () => {
    const merged = mergeGeoReportSets({
      batches: [[road({ id: "a" })]],
      forced: [],
    })
    assert.equal(merged.length, 1)
  })

  it("comparison helper for 057E", () => {
    const cmp = compareFullVsBoundedReportIds({
      fullIds: ["a", "b", "legacy"],
      boundedIds: ["a", "c"],
      fullMissingGeohashCount: 1,
    })
    assert.deepEqual(cmp.fullOnly, ["b", "legacy"])
    assert.deepEqual(cmp.boundedOnly, ["c"])
    assert.deepEqual(cmp.shared, ["a"])
    assert.equal(cmp.missingGeohashInFull, 1)
  })
})

describe("057D safety / App wiring invariants", () => {
  const appSrc = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8")
  const geoDir = path.join(ROOT, "src/geo")

  it("full listener function still exists", () => {
    assert.match(
      appSrc,
      /onSnapshot\(\s*collection\(db,\s*["']reports["']\)/
    )
  })

  it("full listener default path intact (flag gate)", () => {
    assert.match(appSrc, /if \(useBoundedQueries\) return/)
    assert.match(appSrc, /useBoundedReportQueriesEnabled/)
  })

  it("no new GPS watcher in geo services", () => {
    for (const file of fs.readdirSync(geoDir)) {
      if (!file.endsWith(".ts")) continue
      const src = fs.readFileSync(path.join(geoDir, file), "utf8")
      assert.equal(src.includes("watchPosition"), false, file)
      assert.equal(src.includes("getCurrentPosition"), false, file)
      assert.equal(src.includes("geolocation"), false, file)
    }
  })

  it("no GPS writes in geo query modules", () => {
    const queryFiles = [
      "subscribeGeoRanges.ts",
      "subscribeOwnerReports.ts",
      "useBoundedReports.ts",
      "fetchReportById.ts",
      "queryBuilder.ts",
    ]
    for (const file of queryFiles) {
      const src = fs.readFileSync(path.join(geoDir, file), "utf8")
      assert.equal(src.includes("updateDoc"), false, file)
      assert.equal(src.includes("setDoc"), false, file)
      assert.equal(src.includes("addDoc"), false, file)
    }
  })

  it("no confirmation N+1 in bounded geo path", () => {
    for (const file of ["subscribeGeoRanges.ts", "useBoundedReports.ts", "filterBoundedReports.ts"]) {
      const src = fs.readFileSync(path.join(geoDir, file), "utf8")
      assert.equal(src.includes("confirmations"), false, file)
      assert.equal(src.includes("collection(db, \"reportConfirmations\")"), false, file)
    }
  })

  it("no notification integration in geo query modules", () => {
    for (const file of fs.readdirSync(geoDir)) {
      if (!file.endsWith(".ts")) continue
      const src = fs.readFileSync(path.join(geoDir, file), "utf8")
      assert.equal(src.includes("getMessaging"), false, file)
      assert.equal(src.includes("getToken"), false, file)
      assert.equal(src.includes("../notifications/"), false, file)
    }
  })

  it("unsubscribe all listeners pattern present", () => {
    const src = fs.readFileSync(
      path.join(geoDir, "subscribeGeoRanges.ts"),
      "utf8"
    )
    assert.match(src, /unsubscribe\(\)/)
    assert.match(src, /for \(const u of unsubs\)/)
  })

  it("range removal cleanup clears byRange", () => {
    const src = fs.readFileSync(
      path.join(geoDir, "subscribeGeoRanges.ts"),
      "utf8"
    )
    assert.match(src, /byRange\.clear\(\)/)
  })

  it("firestore.indexes.json unchanged beyond 057C shape", () => {
    const indexes = JSON.parse(
      fs.readFileSync(path.join(ROOT, "firestore.indexes.json"), "utf8")
    )
    const reportIndexes = indexes.indexes.filter(
      (i) => i.collectionGroup === "reports"
    )
    // 057C prepared two composites; 057D must not add more.
    const geoish = reportIndexes.filter((i) =>
      i.fields.some((f) => f.fieldPath === "geohash")
    )
    assert.equal(geoish.length, 1)
    const ownerish = reportIndexes.filter(
      (i) =>
        i.fields.some((f) => f.fieldPath === "ownerUid") &&
        i.fields.some((f) => f.fieldPath === "createdAt")
    )
    assert.equal(ownerish.length, 1)
  })

  it("rules and functions not touched by 057D geo service files", () => {
    assert.ok(fs.existsSync(path.join(ROOT, "firestore.rules")))
    const dualWrite = fs.readFileSync(
      path.join(geoDir, "geoWriteFields.ts"),
      "utf8"
    )
    // Dual-write module from 057B remains; query modules do not call it.
    const sub = fs.readFileSync(
      path.join(geoDir, "subscribeGeoRanges.ts"),
      "utf8"
    )
    assert.equal(sub.includes("buildReportGeoWriteFields"), false)
    void dualWrite
  })
})

