/**
 * Live incident intelligence (حدث) tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  CAP_TIER,
  capMapReports,
  reportCapTier,
} from "../../src/utils/capMapReports.ts"
import {
  isReportExpired,
  normalizeLiveReports,
} from "../../src/utils/reportSnapshot.ts"
import { matchesReportTypeSearch } from "../../src/utils/roadIntelligenceTypes.ts"
import {
  INCIDENT_FAMILY,
  INCIDENT_REPORT_TYPES,
  assertValidIncidentType,
  buildIncidentCreateFields,
  getIncidentTypeByCategory,
  isIncidentReport,
  isKnownIncidentCategory,
  isSevereIncident,
  resolveIncidentExpiryMinutes,
  usesApproximateIncidentArea,
} from "../../src/utils/incidentTypes.ts"
import { isNotifiableReportFamily } from "../../functions/src/shared/report.ts"

describe("incident live intelligence", () => {
  it("family and subtypes are recognized", () => {
    assert.equal(INCIDENT_FAMILY, "incident")
    assert.equal(INCIDENT_REPORT_TYPES.length, 5)
    for (const t of INCIDENT_REPORT_TYPES) {
      assert.equal(t.reportFamily, "incident")
      assert.ok(isKnownIncidentCategory(t.reportCategory))
      assert.ok(isIncidentReport(t))
      assert.ok(assertValidIncidentType(t))
    }
  })

  it("maps each subtype slug and Arabic label", () => {
    const expected = {
      fire: "حريق",
      gunfire: "إطلاق نار",
      explosionStrike: "انفجار / غارة",
      collapseDanger: "انهيار / خطر كبير",
      otherIncident: "أخرى",
    }
    for (const [slug, label] of Object.entries(expected)) {
      const t = getIncidentTypeByCategory(slug)
      assert.ok(t)
      assert.equal(t.label, label)
    }
  })

  it("TTL mapping matches V1 hypothesis", () => {
    assert.equal(resolveIncidentExpiryMinutes("gunfire"), 30)
    assert.equal(resolveIncidentExpiryMinutes("fire"), 90)
    assert.equal(resolveIncidentExpiryMinutes("explosionStrike"), 90)
    assert.equal(resolveIncidentExpiryMinutes("collapseDanger"), 120)
    assert.equal(resolveIncidentExpiryMinutes("otherIncident"), 60)
    assert.equal(resolveIncidentExpiryMinutes("unknown", 60), 60)
  })

  it("create payload uses existing schema fields", () => {
    const fire = getIncidentTypeByCategory("fire")
    assert.ok(fire)
    const fields = buildIncidentCreateFields(fire)
    assert.deepEqual(fields, {
      type: "حريق",
      emoji: "🔥",
      color: "#b91c1c",
      expiry: 90,
      priority: "high",
      reportFamily: "incident",
      reportCategory: "fire",
    })
  })

  it("rejects unknown incident subtype", () => {
    assert.equal(isKnownIncidentCategory("meetup"), false)
    assert.equal(
      assertValidIncidentType({
        reportFamily: "incident",
        reportCategory: "meetup",
        label: "فعالية",
      }),
      false
    )
    assert.equal(
      assertValidIncidentType({
        reportFamily: "incident",
        reportCategory: "fire",
        label: "wrong",
      }),
      false
    )
  })

  it("expires and filters via snapshot normalize", () => {
    const now = Date.UTC(2026, 7, 7, 18, 0, 0)
    const liveGun = {
      createdAt: now - 10 * 60 * 1000,
      expiry: 30,
      resolved: false,
      reportFamily: "incident",
      reportCategory: "gunfire",
      type: "إطلاق نار",
    }
    const deadGun = {
      createdAt: now - 31 * 60 * 1000,
      expiry: 30,
      resolved: false,
      reportFamily: "incident",
      reportCategory: "gunfire",
      type: "إطلاق نار",
    }
    assert.equal(isReportExpired(liveGun, now), false)
    assert.equal(isReportExpired(deadGun, now), true)

    const docs = [
      {
        id: "live",
        data: () => ({ ...liveGun, lat: 33.9, lng: 35.5 }),
      },
      {
        id: "dead",
        data: () => ({ ...deadGun, lat: 33.9, lng: 35.5 }),
      },
      {
        id: "dup",
        data: () => ({ ...liveGun, lat: 33.9, lng: 35.5 }),
      },
    ]
    // second doc same id path — use unique ids; duplicate content different ids
    docs[2] = {
      id: "live",
      data: () => ({ ...liveGun, lat: 33.91, lng: 35.51 }),
    }
    const live = normalizeLiveReports(docs, now)
    assert.equal(live.length, 1)
    assert.equal(live[0].id, "live")
    assert.equal(live[0].type, "إطلاق نار")
  })

  it("list/filter matches حدث family and Arabic labels", () => {
    const fire = {
      type: "حريق",
      reportFamily: "incident",
      reportCategory: "fire",
    }
    assert.equal(matchesReportTypeSearch(fire, "حدث"), true)
    assert.equal(matchesReportTypeSearch(fire, "حريق"), true)
    assert.equal(matchesReportTypeSearch(fire, "زحمة"), false)
  })

  it("approximate area only for gunfire/explosion", () => {
    assert.equal(
      usesApproximateIncidentArea({ reportCategory: "gunfire", reportFamily: "incident" }),
      true
    )
    assert.equal(
      usesApproximateIncidentArea({
        reportCategory: "explosionStrike",
        reportFamily: "incident",
      }),
      true
    )
    assert.equal(
      usesApproximateIncidentArea({ reportCategory: "fire", reportFamily: "incident" }),
      false
    )
    assert.ok(isSevereIncident({ reportCategory: "gunfire" }))
  })

  it("map-cap priority: severe incident above stolen; selected/owned preserved", () => {
    const opts = { deviceId: "me", selectedId: "sel" }
    const gunfire = {
      id: "g1",
      ownerId: "x",
      reportFamily: "incident",
      reportCategory: "gunfire",
      type: "إطلاق نار",
      priority: "critical",
      lat: 33.9,
      lng: 35.5,
      createdAt: 5,
    }
    const stolen = {
      id: "s1",
      ownerId: "x",
      reportFamily: "stolen",
      type: "بلاغ عن دراجة مسروقة",
      lat: 33.9,
      lng: 35.5,
      createdAt: 6,
    }
    const selected = { ...gunfire, id: "sel", createdAt: 0 }
    const owned = {
      ...gunfire,
      id: "mine",
      ownerId: "me",
      reportCategory: "otherIncident",
      type: "أخرى",
    }

    assert.equal(reportCapTier(gunfire, opts), CAP_TIER.severeIncident)
    assert.equal(reportCapTier(stolen, { deviceId: "me", selectedId: null }), CAP_TIER.stolen)
    assert.ok(CAP_TIER.severeIncident < CAP_TIER.stolen)
    assert.equal(reportCapTier(selected, opts), CAP_TIER.selected)
    assert.equal(reportCapTier(owned, { deviceId: "me", selectedId: null }), CAP_TIER.owned)

    const far = { lat: 34.5, lng: 36.2 }
    const filler = Array.from({ length: 30 }, (_, i) => ({
      id: `ord-${i}`,
      ownerId: "z",
      reportFamily: "intelligence",
      priority: "low",
      ...far,
      createdAt: i,
    }))
    const out = capMapReports([...filler, gunfire, stolen, selected, owned], {
      cap: 5,
      deviceId: "me",
      selectedId: "sel",
      userLocation: [33.9, 35.5],
    })
    assert.ok(out.some((r) => r.id === "sel"))
    assert.ok(out.some((r) => r.id === "mine"))
    assert.equal(out.filter((r) => r.id === "g1").length <= 1, true)
  })

  it("notification lifecycle ignores incident family", () => {
    assert.equal(isNotifiableReportFamily("incident"), false)
    assert.equal(isNotifiableReportFamily("assistance"), true)
  })

  it("marker mapping fields exist for all subtypes", () => {
    for (const t of INCIDENT_REPORT_TYPES) {
      assert.ok(t.emoji.length > 0)
      assert.ok(t.color.startsWith("#"))
      assert.ok(t.label.length > 0)
    }
  })
})
