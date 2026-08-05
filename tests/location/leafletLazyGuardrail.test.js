/**
 * Guardrail: default App entry must not statically import Leaflet.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("leaflet lazy-load guardrail", () => {
  it("App.tsx does not statically import leaflet packages", () => {
    const app = readFileSync(resolve("src/App.tsx"), "utf8")
    assert.equal(/from\s+["']react-leaflet["']/.test(app), false)
    assert.equal(/from\s+["']leaflet["']/.test(app), false)
    assert.equal(/leaflet\/dist\/leaflet\.css/.test(app), false)
    assert.match(app, /lazy\(\s*\(\)\s*=>\s*import\(["'].*LeafletMapView["']\)/)
  })
})
