/**
 * TRN 058C — coarse location heartbeat pure helpers + scope guardrails.
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  LOCATION_HEARTBEAT_COPY_AR,
  LOCATION_HEARTBEAT_INTERVAL_MS,
  LOCATION_MAX_NOTIFICATION_STALENESS_MS,
  NOTIFICATION_LOCATION_GEOHASH_PRECISION,
  canAttemptLocationHeartbeat,
  encodeNotificationLocationGeohash,
  isHeartbeatDue,
  isLocationFresh,
  nearbyLocationStatusLabelAr,
  normalizeLocationGeohash,
  resolveNearbyLocationStatusAr,
  shouldWriteLocationHeartbeat,
} from "../../src/notifications/locationHeartbeat.ts"
import {
  getHeartbeatMemoryState,
  markHeartbeatWriteCommitted,
  resetHeartbeatMemoryState,
  setCachedNearbyAlertsPref,
  getCachedNearbyAlertsPref,
} from "../../src/notifications/locationHeartbeatState.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

// Beirut-ish
const LAT = 33.8938
const LNG = 35.5018

const memory = new Map()
function mockStorage() {
  return {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
    clear: () => memory.clear(),
  }
}

describe("locationHeartbeat constants", () => {
  it("interval 15 min and staleness 30 min", () => {
    assert.equal(LOCATION_HEARTBEAT_INTERVAL_MS, 15 * 60 * 1000)
    assert.equal(LOCATION_MAX_NOTIFICATION_STALENESS_MS, 30 * 60 * 1000)
    assert.equal(NOTIFICATION_LOCATION_GEOHASH_PRECISION, 6)
  })
})

describe("locationHeartbeat gates + encode", () => {
  beforeEach(() => {
    resetHeartbeatMemoryState()
  })

  it("1. nearbyAlerts false → no heartbeat", () => {
    assert.equal(
      canAttemptLocationHeartbeat({
        subscriptionEnabled: true,
        nearbyAlerts: false,
        documentVisible: true,
        lat: LAT,
        lng: LNG,
      }),
      false
    )
  })

  it("2. subscription disabled → no heartbeat", () => {
    assert.equal(
      canAttemptLocationHeartbeat({
        subscriptionEnabled: false,
        nearbyAlerts: true,
        documentVisible: true,
        lat: LAT,
        lng: LNG,
      }),
      false
    )
  })

  it("3. invalid location → no heartbeat", () => {
    assert.equal(
      canAttemptLocationHeartbeat({
        subscriptionEnabled: true,
        nearbyAlerts: true,
        documentVisible: true,
        lat: null,
        lng: LNG,
      }),
      false
    )
    assert.equal(encodeNotificationLocationGeohash(null, LNG), null)
  })

  it("4. valid location → geohash", () => {
    const g = encodeNotificationLocationGeohash(LAT, LNG)
    assert.ok(g)
    assert.equal(g.length, 6)
  })

  it("5–6. precision enforced; normalize rejects bad", () => {
    assert.equal(normalizeLocationGeohash("sy"), null)
    assert.equal(normalizeLocationGeohash("sydr0a"), null) // 'a' not in geohash alphabet
    assert.equal(normalizeLocationGeohash("sydr0!"), null)
    const g = encodeNotificationLocationGeohash(LAT, LNG)
    assert.equal(normalizeLocationGeohash(g), g)
    assert.equal(normalizeLocationGeohash(g.toUpperCase()), g)
  })

  it("7. first valid heartbeat writes", () => {
    const g = encodeNotificationLocationGeohash(LAT, LNG)
    assert.equal(
      shouldWriteLocationHeartbeat({
        candidateGeohash: g,
        lastWrittenGeohash: null,
        lastWrittenAtMs: null,
        nowMs: 1_000_000,
      }),
      true
    )
  })

  it("8. same cell under interval → no write", () => {
    const g = encodeNotificationLocationGeohash(LAT, LNG)
    assert.equal(
      shouldWriteLocationHeartbeat({
        candidateGeohash: g,
        lastWrittenGeohash: g,
        lastWrittenAtMs: 1_000_000,
        nowMs: 1_000_000 + 5 * 60 * 1000,
      }),
      false
    )
  })

  it("9. same cell after interval → write", () => {
    const g = encodeNotificationLocationGeohash(LAT, LNG)
    assert.equal(
      shouldWriteLocationHeartbeat({
        candidateGeohash: g,
        lastWrittenGeohash: g,
        lastWrittenAtMs: 1_000_000,
        nowMs: 1_000_000 + LOCATION_HEARTBEAT_INTERVAL_MS,
      }),
      true
    )
    assert.equal(
      isHeartbeatDue({
        lastWrittenAtMs: 1_000_000,
        nowMs: 1_000_000 + LOCATION_HEARTBEAT_INTERVAL_MS,
      }),
      true
    )
  })

  it("10. changed cell → write", () => {
    const a = encodeNotificationLocationGeohash(LAT, LNG)
    const b = encodeNotificationLocationGeohash(34.4, 35.8) // Tripoli-ish
    assert.notEqual(a, b)
    assert.equal(
      shouldWriteLocationHeartbeat({
        candidateGeohash: b,
        lastWrittenGeohash: a,
        lastWrittenAtMs: 1_000_000,
        nowMs: 1_000_000 + 1000,
      }),
      true
    )
  })

  it("16. document hidden → gate false", () => {
    assert.equal(
      canAttemptLocationHeartbeat({
        subscriptionEnabled: true,
        nearbyAlerts: true,
        documentVisible: false,
        lat: LAT,
        lng: LNG,
      }),
      false
    )
  })

  it("17. foreground stale may write (interval)", () => {
    const g = encodeNotificationLocationGeohash(LAT, LNG)
    assert.equal(
      shouldWriteLocationHeartbeat({
        candidateGeohash: g,
        lastWrittenGeohash: g,
        lastWrittenAtMs: Date.now() - LOCATION_HEARTBEAT_INTERVAL_MS - 1,
        nowMs: Date.now(),
      }),
      true
    )
  })

  it("19. old subscription without location fields safe", () => {
    assert.equal(normalizeLocationGeohash(undefined), null)
    assert.equal(
      isLocationFresh({ locationUpdatedAtMs: null, nowMs: Date.now() }),
      false
    )
  })
})

describe("locationHeartbeat memory + Arabic", () => {
  let prevLocal
  beforeEach(() => {
    resetHeartbeatMemoryState()
    memory.clear()
    prevLocal = globalThis.localStorage
    globalThis.localStorage = mockStorage()
  })
  afterEach(() => {
    globalThis.localStorage = prevLocal
  })

  it("18. memory commit tracks last write", () => {
    const g = encodeNotificationLocationGeohash(LAT, LNG)
    markHeartbeatWriteCommitted(g, 42)
    assert.deepEqual(getHeartbeatMemoryState(), {
      lastGeohash: g,
      lastWrittenAtMs: 42,
    })
    resetHeartbeatMemoryState()
    assert.equal(getHeartbeatMemoryState().lastGeohash, null)
  })

  it("cached nearbyAlerts pref", () => {
    assert.equal(getCachedNearbyAlertsPref(), null)
    setCachedNearbyAlertsPref(true)
    assert.equal(getCachedNearbyAlertsPref(), true)
    setCachedNearbyAlertsPref(false)
    assert.equal(getCachedNearbyAlertsPref(), false)
  })

  it("28. Arabic status copy present", () => {
    assert.equal(
      nearbyLocationStatusLabelAr(
        resolveNearbyLocationStatusAr({
          nearbyAlerts: true,
          hasMyLocation: false,
          lastHeartbeatAtMs: null,
        })
      ),
      LOCATION_HEARTBEAT_COPY_AR.needLocation
    )
    assert.equal(
      nearbyLocationStatusLabelAr(
        resolveNearbyLocationStatusAr({
          nearbyAlerts: true,
          hasMyLocation: true,
          lastHeartbeatAtMs: Date.now(),
        })
      ),
      LOCATION_HEARTBEAT_COPY_AR.locationReady
    )
    assert.match(LOCATION_HEARTBEAT_COPY_AR.nearbyNotLiveYet, /التطبيق مفتوح/)
  })

  it("isLocationFresh 30 min window", () => {
    const now = 1_000_000_000
    assert.equal(
      isLocationFresh({
        locationUpdatedAtMs: now - LOCATION_MAX_NOTIFICATION_STALENESS_MS,
        nowMs: now,
      }),
      true
    )
    assert.equal(
      isLocationFresh({
        locationUpdatedAtMs: now - LOCATION_MAX_NOTIFICATION_STALENESS_MS - 1,
        nowMs: now,
      }),
      false
    )
  })
})

describe("058C scope guardrails", () => {
  it("11. no second GPS watcher in heartbeat modules", () => {
    const files = [
      "src/notifications/locationHeartbeat.ts",
      "src/notifications/locationHeartbeatState.ts",
      "src/notifications/notificationLocationWrite.ts",
    ]
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8")
      assert.equal(src.includes("watchPosition"), false, f)
      assert.equal(src.includes("getCurrentPosition"), false, f)
      assert.equal(src.includes("navigator.geolocation"), false, f)
    }
  })

  it("5/12. exact lat/lng not persisted by write helper", () => {
    const src = readFileSync(
      join(root, "src/notifications/notificationLocationWrite.ts"),
      "utf8"
    )
    assert.match(src, /locationGeohash/)
    assert.match(src, /locationUpdatedAt/)
    assert.equal(src.includes("helperLat"), false)
    assert.equal(src.includes("helperLng"), false)
    // Firestore update payload keys only geohash + timestamps
    assert.match(
      src,
      /updateDoc\([\s\S]*locationGeohash:\s*geohash[\s\S]*locationUpdatedAt:\s*serverTimestamp/
    )
    assert.equal(src.includes("latitude"), false)
    assert.equal(src.includes("longitude"), false)
  })

  it("24–25. heartbeat client modules do not send FCM", () => {
    const writeSrc = readFileSync(
      join(root, "src/notifications/notificationLocationWrite.ts"),
      "utf8"
    )
    assert.equal(writeSrc.includes("onReportCreated"), false)
    assert.equal(writeSrc.includes("sendEachForMulticast"), false)
    assert.equal(writeSrc.includes("messaging.send"), false)
    // Nearby Function lives in 058E; heartbeat write path stays send-free.
  })

  it("App wires heartbeat from myLocation without extra watchPosition", () => {
    const app = readFileSync(join(root, "src/App.tsx"), "utf8")
    const watches = app.match(/watchPosition/g) || []
    assert.equal(watches.length, 1)
    assert.match(app, /maybeUpdateNotificationLocationHeartbeat/)
  })
})
