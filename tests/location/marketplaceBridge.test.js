/**
 * Totimoto marketplace bridge — config and safety tests (no network).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  MARKETPLACE_BUY_URL,
  MARKETPLACE_COPY,
  MARKETPLACE_LINK_REL,
  MARKETPLACE_ORIGIN,
  MARKETPLACE_SELL_URL,
  marketplaceUrlFor,
  openMarketplaceDestination,
} from "../../src/marketplace/marketplaceBridge.ts"

describe("Totimoto marketplace bridge", () => {
  it("marketplace action Arabic labels are correct", () => {
    assert.equal(MARKETPLACE_COPY.sectionLabel, "الدراجات")
    assert.equal(MARKETPLACE_COPY.entryLabel, "أعرض أو اشتري دراجة")
    assert.equal(MARKETPLACE_COPY.sheetTitle, "الدراجات")
    assert.equal(MARKETPLACE_COPY.buyTitle, "شراء دراجة")
    assert.equal(MARKETPLACE_COPY.sellTitle, "بيع دراجتي")
    assert.ok(MARKETPLACE_COPY.buyHint.includes("Totimoto"))
    assert.ok(MARKETPLACE_COPY.sellHint.includes("Totimoto"))
  })

  it("buy URL comes from central config", () => {
    assert.equal(marketplaceUrlFor("buy"), MARKETPLACE_BUY_URL)
    assert.equal(MARKETPLACE_BUY_URL, `${MARKETPLACE_ORIGIN}/`)
    assert.ok(MARKETPLACE_BUY_URL.startsWith("https://www.totimoto.com"))
  })

  it("sell URL comes from central config with exact path", () => {
    assert.equal(marketplaceUrlFor("sell"), MARKETPLACE_SELL_URL)
    assert.equal(
      MARKETPLACE_SELL_URL,
      "https://www.totimoto.com/pages/list-sell-your-bike"
    )
  })

  it("external link uses safe rel behavior", () => {
    assert.equal(MARKETPLACE_LINK_REL, "noopener noreferrer")
    assert.ok(MARKETPLACE_LINK_REL.includes("noopener"))
    assert.ok(MARKETPLACE_LINK_REL.includes("noreferrer"))
  })

  it("openMarketplaceDestination uses blank+noopener without throwing", () => {
    const calls = []
    const original = globalThis.window
    globalThis.window = {
      open(url, target, features) {
        calls.push({ url, target, features })
        return { closed: false }
      },
    }
    try {
      assert.equal(openMarketplaceDestination("buy"), true)
      assert.equal(openMarketplaceDestination("sell"), true)
      assert.equal(calls.length, 2)
      assert.equal(calls[0].url, MARKETPLACE_BUY_URL)
      assert.equal(calls[0].target, "_blank")
      assert.ok(String(calls[0].features).includes("noopener"))
      assert.ok(String(calls[0].features).includes("noreferrer"))
      assert.equal(calls[1].url, MARKETPLACE_SELL_URL)
    } finally {
      if (original === undefined) delete globalThis.window
      else globalThis.window = original
    }
  })

  it("no marketplace report family or Firestore write surface", () => {
    const src = [
      MARKETPLACE_BUY_URL,
      MARKETPLACE_SELL_URL,
      MARKETPLACE_COPY.entryLabel,
    ].join(" ")
    assert.equal(src.includes("reportFamily"), false)
    assert.equal(src.includes("firestore"), false)
    assert.equal(src.includes("addDoc"), false)
    assert.equal(src.includes("notification"), false)
    assert.equal(src.includes("FCM"), false)
  })

  it("bridge is external-only (no map marker contract)", () => {
    assert.equal(MARKETPLACE_BUY_URL.includes("marker"), false)
    assert.equal(typeof marketplaceUrlFor("buy"), "string")
    assert.equal(typeof marketplaceUrlFor("sell"), "string")
  })
})
