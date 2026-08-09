/**
 * Smart Report Lifecycle — soft-hide after likely-gone grace (aggregates only).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isReportExpired } from "../../src/utils/reportSnapshot.ts"
import {
  LIFECYCLE_LIKELY_GONE_GRACE_MS,
} from "../../src/reportLifecycle/lifecycleConfig.ts"
import {
  confirmationCountsFromReportAggregates,
  isExcludedFromDuplicateByLifecycle,
  isExcludedFromNearbyByLifecycle,
  isReportSoftHiddenByLifecycle,
  lifecycleDeletesReports,
  lifecycleExtendsExpiry,
  lifecycleMutatesResolvedAt,
  lifecycleRequiresPerMarkerConfirmationReads,
  lifecycleSoftHidesReports,
  shouldShowReportByLifecycle,
} from "../../src/reportLifecycle/reportLifecycle.ts"
import { getNearbyReportCandidates } from "../../src/nearby/nearbyIntelligence.ts"
import { findLikelyDuplicateReport } from "../../src/duplicateReports/duplicateReportIntelligence.ts"

const NOW = 1_700_000_000_000
const GRACE = LIFECYCLE_LIKELY_GONE_GRACE_MS

function roadReport(overrides = {}) {
  return {
    id: "r1",
    type: "زحمة",
    reportFamily: "intelligence",
    reportCategory: "traffic",
    ownerId: "device-owner",
    ownerUid: "uid-owner",
    createdAt: NOW - 10 * 60_000,
    expiry: 120,
    resolved: false,
    lat: 33.89,
    lng: 35.5,
    ...overrides,
  }
}

function softHiddenAggregates(since = NOW - GRACE - 1000) {
  return {
    confirmationPresentCount: 0,
    confirmationGoneCount: 3,
    likelyGoneSince: since,
  }
}

describe("smart report lifecycle — visibility", () => {
  it("default report visible", () => {
    assert.equal(
      shouldShowReportByLifecycle(roadReport(), { now: NOW }),
      true
    )
    assert.equal(isReportSoftHiddenByLifecycle(roadReport(), NOW), false)
  })

  it("confirmed report visible", () => {
    const r = roadReport({
      confirmationPresentCount: 4,
      confirmationGoneCount: 0,
      likelyGoneSince: null,
    })
    assert.equal(shouldShowReportByLifecycle(r, { now: NOW }), true)
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
  })

  it("disputed report visible", () => {
    const r = roadReport({
      confirmationPresentCount: 3,
      confirmationGoneCount: 3,
      likelyGoneSince: NOW - GRACE * 2,
    })
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
    assert.equal(shouldShowReportByLifecycle(r, { now: NOW }), true)
  })

  it("likely-gone before grace visible", () => {
    const r = roadReport({
      ...softHiddenAggregates(NOW - GRACE + 30_000),
    })
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
    assert.equal(shouldShowReportByLifecycle(r, { now: NOW }), true)
  })

  it("likely-gone after grace soft-hidden", () => {
    const r = roadReport(softHiddenAggregates())
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), true)
    assert.equal(shouldShowReportByLifecycle(r, { now: NOW }), false)
  })

  it("present vote reverses likely-gone state", () => {
    const r = roadReport({
      confirmationPresentCount: 3,
      confirmationGoneCount: 3,
      likelyGoneSince: NOW - GRACE * 2,
    })
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
  })

  it("selected report preserved", () => {
    const r = roadReport({ id: "sel", ...softHiddenAggregates() })
    assert.equal(
      shouldShowReportByLifecycle(r, {
        now: NOW,
        selectedReportId: "sel",
      }),
      true
    )
  })

  it("owner report preserved in owner context", () => {
    const r = roadReport({ id: "own", ...softHiddenAggregates() })
    assert.equal(
      shouldShowReportByLifecycle(r, {
        now: NOW,
        viewerDeviceId: "device-owner",
      }),
      true
    )
    assert.equal(
      shouldShowReportByLifecycle(r, {
        now: NOW,
        viewerUid: "uid-owner",
      }),
      true
    )
  })

  it("expired report still excluded", () => {
    const r = roadReport({
      createdAt: NOW - 200 * 60_000,
      expiry: 60,
      ...softHiddenAggregates(),
    })
    assert.equal(isReportExpired(r, NOW), true)
  })

  it("assistance unaffected", () => {
    const r = {
      id: "a1",
      type: "عطل بالدراجة",
      reportFamily: "assistance",
      reportCategory: "bike_broken",
      confirmationPresentCount: 0,
      confirmationGoneCount: 10,
      likelyGoneSince: NOW - GRACE * 2,
    }
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
    assert.equal(shouldShowReportByLifecycle(r, { now: NOW }), true)
  })

  it("sharedRide unaffected", () => {
    const r = {
      id: "s1",
      type: "وصلني معك",
      reportFamily: "sharedRide",
      confirmationPresentCount: 0,
      confirmationGoneCount: 10,
      likelyGoneSince: NOW - GRACE * 2,
    }
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
  })

  it("stolen unaffected", () => {
    const r = {
      id: "st1",
      type: "دراجة مسروقة",
      reportFamily: "stolen",
      confirmationPresentCount: 0,
      confirmationGoneCount: 10,
      likelyGoneSince: NOW - GRACE * 2,
    }
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
  })

  it("Nearby excludes soft-hidden", () => {
    const soft = roadReport({
      id: "soft-near",
      ...softHiddenAggregates(),
    })
    const live = roadReport({
      id: "live-near",
      confirmationPresentCount: 0,
      confirmationGoneCount: 0,
    })
    const out = getNearbyReportCandidates({
      reports: [soft, live],
      rider: { lat: 33.89, lng: 35.5 },
      now: NOW,
    })
    assert.equal(
      out.some((c) => c.id === "soft-near"),
      false
    )
    assert.equal(
      out.some((c) => c.id === "live-near"),
      true
    )
    assert.equal(isExcludedFromNearbyByLifecycle(soft, NOW), true)
  })

  it("Duplicate detection excludes soft-hidden", () => {
    const soft = roadReport({
      id: "soft-dup",
      reportCategory: "checkpoint",
      type: "حاجز",
      ...softHiddenAggregates(),
    })
    const match = findLikelyDuplicateReport({
      reports: [soft],
      createCategory: "checkpoint",
      createLat: soft.lat,
      createLng: soft.lng,
      now: NOW,
    })
    assert.equal(match, null)
    assert.equal(isExcludedFromDuplicateByLifecycle(soft, NOW), true)
  })

  it("normal TTL not extended", () => {
    assert.equal(lifecycleExtendsExpiry(), false)
  })

  it("no Firestore delete", () => {
    assert.equal(lifecycleDeletesReports(), false)
  })

  it("no resolvedAt mutation", () => {
    assert.equal(lifecycleMutatesResolvedAt(), false)
  })

  it("deterministic lifecycle helper", () => {
    const r = roadReport(softHiddenAggregates())
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), true)
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), true)
    assert.equal(lifecycleSoftHidesReports(), true)
    assert.equal(lifecycleRequiresPerMarkerConfirmationReads(), false)
    assert.deepEqual(confirmationCountsFromReportAggregates(r), {
      presentCount: 0,
      goneCount: 3,
      total: 3,
    })
  })

  it("missing likelyGoneSince never soft-hides even if counts say gone", () => {
    const r = roadReport({
      confirmationPresentCount: 0,
      confirmationGoneCount: 5,
    })
    assert.equal(isReportSoftHiddenByLifecycle(r, NOW), false)
  })

  it("reappearance when aggregates leave likely-gone", () => {
    const hidden = roadReport(softHiddenAggregates())
    assert.equal(shouldShowReportByLifecycle(hidden, { now: NOW }), false)
    const revived = roadReport({
      confirmationPresentCount: 4,
      confirmationGoneCount: 1,
      likelyGoneSince: null,
    })
    assert.equal(shouldShowReportByLifecycle(revived, { now: NOW }), true)
  })
})
