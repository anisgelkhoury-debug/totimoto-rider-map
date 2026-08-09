/**
 * TRN 057C — firestore.indexes.json preparation for future geo queries.
 * Pure validation — no network / no deploy.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  ASSISTANCE_GEO_INDEX_DECISION,
  EXPIRES_AT_QUERY_DECISION,
  PLANNED_GEO_RANGE_QUERY,
  PLANNED_OWNER_UNRESOLVED_QUERY,
  STOLEN_INDEX_DECISION,
  plannedGeoIndexDefinitions,
} from "../../src/geo/plannedQueries.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const indexesPath = resolve(__dirname, "../../firestore.indexes.json")
const indexesJson = JSON.parse(readFileSync(indexesPath, "utf8"))

function indexKey(idx) {
  const fields = (idx.fields || [])
    .map((f) => `${f.fieldPath}:${f.order || f.arrayConfig || ""}`)
    .join("|")
  return `${idx.collectionGroup}|${idx.queryScope}|${fields}`
}

describe("firestore.indexes.json geo preparation", () => {
  it("parses and has indexes array", () => {
    assert.ok(Array.isArray(indexesJson.indexes))
    assert.ok(Array.isArray(indexesJson.fieldOverrides))
  })

  it("preserves notification subscription indexes", () => {
    const notif = indexesJson.indexes.filter(
      (i) => i.collectionGroup === "notificationSubscriptions"
    )
    // Lifecycle prefs (2) + 058D enabled+locationGeohash (1)
    assert.equal(notif.length, 3)
    assert.ok(
      notif.some((i) =>
        i.fields.some(
          (f) => f.fieldPath === "notificationPreferences.helperLifecycle"
        )
      )
    )
    assert.ok(
      notif.some((i) =>
        i.fields.some(
          (f) => f.fieldPath === "notificationPreferences.ownerLifecycle"
        )
      )
    )
    assert.ok(
      notif.some(
        (i) =>
          i.fields?.length === 2 &&
          i.fields[0].fieldPath === "enabled" &&
          i.fields[1].fieldPath === "locationGeohash"
      )
    )
  })

  it("no duplicate index definitions", () => {
    const keys = indexesJson.indexes.map(indexKey)
    assert.equal(keys.length, new Set(keys).size)
  })

  it("generic geo index resolved + geohash present", () => {
    const geo = indexesJson.indexes.find(
      (i) =>
        i.collectionGroup === "reports" &&
        i.fields?.length === 2 &&
        i.fields[0].fieldPath === "resolved" &&
        i.fields[0].order === "ASCENDING" &&
        i.fields[1].fieldPath === "geohash" &&
        i.fields[1].order === "ASCENDING"
    )
    assert.ok(geo, "missing resolved+geohash composite")
    assert.deepEqual(
      PLANNED_GEO_RANGE_QUERY.indexFields.map((f) => f.fieldPath),
      ["resolved", "geohash"]
    )
  })

  it("owner unresolved index present", () => {
    const owner = indexesJson.indexes.find(
      (i) =>
        i.collectionGroup === "reports" &&
        i.fields?.length === 3 &&
        i.fields[0].fieldPath === "ownerUid" &&
        i.fields[1].fieldPath === "resolved" &&
        i.fields[2].fieldPath === "createdAt" &&
        i.fields[2].order === "DESCENDING"
    )
    assert.ok(owner, "missing ownerUid+resolved+createdAt composite")
    assert.deepEqual(
      PLANNED_OWNER_UNRESOLVED_QUERY.indexFields.map((f) => f.fieldPath),
      ["ownerUid", "resolved", "createdAt"]
    )
  })

  it("exactly two new report indexes (no combinatorial explosion)", () => {
    const reports = indexesJson.indexes.filter(
      (i) => i.collectionGroup === "reports"
    )
    assert.equal(reports.length, 2)
    assert.equal(plannedGeoIndexDefinitions().length, 2)
  })

  it("no speculative expiresAt+geohash composite", () => {
    const bad = indexesJson.indexes.some((i) => {
      const paths = (i.fields || []).map((f) => f.fieldPath)
      return paths.includes("geohash") && paths.includes("expiresAt")
    })
    assert.equal(bad, false)
  })

  it("no speculative stolen/family geo composite", () => {
    const familyGeo = indexesJson.indexes.some((i) => {
      const paths = (i.fields || []).map((f) => f.fieldPath)
      return paths.includes("reportFamily") && paths.includes("geohash")
    })
    assert.equal(familyGeo, false)
    assert.equal(STOLEN_INDEX_DECISION.addIndexNow, false)
    assert.equal(ASSISTANCE_GEO_INDEX_DECISION.separateIndex, false)
  })

  it("expiresAt query decision is client-filter after geo", () => {
    assert.equal(EXPIRES_AT_QUERY_DECISION.code, "B")
    assert.equal(EXPIRES_AT_QUERY_DECISION.choice, "clientFilterAfterGeoQuery")
  })
})
