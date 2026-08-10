/**
 * TRN 058E/058H — nearby send gate + canary allowlist guardrails.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

describe("058E/H nearby send gate guardrails", () => {
  it("42. canary architecture present; production send gate FALSE after canary", () => {
    const gate = readFileSync(
      join(root, "functions/src/nearby/sendGate.ts"),
      "utf8"
    )
    assert.match(gate, /NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS/)
    assert.match(gate, /isNearbyCanaryRecipient/)
    assert.match(
      gate,
      /ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND:\s*boolean\s*=\s*false/
    )
    assert.match(gate, /new Set\(\[\]\)/)
    assert.doesNotMatch(gate, /AAAA[A-Za-z0-9_-]{100,}/)
    const index = readFileSync(join(root, "functions/src/index.ts"), "utf8")
    assert.match(index, /onReportLifecycleUpdated/)
    assert.match(index, /onReportCreatedNearbyNotify/)
    const process = readFileSync(
      join(root, "functions/src/nearby/processNearbyReport.ts"),
      "utf8"
    )
    assert.match(process, /filterNearbyCanaryRecipients/)
    assert.match(process, /no_canary_recipients/)
  })

  it("no production nearby send from client modules", () => {
    const app = readFileSync(join(root, "src/App.tsx"), "utf8")
    assert.equal(app.includes("onReportCreatedNearbyNotify"), false)
    assert.equal(app.includes("sendEachForMulticast"), false)
    assert.equal(
      app.includes("NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS"),
      false
    )
  })
})
