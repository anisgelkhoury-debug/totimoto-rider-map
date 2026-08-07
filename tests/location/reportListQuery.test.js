/**
 * Reports list geo filter / sort unit tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  compareReportsForSort,
  countUnresolvedByFamily,
  filterAndSortReports,
  matchesGeoFilter,
} from "../../src/utils/reportListQuery.ts"

describe("reportListQuery", () => {
  const beirut = {
    id: "1",
    area: "الحمرا",
    city: "بيروت",
    lat: 33.9,
    lng: 35.5,
    priority: "low",
    createdAt: 100,
    reportFamily: "intelligence",
  }
  const tripoli = {
    id: "2",
    area: "طرابلس",
    city: "الشمال",
    lat: 34.4,
    lng: 35.8,
    priority: "high",
    createdAt: 200,
    reportFamily: "assistance",
  }

  it("matchesGeoFilter region keywords", () => {
    assert.equal(matchesGeoFilter(beirut, "beirut", null), true)
    assert.equal(matchesGeoFilter(tripoli, "beirut", null), false)
    assert.equal(matchesGeoFilter(tripoli, "north", null), true)
  })

  it("matchesGeoFilter near radius", () => {
    const me = [33.9, 35.5]
    assert.equal(matchesGeoFilter(beirut, "near", me, 25), true)
    assert.equal(matchesGeoFilter(tripoli, "near", me, 25), false)
  })

  it("sorts by newest / important / nearest", () => {
    const me = [33.9, 35.5]
    assert.ok(compareReportsForSort(beirut, tripoli, "newest", me) > 0)
    assert.ok(compareReportsForSort(beirut, tripoli, "important", me) > 0)
    assert.ok(compareReportsForSort(beirut, tripoli, "nearest", me) < 0)
  })

  it("filterAndSortReports composes", () => {
    const out = filterAndSortReports([beirut, tripoli], {
      geoFilter: "beirut",
      sortFilter: "newest",
      myLocation: null,
    })
    assert.equal(out.length, 1)
    assert.equal(out[0].id, "1")
  })

  it("countUnresolvedByFamily single pass", () => {
    const counts = countUnresolvedByFamily([
      beirut,
      tripoli,
      { ...beirut, id: "3", resolved: true, reportFamily: "stolen" },
      { id: "4", reportFamily: "stolen", createdAt: 1 },
      { id: "5", reportFamily: "sharedRide", createdAt: 1 },
    ])
    assert.deepEqual(counts, {
      intelligence: 1,
      assistance: 1,
      sharedRide: 1,
      stolen: 1,
      incident: 0,
    })
  })
})
