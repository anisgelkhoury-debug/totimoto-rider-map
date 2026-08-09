/**
 * TRN 057B — dual-write geohash + expiresAt on new report create payloads.
 * Pure write-boundary tests (no Firestore network).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  GEO_HASH_STORE_PRECISION,
  buildReportGeoWriteFields,
  geoDualWriteRequestsGps,
  geoDualWriteUsesFollowUpUpdate,
  isValidStoredGeohashShape,
  readLegacyGeoFields,
  withGeoWriteFields,
} from "../../src/geo/index.ts"
import { CHECKPOINT_REPORT_TYPE } from "../../src/utils/roadIntelligenceTypes.ts"
import { INCIDENT_REPORT_TYPES } from "../../src/utils/incidentTypes.ts"
import { getNearbyReportCandidates } from "../../src/nearby/nearbyIntelligence.ts"
import { findLikelyDuplicateReport } from "../../src/duplicateReports/duplicateReportIntelligence.ts"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const appSrc = readFileSync(resolve(__dirname, "../../src/App.tsx"), "utf8")

const BEIRUT = { lat: 33.8938, lng: 35.5018 }
const NOW = 1_700_000_000_000

function assertGeoPayload(fields, createdAt, expiryMinutes) {
  assert.equal(isValidStoredGeohashShape(fields.geohash), true)
  assert.equal(fields.geohash.length, GEO_HASH_STORE_PRECISION)
  assert.equal(fields.expiresAtMs, createdAt + expiryMinutes * 60_000)
}

describe("057B dual-write geo metadata payloads", () => {
  it("road create payload includes geohash + expiresAt", () => {
    const r = buildReportGeoWriteFields({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: NOW,
      expiryMinutes: 15,
      reportFamily: "intelligence",
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assertGeoPayload(r.fields, NOW, 15)
      const payload = withGeoWriteFields(
        { type: "زحمة", lat: BEIRUT.lat, lng: BEIRUT.lng, expiry: 15, createdAt: NOW },
        r.fields
      )
      assert.ok("geohash" in payload)
      assert.ok("expiresAtMs" in payload)
    }
  })

  it("checkpoint payload metadata", () => {
    const r = buildReportGeoWriteFields({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: NOW,
      expiryMinutes: CHECKPOINT_REPORT_TYPE.expiry,
      reportFamily: "intelligence",
    })
    assert.equal(r.ok, true)
    if (r.ok) assertGeoPayload(r.fields, NOW, CHECKPOINT_REPORT_TYPE.expiry)
  })

  for (const cat of ["fire", "gunfire", "explosionStrike"]) {
    it(`incident ${cat} metadata`, () => {
      const type = INCIDENT_REPORT_TYPES.find((t) => t.reportCategory === cat)
      assert.ok(type)
      const r = buildReportGeoWriteFields({
        lat: BEIRUT.lat,
        lng: BEIRUT.lng,
        createdAt: NOW,
        expiryMinutes: type.expiry,
        reportFamily: "incident",
      })
      assert.equal(r.ok, true)
      if (r.ok) assertGeoPayload(r.fields, NOW, type.expiry)
    })
  }

  it("assistance metadata", () => {
    const r = buildReportGeoWriteFields({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: NOW,
      expiryMinutes: 30,
      reportFamily: "assistance",
    })
    assert.equal(r.ok, true)
    if (r.ok) assertGeoPayload(r.fields, NOW, 30)
  })

  it("sharedRide metadata", () => {
    const r = buildReportGeoWriteFields({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: NOW,
      expiryMinutes: 10,
      reportFamily: "sharedRide",
    })
    assert.equal(r.ok, true)
    if (r.ok) assertGeoPayload(r.fields, NOW, 10)
  })

  it("stolen metadata uses long TTL", () => {
    const r = buildReportGeoWriteFields({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: NOW,
      expiryMinutes: 43200,
      reportFamily: "stolen",
    })
    assert.equal(r.ok, true)
    if (r.ok) assertGeoPayload(r.fields, NOW, 43200)
  })

  it("expiresAt matches createdAt + expiry (write uses ms → Timestamp at boundary)", () => {
    const r = buildReportGeoWriteFields({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: NOW,
      expiryMinutes: 60,
    })
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(typeof r.fields.expiresAtMs, "number")
      assert.equal(r.fields.expiresAtMs, NOW + 60 * 60_000)
    }
  })

  it("fresh / preResolved coords used (same lat/lng as payload)", () => {
    const lat = 33.9
    const lng = 35.52
    const r = buildReportGeoWriteFields({
      lat,
      lng,
      createdAt: NOW,
      expiryMinutes: 45,
    })
    assert.equal(r.ok, true)
    const again = buildReportGeoWriteFields({
      lat,
      lng,
      createdAt: NOW,
      expiryMinutes: 45,
    })
    assert.deepEqual(r, again)
  })

  it("no second GPS request / no follow-up geo update", () => {
    assert.equal(geoDualWriteRequestsGps(), false)
    assert.equal(geoDualWriteUsesFollowUpUpdate(), false)
  })

  it("one Firestore create write only (App wires geo into same addDoc)", () => {
    assert.match(appSrc, /buildReportGeoWriteFields/)
    assert.match(appSrc, /Timestamp\.fromMillis/)
    assert.match(appSrc, /geohash:\s*geo\.fields\.geohash/)
    assert.match(appSrc, /expiresAt:\s*Timestamp\.fromMillis/)
    // Still a single addDoc per createUserReport / stolen path (no updateDoc for geo)
    assert.equal(
      (appSrc.match(/await addDoc\(collection\(db,\s*"reports"/g) || []).length,
      2
    )
  })

  it("legacy missing geohash/expiresAt safe", () => {
    const fields = readLegacyGeoFields({ lat: 33, lng: 35, expiry: 60 })
    assert.equal(fields.hasGeohash, false)
    assert.equal(fields.hasExpiresAt, false)
  })

  it("invalid coordinate create safely rejected", () => {
    const r = buildReportGeoWriteFields({
      lat: 999,
      lng: 35,
      createdAt: NOW,
      expiryMinutes: 30,
    })
    assert.equal(r.ok, false)
  })

  it("invalid expiry safely rejected", () => {
    const r = buildReportGeoWriteFields({
      lat: BEIRUT.lat,
      lng: BEIRUT.lng,
      createdAt: NOW,
      expiryMinutes: -5,
    })
    assert.equal(r.ok, false)
  })

  it("current broad listener unchanged", () => {
    assert.match(
      appSrc,
      /onSnapshot\(\s*\n?\s*collection\(db,\s*["']reports["']\)/
    )
    assert.doesNotMatch(appSrc, /where\(\s*["']geohash["']/)
    assert.doesNotMatch(appSrc, /where\(\s*["']expiresAt["']/)
  })

  it("Nearby does not require geohash", () => {
    const out = getNearbyReportCandidates({
      reports: [
        {
          id: "n1",
          type: "زحمة",
          reportFamily: "intelligence",
          reportCategory: "traffic",
          lat: BEIRUT.lat,
          lng: BEIRUT.lng,
          createdAt: Date.now(),
          expiry: 60,
          resolved: false,
        },
      ],
      rider: BEIRUT,
    })
    assert.equal(out.length, 1)
  })

  it("Duplicate does not require geohash", () => {
    const match = findLikelyDuplicateReport({
      reports: [
        {
          id: "d1",
          type: "حاجز",
          reportFamily: "intelligence",
          reportCategory: "checkpoint",
          lat: BEIRUT.lat,
          lng: BEIRUT.lng,
          createdAt: Date.now(),
          expiry: 60,
          resolved: false,
        },
      ],
      createCategory: "checkpoint",
      createLat: BEIRUT.lat,
      createLng: BEIRUT.lng,
    })
    assert.ok(match)
    assert.equal(match.id, "d1")
  })
})
