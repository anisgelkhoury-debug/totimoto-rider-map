/**
 * TRN — Settings sheet mobile viewport layout contracts.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  SETTINGS_SHEET_BACKDROP_STYLE,
  SETTINGS_SHEET_PANEL_STYLE,
  SETTINGS_SHEET_BODY_STYLE,
  SETTINGS_SHEET_FOOTER_STYLE,
  SETTINGS_SHEET_CLOSE_BUTTON_STYLE,
  SETTINGS_SHEET_TOP_CLOSE_STYLE,
  settingsSheetUsesViewportCap,
  settingsSheetBodyIsScrollable,
  settingsSheetFooterIsPersistent,
  settingsSheetAccountsForSafeAreaBottom,
} from "../../src/ui/settingsSheetLayout.ts"
import { ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND } from "../../functions/src/nearby/sendGate.ts"

describe("settings sheet layout", () => {
  it("1. panel has viewport max-height (dvh/vh)", () => {
    assert.equal(settingsSheetUsesViewportCap(), true)
    assert.match(String(SETTINGS_SHEET_PANEL_STYLE.maxHeight), /100dvh|vh/)
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.overflow, "hidden")
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.display, "flex")
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.flexDirection, "column")
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.maxWidth, 420)
  })

  it("2. content area is independently scrollable", () => {
    assert.equal(settingsSheetBodyIsScrollable(), true)
    assert.equal(SETTINGS_SHEET_BODY_STYLE.WebkitOverflowScrolling, "touch")
    assert.equal(SETTINGS_SHEET_BODY_STYLE.minHeight, 0)
    assert.equal(SETTINGS_SHEET_BODY_STYLE.flex, 1)
  })

  it("3. footer is sticky/persistent inside modal", () => {
    assert.equal(settingsSheetFooterIsPersistent(), true)
    assert.equal(SETTINGS_SHEET_FOOTER_STYLE.position, "sticky")
    assert.equal(SETTINGS_SHEET_FOOTER_STYLE.flexShrink, 0)
    assert.equal(SETTINGS_SHEET_FOOTER_STYLE.background, "white")
  })

  it("4. close button styles always render with adequate tap height", () => {
    assert.ok((SETTINGS_SHEET_CLOSE_BUTTON_STYLE.minHeight ?? 0) >= 48)
    assert.equal(SETTINGS_SHEET_CLOSE_BUTTON_STYLE.width, "100%")
  })

  it("5. secondary top close is present but separate from bottom close", () => {
    assert.ok((SETTINGS_SHEET_TOP_CLOSE_STYLE.width ?? 0) >= 44)
    assert.ok((SETTINGS_SHEET_TOP_CLOSE_STYLE.height ?? 0) >= 44)
  })

  it("6. safe-area bottom accounted for on footer and backdrop", () => {
    assert.equal(settingsSheetAccountsForSafeAreaBottom(), true)
    assert.match(
      String(SETTINGS_SHEET_BACKDROP_STYLE.paddingBottom),
      /safe-area-inset-bottom/
    )
  })

  it("7. desktop max-width preserved (not forced full-bleed)", () => {
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.maxWidth, 420)
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.width, "100%")
  })

  it("8. send gate unchanged by this UI fix", () => {
    assert.equal(ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND, false)
  })
})
