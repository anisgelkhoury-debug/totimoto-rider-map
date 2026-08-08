/**
 * Trust + freshness layer — pure deterministic tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isReportExpired } from "../../src/utils/reportSnapshot.ts"
import {
  confirmationCreatesNotificationPath,
} from "../../src/reportConfirmations/reportConfirmations.ts"
import {
  FRESHNESS_LABELS,
  FRESHNESS_STATE,
  TRUST_LABELS,
  TRUST_STATE,
  freshnessLabelForState,
  resolveFreshnessState,
  resolveTrustState,
  trustLabelForState,
  trustLayerAutoHidesReports,
  trustLayerCreatesNotificationPath,
  trustLayerExtendsExpiry,
  trustStateForReport,
} from "../../src/reportConfirmations/reportTrust.ts"

function counts(presentCount, goneCount) {
  return {
    presentCount,
    goneCount,
    total: presentCount + goneCount,
  }
}

describe("report trust states", () => {
  it("default trust state", () => {
    assert.equal(resolveTrustState(counts(0, 0)), TRUST_STATE.default)
    assert.equal(trustLabelForState(TRUST_STATE.default), "بلاغ من دراج")
    assert.equal(TRUST_LABELS.default, "بلاغ من دراج")
  })

  it("confirmed threshold", () => {
    assert.equal(resolveTrustState(counts(3, 0)), TRUST_STATE.confirmed)
    assert.equal(
      trustLabelForState(TRUST_STATE.confirmed),
      "مؤكد من عدة دراجين"
    )
  })

  it("disputed threshold", () => {
    assert.equal(resolveTrustState(counts(2, 2)), TRUST_STATE.disputed)
    assert.equal(resolveTrustState(counts(3, 3)), TRUST_STATE.disputed)
    assert.equal(trustLabelForState(TRUST_STATE.disputed), "مختلف عليه")
  })

  it("likely-gone threshold", () => {
    assert.equal(resolveTrustState(counts(0, 3)), TRUST_STATE.likelyGone)
    assert.equal(
      trustLabelForState(TRUST_STATE.likelyGone),
      "يبدو أنه لم يعد موجوداً"
    )
  })

  it("single vote does not confirm", () => {
    assert.equal(resolveTrustState(counts(1, 0)), TRUST_STATE.default)
    assert.equal(resolveTrustState(counts(2, 0)), TRUST_STATE.default)
    assert.equal(resolveTrustState(counts(0, 1)), TRUST_STATE.default)
    assert.equal(resolveTrustState(counts(0, 2)), TRUST_STATE.default)
  })

  it("exact tie behavior", () => {
    assert.equal(resolveTrustState(counts(2, 2)), TRUST_STATE.disputed)
    assert.equal(resolveTrustState(counts(4, 4)), TRUST_STATE.disputed)
  })

  it("confirmed with gone votes", () => {
    // 4 present, 2 gone → present >= 3 and present >= 2*gone
    assert.equal(resolveTrustState(counts(4, 2)), TRUST_STATE.confirmed)
    assert.equal(resolveTrustState(counts(6, 3)), TRUST_STATE.confirmed)
  })

  it("likely-gone with present votes", () => {
    // 1 present, 3 gone → gone >= 3 and gone >= 2*present
    assert.equal(resolveTrustState(counts(1, 3)), TRUST_STATE.likelyGone)
    assert.equal(resolveTrustState(counts(2, 4)), TRUST_STATE.likelyGone)
  })
})

describe("report freshness states", () => {
  const ttl = 60
  const createdAt = 1_700_000_000_000

  it("freshness very fresh", () => {
    // 10% of 60m = 6m
    const now = createdAt + 6 * 60_000
    assert.equal(
      resolveFreshnessState({ createdAt, expiry: ttl, now }),
      FRESHNESS_STATE.veryFresh
    )
    assert.equal(
      freshnessLabelForState(FRESHNESS_STATE.veryFresh),
      "حديث جداً"
    )
  })

  it("freshness fresh", () => {
    // 40% of 60m = 24m
    const now = createdAt + 24 * 60_000
    assert.equal(
      resolveFreshnessState({ createdAt, expiry: ttl, now }),
      FRESHNESS_STATE.fresh
    )
    assert.equal(freshnessLabelForState(FRESHNESS_STATE.fresh), "حديث")
  })

  it("freshness aging", () => {
    // 70% of 60m = 42m
    const now = createdAt + 42 * 60_000
    assert.equal(
      resolveFreshnessState({ createdAt, expiry: ttl, now }),
      FRESHNESS_STATE.aging
    )
    assert.equal(
      freshnessLabelForState(FRESHNESS_STATE.aging),
      "قديم نسبياً"
    )
  })

  it("freshness expiring soon", () => {
    // 90% of 60m = 54m
    const now = createdAt + 54 * 60_000
    assert.equal(
      resolveFreshnessState({ createdAt, expiry: ttl, now }),
      FRESHNESS_STATE.expiringSoon
    )
    assert.equal(
      freshnessLabelForState(FRESHNESS_STATE.expiringSoon),
      "سينتهي قريباً"
    )
    assert.equal(FRESHNESS_LABELS.expiringSoon, "سينتهي قريباً")
  })

  it("report without TTL", () => {
    assert.equal(
      resolveFreshnessState({ createdAt, expiry: undefined }),
      null
    )
    assert.equal(resolveFreshnessState({ createdAt, expiry: 0 }), null)
    assert.equal(freshnessLabelForState(null), null)
  })

  it("expired report behavior unchanged", () => {
    const report = { createdAt, expiry: 30, resolved: false }
    const afterExpiry = createdAt + 31 * 60_000
    assert.equal(isReportExpired(report, afterExpiry), true)
    // Freshness may still compute a band; expiry filter remains authoritative.
    assert.equal(
      resolveFreshnessState({
        createdAt,
        expiry: 30,
        now: afterExpiry,
      }),
      FRESHNESS_STATE.expiringSoon
    )
    assert.equal(trustLayerAutoHidesReports(), false)
  })

  it("incident TTL freshness", () => {
    // Incident fire TTL = 90 minutes; 20% → veryFresh
    const now = createdAt + 18 * 60_000
    assert.equal(
      resolveFreshnessState({ createdAt, expiry: 90, now }),
      FRESHNESS_STATE.veryFresh
    )
    // 50% of 90 = 45m → fresh
    assert.equal(
      resolveFreshnessState({
        createdAt,
        expiry: 90,
        now: createdAt + 45 * 60_000,
      }),
      FRESHNESS_STATE.fresh
    )
  })

  it("checkpoint TTL freshness", () => {
    // حاجز TTL = 60 minutes; 80% → aging, 90% → expiringSoon
    assert.equal(
      resolveFreshnessState({
        createdAt,
        expiry: 60,
        now: createdAt + 48 * 60_000,
      }),
      FRESHNESS_STATE.aging
    )
    assert.equal(
      resolveFreshnessState({
        createdAt,
        expiry: 60,
        now: createdAt + 54 * 60_000,
      }),
      FRESHNESS_STATE.expiringSoon
    )
  })
})

describe("report trust eligibility and safety", () => {
  it("no assistance trust state", () => {
    assert.equal(
      trustStateForReport(
        { reportFamily: "assistance", type: "عطل بالدراجة" },
        counts(5, 0)
      ),
      null
    )
  })

  it("no stolen trust state", () => {
    assert.equal(
      trustStateForReport(
        { reportFamily: "stolen", type: "بلاغ عن دراجة مسروقة" },
        counts(5, 0)
      ),
      null
    )
  })

  it("no sharedRide trust state", () => {
    assert.equal(
      trustStateForReport(
        { reportFamily: "sharedRide", type: "وصلني معك" },
        counts(5, 0)
      ),
      null
    )
  })

  it("no notification effect", () => {
    assert.equal(trustLayerCreatesNotificationPath(), false)
    assert.equal(confirmationCreatesNotificationPath(), false)
    assert.equal(trustLayerExtendsExpiry(), false)
  })
})
