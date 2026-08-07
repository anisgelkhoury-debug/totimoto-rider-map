/**
 * حاجز (checkpoint) road-intelligence tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  CAP_TIER,
  capMapReports,
  reportCapTier,
} from "../../src/utils/capMapReports.ts"
import { isReportExpired, normalizeLiveReports } from "../../src/utils/reportSnapshot.ts"
import {
  CHECKPOINT_REPORT_TYPE,
  buildIntelligenceCreateFields,
  isCheckpointReport,
  isRoadIntelligenceReport,
  matchesReportTypeSearch,
} from "../../src/utils/roadIntelligenceTypes.ts"

describe("checkpoint road intelligence", () => {
  it("is recognized as intelligence / checkpoint", () => {
    assert.equal(CHECKPOINT_REPORT_TYPE.reportFamily, "intelligence")
    assert.equal(CHECKPOINT_REPORT_TYPE.reportCategory, "checkpoint")
    assert.equal(CHECKPOINT_REPORT_TYPE.label, "حاجز")
    assert.ok(isCheckpointReport(CHECKPOINT_REPORT_TYPE))
    assert.ok(isRoadIntelligenceReport(CHECKPOINT_REPORT_TYPE))
    assert.ok(
      isCheckpointReport({
        type: "حاجز",
        reportFamily: "intelligence",
        reportCategory: "checkpoint",
      })
    )
  })

  it("create payload uses existing schema fields", () => {
    const fields = buildIntelligenceCreateFields(CHECKPOINT_REPORT_TYPE)
    assert.deepEqual(fields, {
      type: "حاجز",
      emoji: "🛂",
      color: "#334155",
      expiry: 60,
      priority: "high",
      reportFamily: "intelligence",
      reportCategory: "checkpoint",
    })
    assert.equal(Object.keys(fields).includes("verified"), false)
  })

  it("expiry is 60 minutes", () => {
    assert.equal(CHECKPOINT_REPORT_TYPE.expiry, 60)
  })

  it("expires correctly via isReportExpired", () => {
    const now = Date.UTC(2026, 7, 7, 12, 0, 0)
    const fresh = {
      createdAt: now - 30 * 60 * 1000,
      expiry: 60,
      resolved: false,
    }
    const stale = {
      createdAt: now - 61 * 60 * 1000,
      expiry: 60,
      resolved: false,
    }
    assert.equal(isReportExpired(fresh, now), false)
    assert.equal(isReportExpired(stale, now), true)
  })

  it("expired checkpoint filtered from snapshot normalize", () => {
    const now = Date.UTC(2026, 7, 7, 12, 0, 0)
    const docs = [
      {
        id: "live-cp",
        data: () => ({
          type: "حاجز",
          reportFamily: "intelligence",
          reportCategory: "checkpoint",
          createdAt: now - 10 * 60 * 1000,
          expiry: 60,
          resolved: false,
          lat: 33.9,
          lng: 35.5,
        }),
      },
      {
        id: "dead-cp",
        data: () => ({
          type: "حاجز",
          reportFamily: "intelligence",
          reportCategory: "checkpoint",
          createdAt: now - 90 * 60 * 1000,
          expiry: 60,
          resolved: false,
          lat: 33.9,
          lng: 35.5,
        }),
      },
    ]
    const live = normalizeLiveReports(docs, now)
    assert.equal(live.length, 1)
    assert.equal(live[0].id, "live-cp")
    assert.equal(live[0].type, "حاجز")
  })

  it("Arabic label and marker mapping fields exist", () => {
    assert.equal(CHECKPOINT_REPORT_TYPE.label, "حاجز")
    assert.ok(CHECKPOINT_REPORT_TYPE.emoji.length > 0)
    assert.ok(CHECKPOINT_REPORT_TYPE.color.startsWith("#"))
  })

  it("included in road type search / filter", () => {
    const report = {
      type: "حاجز",
      reportFamily: "intelligence",
      reportCategory: "checkpoint",
    }
    assert.equal(matchesReportTypeSearch(report, ""), true)
    assert.equal(matchesReportTypeSearch(report, "الكل"), true)
    assert.equal(matchesReportTypeSearch(report, "حاجز"), true)
    assert.equal(matchesReportTypeSearch(report, "زحمة"), false)
  })

  it("map cap treats checkpoint as seriousRoadIntel above ordinary traffic", () => {
    const opts = { deviceId: "me", selectedId: null }
    const checkpoint = {
      id: "cp",
      ownerId: "other",
      reportFamily: "intelligence",
      reportCategory: "checkpoint",
      type: "حاجز",
      priority: "high",
      lat: 33.9,
      lng: 35.5,
      createdAt: 1,
    }
    const traffic = {
      id: "tr",
      ownerId: "other",
      reportFamily: "intelligence",
      reportCategory: "traffic",
      type: "زحمة",
      priority: "medium",
      lat: 33.9,
      lng: 35.5,
      createdAt: 2,
    }
    assert.equal(reportCapTier(checkpoint, opts), CAP_TIER.seriousRoadIntel)
    assert.equal(reportCapTier(traffic, opts), CAP_TIER.ordinary)

    const far = { lat: 34.5, lng: 36.2 }
    const filler = Array.from({ length: 20 }, (_, i) => ({
      id: `ord-${i}`,
      ownerId: "x",
      reportFamily: "intelligence",
      priority: "low",
      ...far,
      createdAt: i,
    }))
    const out = capMapReports([...filler, checkpoint, traffic], {
      cap: 5,
      deviceId: "me",
      userLocation: [33.9, 35.5],
    })
    assert.ok(out.some((r) => r.id === "cp"))
    assert.equal(out.filter((r) => r.id === "cp").length, 1)
  })
})
