/**
 * Tests for live report snapshot normalization / expiry / identity.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  isReportExpired,
  normalizeLiveReports,
  normalizeReportCreatedAt,
  reportRenderKey,
} from "../../src/utils/reportSnapshot.ts"
import {
  reportMapFingerprint,
  reportsMapFingerprint,
} from "../../src/utils/reportsRenderStability.ts"

describe("normalizeReportCreatedAt", () => {
  it("passes through millisecond timestamps", () => {
    assert.equal(normalizeReportCreatedAt(1_700_000_000_000), 1_700_000_000_000)
  })

  it("converts unix seconds to milliseconds", () => {
    assert.equal(normalizeReportCreatedAt(1_700_000_000), 1_700_000_000_000)
  })

  it("reads Firestore Timestamp-like toMillis()", () => {
    assert.equal(
      normalizeReportCreatedAt({ toMillis: () => 1_700_000_000_123 }),
      1_700_000_000_123
    )
  })

  it("reads seconds/nanoseconds shape", () => {
    assert.equal(
      normalizeReportCreatedAt({ seconds: 1_700_000_000, nanoseconds: 5e6 }),
      1_700_000_000_005
    )
  })
})

describe("isReportExpired / normalizeLiveReports", () => {
  const now = 1_700_000_000_000

  it("one Firestore document produces one report-state item", () => {
    const docs = [
      {
        id: "a1",
        data: () => ({
          type: "زحمة",
          createdAt: now - 60_000,
          expiry: 15,
          resolved: false,
        }),
      },
    ]
    const live = normalizeLiveReports(docs, now)
    assert.equal(live.length, 1)
    assert.equal(live[0].id, "a1")
  })

  it("duplicate document ids are deduplicated", () => {
    const docs = [
      {
        id: "dup",
        data: () => ({ type: "A", createdAt: now, expiry: 30 }),
      },
      {
        id: "dup",
        data: () => ({ type: "B", createdAt: now, expiry: 30 }),
      },
    ]
    const live = normalizeLiveReports(docs, now)
    assert.equal(live.length, 1)
    assert.equal(live[0].type, "A")
  })

  it("string and numeric id forms normalize via String(id) on ingest", () => {
    const docs = [
      {
        id: "123",
        data: () => ({ id: 123, type: "x", createdAt: now, expiry: 30 }),
      },
    ]
    const live = normalizeLiveReports(docs, now)
    assert.equal(live[0].id, "123")
    assert.equal(typeof live[0].id, "string")
  })

  it("drops expired shared-ride that would otherwise ghost after create", () => {
    const eightyTwoHoursMs = 82 * 60 * 60 * 1000
    const docs = [
      {
        id: "ghost-ride",
        data: () => ({
          type: "وصلني معك",
          reportFamily: "sharedRide",
          createdAt: now - eightyTwoHoursMs,
          expiry: 10,
          resolved: false,
        }),
      },
      {
        id: "fresh",
        data: () => ({
          type: "زحمة",
          reportFamily: "intelligence",
          createdAt: now - 30_000,
          expiry: 15,
          resolved: false,
        }),
      },
    ]
    const live = normalizeLiveReports(docs, now)
    assert.deepEqual(
      live.map((r) => r.id),
      ["fresh"]
    )
  })

  it("drops resolved reports", () => {
    const docs = [
      {
        id: "done",
        data: () => ({
          type: "زحمة",
          createdAt: now,
          expiry: 15,
          resolved: true,
        }),
      },
    ]
    assert.equal(normalizeLiveReports(docs, now).length, 0)
  })

  it("isReportExpired matches minutes vs expiry", () => {
    assert.equal(
      isReportExpired(
        { createdAt: now - 11 * 60 * 1000, expiry: 10 },
        now
      ),
      true
    )
    assert.equal(
      isReportExpired(
        { createdAt: now - 5 * 60 * 1000, expiry: 10 },
        now
      ),
      false
    )
  })
})

describe("report fingerprints and render keys", () => {
  it("fingerprint changes when type changes", () => {
    const a = reportMapFingerprint({ id: "1", type: "A", lat: 1, lng: 2 })
    const b = reportMapFingerprint({ id: "1", type: "B", lat: 1, lng: 2 })
    assert.notEqual(a, b)
  })

  it("fingerprint changes when label/type and reportFamily change", () => {
    const a = reportMapFingerprint({
      id: "1",
      type: "وصلني معك",
      reportFamily: "sharedRide",
    })
    const b = reportMapFingerprint({
      id: "1",
      type: "زحمة",
      reportFamily: "intelligence",
    })
    assert.notEqual(a, b)
  })

  it("array fingerprint differs when membership changes", () => {
    const onlyFresh = reportsMapFingerprint([
      { id: "fresh", type: "زحمة", createdAt: 1 },
    ])
    const withGhost = reportsMapFingerprint([
      { id: "ghost", type: "وصلني معك", createdAt: 2 },
      { id: "fresh", type: "زحمة", createdAt: 1 },
    ])
    assert.notEqual(onlyFresh, withGhost)
  })

  it("reportRenderKey prefers Firestore id", () => {
    assert.equal(reportRenderKey({ id: "abc" }, 3), "report-abc")
    assert.equal(reportRenderKey({}, 3), "report-fallback-3")
  })
})
