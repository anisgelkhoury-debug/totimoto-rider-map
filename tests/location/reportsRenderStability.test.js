/**
 * Unit tests for report fingerprint / distance stability helpers.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  distanceMeters,
  reportMapFingerprint,
  reportsMapFingerprint,
} from "../../src/utils/reportsRenderStability.ts"

describe("reportsRenderStability", () => {
  it("fingerprints identical reports equally", () => {
    const a = {
      id: "1",
      lat: 33.8,
      lng: 35.5,
      resolved: false,
      reportFamily: "assistance",
      helperComing: true,
      helperLat: 33.81,
      helperLng: 35.51,
    }
    assert.equal(reportMapFingerprint(a), reportMapFingerprint({ ...a }))
  })

  it("changes fingerprint when helper GPS moves", () => {
    const base = {
      id: "1",
      lat: 33.8,
      lng: 35.5,
      helperComing: true,
      helperLat: 33.81,
      helperLng: 35.51,
    }
    assert.notEqual(
      reportMapFingerprint(base),
      reportMapFingerprint({ ...base, helperLat: 33.82 })
    )
  })

  it("array fingerprint stable for same content", () => {
    const list = [{ id: "a", lat: 1, lng: 2 }]
    assert.equal(reportsMapFingerprint(list), reportsMapFingerprint([...list]))
  })

  it("distanceMeters returns ~0 for same point", () => {
    assert.ok(distanceMeters(33.89, 35.5, 33.89, 35.5) < 0.01)
  })

  it("distanceMeters increases with separation", () => {
    const near = distanceMeters(33.89, 35.5, 33.8901, 35.5)
    const far = distanceMeters(33.89, 35.5, 33.9, 35.5)
    assert.ok(far > near)
    assert.ok(far > 100)
  })
})
