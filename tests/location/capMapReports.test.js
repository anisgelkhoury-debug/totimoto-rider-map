/**
 * Ranked map-marker cap tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  CAP_TIER,
  capMapReports,
  reportCapTier,
} from "../../src/utils/capMapReports.ts"

const near = { lat: 33.9, lng: 35.5 }
const far = { lat: 34.5, lng: 36.2 }
const me = [33.9, 35.5]

describe("capMapReports", () => {
  it("returns input when under cap", () => {
    const reports = [{ id: "1" }, { id: "2" }]
    assert.equal(capMapReports(reports, { cap: 10, deviceId: "d" }), reports)
  })

  it("selected report always included even if late", () => {
    const reports = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      ownerId: "other",
      reportFamily: "intelligence",
      priority: "low",
      ...far,
      createdAt: i,
    }))
    reports.push({
      id: "selected-late",
      ownerId: "other",
      reportFamily: "intelligence",
      priority: "low",
      ...far,
      createdAt: 0,
    })
    const out = capMapReports(reports, {
      cap: 5,
      deviceId: "me",
      selectedId: "selected-late",
      userLocation: me,
    })
    assert.equal(out.length, 5)
    assert.ok(out.some((r) => r.id === "selected-late"))
    assert.equal(reportCapTier(out[0], { deviceId: "me", selectedId: "selected-late" }), CAP_TIER.selected)
  })

  it("owned reports always included even if late", () => {
    const reports = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      ownerId: "other",
      reportFamily: "intelligence",
      priority: "low",
      ...far,
      createdAt: i,
    }))
    reports.push({
      id: "mine",
      ownerId: "me",
      reportFamily: "intelligence",
      priority: "low",
      ...far,
      createdAt: 1,
    })
    const out = capMapReports(reports, {
      cap: 5,
      deviceId: "me",
      userLocation: me,
    })
    assert.ok(out.some((r) => r.id === "mine"))
  })

  it("current-helper report always included", () => {
    const reports = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `ord-${i}`,
        ownerId: "x",
        reportFamily: "intelligence",
        priority: "low",
        ...far,
        createdAt: i,
      })),
      {
        id: "helping",
        ownerId: "owner",
        helperId: "me",
        helperComing: true,
        reportFamily: "assistance",
        ...far,
        createdAt: 1,
      },
    ]
    const out = capMapReports(reports, { cap: 3, deviceId: "me", userLocation: me })
    assert.ok(out.some((r) => r.id === "helping"))
  })

  it("stolen report prioritized over ordinary", () => {
    const reports = [
      {
        id: "ord",
        ownerId: "x",
        reportFamily: "intelligence",
        priority: "low",
        ...near,
        createdAt: 100,
      },
      {
        id: "stolen",
        ownerId: "y",
        reportFamily: "stolen",
        priority: "high",
        ...far,
        createdAt: 1,
      },
    ]
    const out = capMapReports(reports, { cap: 1, deviceId: "me", userLocation: me })
    assert.equal(out[0].id, "stolen")
  })

  it("claimed assistance prioritized over unclaimed", () => {
    const reports = [
      {
        id: "open",
        ownerId: "a",
        reportFamily: "assistance",
        helperComing: false,
        ...near,
        createdAt: 50,
      },
      {
        id: "claimed",
        ownerId: "b",
        reportFamily: "assistance",
        helperComing: true,
        helperId: "someone",
        ...far,
        createdAt: 1,
      },
    ]
    const out = capMapReports(reports, { cap: 1, deviceId: "me", userLocation: me })
    assert.equal(out[0].id, "claimed")
  })

  it("unclaimed assistance prioritized over ordinary intel", () => {
    const reports = [
      {
        id: "intel",
        ownerId: "a",
        reportFamily: "intelligence",
        priority: "medium",
        ...near,
        createdAt: 99,
      },
      {
        id: "need-help",
        ownerId: "b",
        reportFamily: "sharedRide",
        helperComing: false,
        ...far,
        createdAt: 1,
      },
    ]
    const out = capMapReports(reports, { cap: 1, deviceId: "me", userLocation: me })
    assert.equal(out[0].id, "need-help")
  })

  it("high-priority intelligence prioritized over low", () => {
    const reports = [
      {
        id: "low",
        ownerId: "a",
        reportFamily: "intelligence",
        priority: "low",
        ...near,
        createdAt: 99,
      },
      {
        id: "hi",
        ownerId: "b",
        reportFamily: "intelligence",
        priority: "high",
        ...far,
        createdAt: 1,
      },
    ]
    const out = capMapReports(reports, { cap: 1, deviceId: "me", userLocation: me })
    assert.equal(out[0].id, "hi")
  })

  it("nearest ordinary reports selected before distant ordinary", () => {
    const reports = [
      {
        id: "far",
        ownerId: "a",
        reportFamily: "intelligence",
        priority: "low",
        ...far,
        createdAt: 10,
      },
      {
        id: "near",
        ownerId: "b",
        reportFamily: "intelligence",
        priority: "low",
        ...near,
        createdAt: 1,
      },
    ]
    const out = capMapReports(reports, { cap: 1, deviceId: "me", userLocation: me })
    assert.equal(out[0].id, "near")
  })

  it("deterministic without user location (recency within tier)", () => {
    const reports = [
      {
        id: "old",
        ownerId: "a",
        reportFamily: "intelligence",
        priority: "low",
        ...near,
        createdAt: 10,
      },
      {
        id: "new",
        ownerId: "b",
        reportFamily: "intelligence",
        priority: "low",
        ...far,
        createdAt: 99,
      },
    ]
    const out = capMapReports(reports, { cap: 1, deviceId: "me", userLocation: null })
    assert.equal(out[0].id, "new")
  })

  it("no duplicates and exact cap respected", () => {
    const reports = Array.from({ length: 12 }, (_, i) => ({
      id: String(i % 10),
      ownerId: "x",
      reportFamily: "intelligence",
      priority: "low",
      lat: 33.9 + i * 0.01,
      lng: 35.5,
      createdAt: i,
    }))
    const out = capMapReports(reports, { cap: 5, deviceId: "me", userLocation: me })
    assert.equal(out.length, 5)
    const ids = out.map((r) => String(r.id))
    assert.equal(new Set(ids).size, ids.length)
  })

  it("invalid coordinates safely handled", () => {
    const reports = [
      {
        id: "bad",
        ownerId: "a",
        reportFamily: "intelligence",
        priority: "low",
        lat: Number.NaN,
        lng: 35.5,
        createdAt: 100,
      },
      {
        id: "good",
        ownerId: "b",
        reportFamily: "intelligence",
        priority: "low",
        ...near,
        createdAt: 1,
      },
    ]
    const out = capMapReports(reports, { cap: 1, deviceId: "me", userLocation: me })
    assert.equal(out[0].id, "good")
  })

  it("overflow: when protected exceed cap, keep highest tiers only", () => {
    const reports = [
      { id: "sel", ownerId: "o", reportFamily: "intelligence", priority: "low", ...far, createdAt: 1 },
      { id: "own", ownerId: "me", reportFamily: "intelligence", priority: "low", ...far, createdAt: 2 },
      {
        id: "help",
        ownerId: "o2",
        helperId: "me",
        helperComing: true,
        reportFamily: "assistance",
        ...far,
        createdAt: 3,
      },
      { id: "stolen", ownerId: "o3", reportFamily: "stolen", ...far, createdAt: 4 },
      {
        id: "claimed",
        ownerId: "o4",
        reportFamily: "assistance",
        helperComing: true,
        ...far,
        createdAt: 5,
      },
    ]
    const out = capMapReports(reports, {
      cap: 3,
      deviceId: "me",
      selectedId: "sel",
      userLocation: me,
    })
    assert.equal(out.length, 3)
    assert.deepEqual(
      out.map((r) => r.id),
      ["sel", "own", "help"]
    )
  })
})
