/**
 * resolveCreateLocation pure helper tests (injected geolocation).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  isValidLatLngTuple,
  resolveCreateLocation,
} from "../../src/utils/resolveCreateLocation.ts"

describe("resolveCreateLocation", () => {
  it("validates coordinate tuples", () => {
    assert.equal(isValidLatLngTuple([33.9, 35.5]), true)
    assert.equal(isValidLatLngTuple([99, 35.5]), false)
    assert.equal(isValidLatLngTuple(null), false)
    assert.equal(isValidLatLngTuple([NaN, 1]), false)
  })

  it("fresh location succeeds", async () => {
    const result = await resolveCreateLocation({
      existing: [33.8, 35.4],
      timeoutMs: 1000,
      getCurrentPosition: (success) => {
        success({ coords: { latitude: 33.91, longitude: 35.51 } })
      },
    })
    assert.equal(result.source, "fresh")
    assert.deepEqual(result.coords, [33.91, 35.51])
  })

  it("falls back to existing when fresh fails", async () => {
    const result = await resolveCreateLocation({
      existing: [33.8, 35.4],
      timeoutMs: 50,
      getCurrentPosition: (_s, error) => {
        error?.({ code: 3, message: "timeout" })
      },
    })
    assert.equal(result.source, "fallback")
    assert.deepEqual(result.coords, [33.8, 35.4])
  })

  it("falls back to existing when getter missing", async () => {
    const result = await resolveCreateLocation({
      existing: [33.7, 35.3],
      getCurrentPosition: null,
    })
    assert.equal(result.source, "fallback")
    assert.deepEqual(result.coords, [33.7, 35.3])
  })

  it("returns none when no fresh and no valid existing", async () => {
    const result = await resolveCreateLocation({
      existing: null,
      getCurrentPosition: null,
    })
    assert.equal(result.source, "none")
    assert.equal(result.coords, null)
  })

  it("rejects invalid existing and still returns none without GPS", async () => {
    const result = await resolveCreateLocation({
      existing: [999, 35.5],
      getCurrentPosition: null,
    })
    assert.equal(result.source, "none")
    assert.equal(result.coords, null)
  })

  it("does not invent Beirut coordinates", async () => {
    const result = await resolveCreateLocation({
      existing: null,
      getCurrentPosition: (_s, err) => err?.({ message: "denied" }),
      timeoutMs: 50,
    })
    assert.equal(result.coords, null)
  })
})
