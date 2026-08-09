/**
 * TRN 058E — client-side guardrail: nearby send gate stays OFF in Functions source.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

describe("058E nearby send gate guardrails", () => {
  it("42. existing assistance tests path untouched; send gate false in source", () => {
    const gate = readFileSync(
      join(root, "functions/src/nearby/sendGate.ts"),
      "utf8"
    )
    assert.match(
      gate,
      /ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND:\s*boolean\s*=\s*false/
    )
    const index = readFileSync(join(root, "functions/src/index.ts"), "utf8")
    assert.match(index, /onReportLifecycleUpdated/)
    assert.match(index, /onReportCreatedNearbyNotify/)
    assert.equal(index.includes("ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND"), true)
  })

  it("no production nearby send from client modules", () => {
    const app = readFileSync(join(root, "src/App.tsx"), "utf8")
    assert.equal(app.includes("onReportCreatedNearbyNotify"), false)
    assert.equal(app.includes("sendEachForMulticast"), false)
  })
})
