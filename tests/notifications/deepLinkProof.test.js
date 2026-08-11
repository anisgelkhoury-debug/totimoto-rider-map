/**
 * TRN 058L — deep-link exact-report selection proof helpers.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  evaluateDeepLinkReportSelection,
  reportIdPrefix,
} from "../../src/notifications/deepLinkProof.ts"
import {
  buildTrnDeepLink,
  parseTrnSearchParams,
} from "../../src/notifications/notificationPayload.ts"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "../..")

describe("058L deep-link exact report proof", () => {
  it("9. URL parser extracts exact reportId", () => {
    const parsed = parseTrnSearchParams(
      "?report=ExactReportId99&notification=nearby_accident"
    )
    assert.equal(parsed.reportId, "ExactReportId99")
    assert.equal(parsed.notificationType, "nearby_accident")
  })

  it("10. deep-link fetch selects requested report", () => {
    const result = evaluateDeepLinkReportSelection({
      requestedReportId: "ExactReportId99",
      reports: [
        { id: "other" },
        { id: "ExactReportId99", resolved: false },
      ],
    })
    assert.equal(result.found, true)
    assert.equal(result.selected, true)
    assert.equal(result.reason, "selected")
    assert.equal(reportIdPrefix("ExactReportId99"), "ExactReportI")
    assert.equal(reportIdPrefix("short"), "short")
  })

  it("11–12. missing / not-in-list fails safely; resolved still selectable like App", () => {
    assert.equal(
      evaluateDeepLinkReportSelection({
        requestedReportId: null,
        reports: [{ id: "a" }],
      }).reason,
      "missing_report_id"
    )
    assert.equal(
      evaluateDeepLinkReportSelection({
        requestedReportId: "gone",
        reports: [{ id: "a" }],
      }).reason,
      "report_not_in_list"
    )
    const resolved = evaluateDeepLinkReportSelection({
      requestedReportId: "r1",
      reports: [{ id: "r1", resolved: true }],
    })
    assert.equal(resolved.found, true)
    assert.equal(resolved.selected, true)
    assert.equal(resolved.reason, "report_resolved")
  })

  it("builds same URL shape as Functions nearby deep link", () => {
    const client = buildTrnDeepLink(
      { reportId: "abc", notificationType: "nearby_accident" },
      "https://app.totimoto.com"
    )
    assert.equal(
      client,
      "https://app.totimoto.com/?report=abc&notification=nearby_accident"
    )
  })

  it("App wires deep-link proof helper", () => {
    const app = readFileSync(join(ROOT, "src/App.tsx"), "utf8")
    assert.match(app, /evaluateDeepLinkReportSelection/)
    assert.match(app, /logDeepLinkSelectionProof/)
    assert.match(app, /TRN_NOTIFICATION_CLICK/)
  })
})
