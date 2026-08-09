/**
 * Confirmation aggregate unit tests (no network / no Admin).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildAggregatePatch,
  computeAggregateSyncState,
  countConfirmationStatuses,
  isLikelyGoneCounts,
  nextLikelyGoneSinceMs,
} from "../confirmationAggregates/logic"

describe("confirmation aggregate recount", () => {
  it("create present increments present", () => {
    const c = countConfirmationStatuses([{ status: "present" }])
    assert.equal(c.presentCount, 1)
    assert.equal(c.goneCount, 0)
  })

  it("create gone increments gone", () => {
    const c = countConfirmationStatuses([{ status: "gone" }])
    assert.equal(c.presentCount, 0)
    assert.equal(c.goneCount, 1)
  })

  it("present→gone reflected by recount", () => {
    const c = countConfirmationStatuses([
      { status: "gone" },
      { status: "present" },
    ])
    assert.equal(c.presentCount, 1)
    assert.equal(c.goneCount, 1)
  })

  it("gone→present reflected by recount", () => {
    const before = countConfirmationStatuses([
      { status: "gone" },
      { status: "gone" },
      { status: "gone" },
    ])
    assert.equal(before.goneCount, 3)
    const after = countConfirmationStatuses([
      { status: "present" },
      { status: "gone" },
      { status: "gone" },
    ])
    assert.equal(after.presentCount, 1)
    assert.equal(after.goneCount, 2)
  })

  it("delete decrements correct side via recount", () => {
    const afterDelete = countConfirmationStatuses([
      { status: "present" },
      { status: "gone" },
    ])
    assert.equal(afterDelete.presentCount, 1)
    assert.equal(afterDelete.goneCount, 1)
  })

  it("no negative counters", () => {
    const c = countConfirmationStatuses([])
    assert.equal(c.presentCount, 0)
    assert.equal(c.goneCount, 0)
    const patch = buildAggregatePatch({
      counts: { presentCount: -5, goneCount: -2 },
      likelyGoneSinceMs: null,
      nowMs: 1,
      clearLikelyGoneSince: true,
    })
    assert.equal(patch.confirmationPresentCount, 0)
    assert.equal(patch.confirmationGoneCount, 0)
  })

  it("idempotent recount same docs same counts", () => {
    const docs = [
      { status: "gone" },
      { status: "gone" },
      { status: "gone" },
      { status: "present" },
    ]
    const a = countConfirmationStatuses(docs)
    const b = countConfirmationStatuses(docs)
    assert.deepEqual(a, b)
  })
})

describe("likelyGoneSince transitions", () => {
  it("sets likelyGoneSince when entering threshold", () => {
    assert.equal(isLikelyGoneCounts({ presentCount: 0, goneCount: 3 }), true)
    const since = nextLikelyGoneSinceMs({
      nextCounts: { presentCount: 0, goneCount: 3 },
      existingLikelyGoneSinceMs: null,
      nowMs: 1000,
    })
    assert.equal(since, 1000)
  })

  it("keeps existing likelyGoneSince while remaining likely-gone", () => {
    const since = nextLikelyGoneSinceMs({
      nextCounts: { presentCount: 1, goneCount: 4 },
      existingLikelyGoneSinceMs: 500,
      nowMs: 2000,
    })
    assert.equal(since, 500)
  })

  it("clears likelyGoneSince when leaving state", () => {
    const since = nextLikelyGoneSinceMs({
      nextCounts: { presentCount: 3, goneCount: 3 },
      existingLikelyGoneSinceMs: 500,
      nowMs: 2000,
    })
    assert.equal(since, null)

    const patch = computeAggregateSyncState({
      confirmationDocs: [
        { status: "present" },
        { status: "present" },
        { status: "present" },
        { status: "gone" },
        { status: "gone" },
        { status: "gone" },
      ],
      existingLikelyGoneSince: 500,
      nowMs: 2000,
    })
    assert.equal(patch.clearLikelyGoneSince, true)
    assert.equal(patch.likelyGoneSinceMs, null)
  })

  it("does not set since below threshold", () => {
    const since = nextLikelyGoneSinceMs({
      nextCounts: { presentCount: 0, goneCount: 2 },
      existingLikelyGoneSinceMs: null,
      nowMs: 1000,
    })
    assert.equal(since, null)
  })
})
