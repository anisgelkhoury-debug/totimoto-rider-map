import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isLocalDevHostname } from "../../src/notifications/localDevHost.ts"

describe("mock background notification host gate", () => {
  it("allows only localhost variants", () => {
    assert.equal(isLocalDevHostname("localhost"), true)
    assert.equal(isLocalDevHostname("127.0.0.1"), true)
    assert.equal(isLocalDevHostname("[::1]"), true)
    assert.equal(isLocalDevHostname("app.totimoto.com"), false)
    assert.equal(isLocalDevHostname("totimoto-rider-network.web.app"), false)
  })
})
