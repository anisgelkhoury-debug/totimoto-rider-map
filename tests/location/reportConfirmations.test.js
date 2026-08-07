/**
 * Community report confirmations — eligibility, counts, trust, vote identity.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  COMMUNITY_TRUST_MIN_PRESENT,
  CONFIRMATION_COPY,
  CONFIRMATION_STATUS,
  canUserCastConfirmation,
  confirmationChangesExpiry,
  confirmationCreatesNotificationPath,
  confirmationTouchesOwnership,
  countConfirmations,
  formatConfirmationSummary,
  isConfirmationEligibleReport,
  isReportOwnerForConfirmation,
  isValidConfirmationStatus,
  meetsCommunityTrustThreshold,
  trustLabelForCounts,
  upsertConfirmationInList,
} from "../../src/reportConfirmations/reportConfirmations.ts"

describe("report confirmations — eligibility", () => {
  it("eligible road report can be confirmed", () => {
    assert.equal(
      isConfirmationEligibleReport({
        type: "زحمة",
        reportFamily: "intelligence",
        reportCategory: "traffic",
      }),
      true
    )
    assert.equal(
      isConfirmationEligibleReport({
        type: "حاجز",
        reportFamily: "intelligence",
        reportCategory: "checkpoint",
      }),
      true
    )
  })

  it("eligible incident can be confirmed", () => {
    assert.equal(
      isConfirmationEligibleReport({
        type: "حريق",
        reportFamily: "incident",
        reportCategory: "fire",
      }),
      true
    )
  })

  it("assistance cannot be confirmed", () => {
    assert.equal(
      isConfirmationEligibleReport({
        type: "عطل بالدراجة",
        reportFamily: "assistance",
        reportCategory: "bike_broken",
      }),
      false
    )
  })

  it("sharedRide cannot be confirmed", () => {
    assert.equal(
      isConfirmationEligibleReport({
        type: "وصلني معك",
        reportFamily: "sharedRide",
        reportCategory: "ride",
      }),
      false
    )
  })

  it("stolen cannot be confirmed", () => {
    assert.equal(
      isConfirmationEligibleReport({
        type: "بلاغ عن دراجة مسروقة",
        reportFamily: "stolen",
        reportCategory: "stolen",
      }),
      false
    )
    assert.equal(
      isConfirmationEligibleReport({
        type: "مسروقة",
        reportFamily: "intelligence",
      }),
      false
    )
  })
})

describe("report confirmations — status and identity", () => {
  it("present status accepted", () => {
    assert.equal(isValidConfirmationStatus("present"), true)
    assert.equal(CONFIRMATION_STATUS.present, "present")
  })

  it("gone status accepted", () => {
    assert.equal(isValidConfirmationStatus("gone"), true)
    assert.equal(CONFIRMATION_STATUS.gone, "gone")
  })

  it("invalid status rejected", () => {
    assert.equal(isValidConfirmationStatus("like"), false)
    assert.equal(isValidConfirmationStatus(""), false)
    assert.equal(isValidConfirmationStatus(null), false)
    assert.equal(isValidConfirmationStatus(1), false)
  })

  it("one UID = one confirmation doc via upsert list", () => {
    let list = []
    list = upsertConfirmationInList(list, "uid-a", "present")
    list = upsertConfirmationInList(list, "uid-a", "gone")
    assert.equal(list.length, 1)
    assert.equal(list[0].id, "uid-a")
    assert.equal(list[0].status, "gone")
  })

  it("no duplicate vote docs when second uid votes", () => {
    let list = upsertConfirmationInList([], "uid-a", "present")
    list = upsertConfirmationInList(list, "uid-b", "present")
    list = upsertConfirmationInList(list, "uid-a", "present")
    assert.equal(list.length, 2)
    assert.equal(list.filter((d) => d.id === "uid-a").length, 1)
  })

  it("owner excluded from community vote", () => {
    const report = {
      type: "زحمة",
      reportFamily: "intelligence",
      ownerUid: "owner-1",
    }
    assert.equal(isReportOwnerForConfirmation(report, "owner-1"), true)
    assert.equal(
      canUserCastConfirmation({ report, currentUid: "owner-1" }),
      false
    )
    assert.equal(
      canUserCastConfirmation({ report, currentUid: "rider-2" }),
      true
    )
  })

  it("selected report vote state: non-owner can vote when eligible", () => {
    assert.equal(
      canUserCastConfirmation({
        report: {
          type: "حادث",
          reportFamily: "intelligence",
          ownerUid: "someone-else",
        },
        currentUid: "me",
      }),
      true
    )
  })

  it("user may update own vote in list (counts update)", () => {
    let list = [
      { id: "a", status: "present" },
      { id: "b", status: "present" },
    ]
    list = upsertConfirmationInList(list, "a", "gone")
    const counts = countConfirmations(list)
    assert.equal(counts.presentCount, 1)
    assert.equal(counts.goneCount, 1)
  })
})

describe("report confirmations — counts and trust", () => {
  it("counts computed correctly", () => {
    const counts = countConfirmations([
      { status: "present" },
      { status: "present" },
      { status: "gone" },
      { status: "invalid" },
    ])
    assert.equal(counts.presentCount, 2)
    assert.equal(counts.goneCount, 1)
    assert.equal(counts.total, 3)
  })

  it("zero confirmations", () => {
    const counts = countConfirmations([])
    assert.equal(counts.presentCount, 0)
    assert.equal(counts.goneCount, 0)
    assert.equal(meetsCommunityTrustThreshold(counts), false)
    assert.equal(trustLabelForCounts(counts), CONFIRMATION_COPY.trustDefault)
  })

  it("mixed confirmations", () => {
    const counts = countConfirmations([
      { status: "present" },
      { status: "gone" },
      { status: "gone" },
    ])
    assert.equal(counts.presentCount, 1)
    assert.equal(counts.goneCount, 2)
    assert.equal(meetsCommunityTrustThreshold(counts), false)
  })

  it("trust threshold logic", () => {
    assert.equal(COMMUNITY_TRUST_MIN_PRESENT, 3)
    assert.equal(
      meetsCommunityTrustThreshold({
        presentCount: 3,
        goneCount: 0,
        total: 3,
      }),
      true
    )
    assert.equal(
      meetsCommunityTrustThreshold({
        presentCount: 3,
        goneCount: 2,
        total: 5,
      }),
      false
    )
    assert.equal(
      meetsCommunityTrustThreshold({
        presentCount: 4,
        goneCount: 2,
        total: 6,
      }),
      true
    )
    assert.equal(
      meetsCommunityTrustThreshold({
        presentCount: 2,
        goneCount: 0,
        total: 2,
      }),
      false
    )
    assert.equal(
      trustLabelForCounts({ presentCount: 3, goneCount: 0, total: 3 }),
      CONFIRMATION_COPY.trustCommunity
    )
  })

  it("summary format is readable Arabic", () => {
    assert.equal(
      formatConfirmationSummary({
        presentCount: 12,
        goneCount: 3,
        total: 15,
      }),
      "لسا موجود 12 · مش موجود 3"
    )
    assert.equal(CONFIRMATION_COPY.prompt, "هل ما زال موجوداً؟")
    assert.equal(CONFIRMATION_COPY.present, "لسا موجود")
    assert.equal(CONFIRMATION_COPY.gone, "مش موجود")
  })
})

describe("report confirmations — safety invariants", () => {
  it("report expiry unchanged by confirmation module", () => {
    assert.equal(confirmationChangesExpiry(), false)
  })

  it("confirmation does not create notification path", () => {
    assert.equal(confirmationCreatesNotificationPath(), false)
  })

  it("confirmation does not modify report ownership", () => {
    assert.equal(confirmationTouchesOwnership(), false)
  })
})
