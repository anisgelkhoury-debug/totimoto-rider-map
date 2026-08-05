import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { capMapReports } from "../../src/utils/capMapReports.ts"

describe("capMapReports", () => {
  it("returns input when under cap", () => {
    const reports = [{ id: "1" }, { id: "2" }]
    assert.equal(capMapReports(reports, { cap: 10, deviceId: "d" }), reports)
  })

  it("keeps owner and selected when capping", () => {
    const reports = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      ownerId: i === 15 ? "me" : "other",
    }))
    const out = capMapReports(reports, {
      cap: 5,
      deviceId: "me",
      selectedId: "3",
    })
    assert.equal(out.length, 5)
    assert.ok(out.some((r) => r.id === "15"))
    assert.ok(out.some((r) => r.id === "3"))
  })
})
