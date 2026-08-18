/**
 * TRN 058M — client-side safety locks for multi-device test controls.
 * Does not import Functions helper graphs (extensionless TS imports).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND } from "../../functions/src/nearby/sendGate.ts"
import { defaultNotificationPreferences } from "../../src/notifications/notificationPreferences.ts"
import { useBoundedReportQueriesEnabled } from "../../src/geo/featureFlag.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

describe("058M client safety", () => {
  it("production send gate remains false", () => {
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
    const gate = readFileSync(
      join(root, "functions/src/nearby/sendGate.ts"),
      "utf8"
    )
    assert.match(
      gate,
      /ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND:\s*boolean\s*=\s*false/
    )
    assert.match(gate, /new Set\(\[\]\)/)
  })

  it("nearbyAlerts default false; bounded queries default off", () => {
    assert.equal(defaultNotificationPreferences().nearbyAlerts, false)
    assert.equal(useBoundedReportQueriesEnabled({}), false)
    assert.equal(
      useBoundedReportQueriesEnabled({ VITE_USE_BOUNDED_REPORT_QUERIES: "" }),
      false
    )
  })

  it("synthetic fixture ids only; helper not wired into App", () => {
    const helper = readFileSync(
      join(root, "functions/src/nearby/multideviceTestControls.ts"),
      "utf8"
    )
    assert.match(helper, /trn058m-sub-a-reporter/)
    assert.match(helper, /tok-synth-058m-/)
    assert.equal(helper.includes("firebase deploy"), false)
    const app = readFileSync(join(root, "src/App.tsx"), "utf8")
    assert.equal(app.includes("multideviceTestControls"), false)
    assert.equal(app.includes("sendEachForMulticast"), false)
    const pkg = readFileSync(join(root, "package.json"), "utf8")
    assert.equal(pkg.toLowerCase().includes("leaflet"), false)
  })
})
