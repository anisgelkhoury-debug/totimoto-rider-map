/**
 * TRN — Settings sheet viewport layout contracts (mobile + desktop).
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  SETTINGS_SHEET_BACKDROP_STYLE,
  SETTINGS_SHEET_PANEL_STYLE,
  SETTINGS_SHEET_HEADER_STYLE,
  SETTINGS_SHEET_BODY_STYLE,
  SETTINGS_SHEET_FOOTER_STYLE,
  SETTINGS_SHEET_CLOSE_BUTTON_STYLE,
  SETTINGS_SHEET_TOP_CLOSE_STYLE,
  settingsSheetUsesViewportCap,
  settingsSheetBodyIsScrollable,
  settingsSheetFooterIsPersistent,
  settingsSheetAccountsForSafeAreaBottom,
  settingsSheetBackdropIsViewportBound,
  settingsSheetPanelCappedToContainingBlock,
  layoutSettingsSheetInViewport,
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

  it("9. desktop short viewport keeps footer reachable", () => {
    const layout = layoutSettingsSheetInViewport({
      viewportHeight: 720,
      paddingTop: 12,
      paddingBottom: 12,
      headerHeight: 64,
      footerHeight: 90,
      bodyContentHeight: 1600,
    })
    assert.equal(layout.footerReachable, true)
    assert.equal(layout.headerVisible, true)
    assert.ok(layout.footerBottom <= 720)
    assert.ok(layout.footerTop >= 0)
  })

  it("10. desktop body scrolls internally when content is taller than the panel", () => {
    const layout = layoutSettingsSheetInViewport({
      viewportHeight: 720,
      paddingTop: 12,
      paddingBottom: 12,
      headerHeight: 64,
      footerHeight: 90,
      bodyContentHeight: 1600,
    })
    assert.equal(layout.bodyScrolls, true)
    assert.ok(layout.bodyHeight < 1600)
    assert.equal(SETTINGS_SHEET_BODY_STYLE.overflowY, "auto")
    assert.equal(SETTINGS_SHEET_BODY_STYLE.minHeight, 0)
    assert.equal(SETTINGS_SHEET_HEADER_STYLE.flexShrink, 0)
    assert.equal(SETTINGS_SHEET_FOOTER_STYLE.flexShrink, 0)
  })

  it("11. panel cannot exceed the browser viewport", () => {
    const layout = layoutSettingsSheetInViewport({
      viewportHeight: 640,
      paddingTop: 12,
      paddingBottom: 12,
      headerHeight: 64,
      footerHeight: 90,
      bodyContentHeight: 2400,
    })
    assert.equal(layout.panelExceedsViewport, false)
    assert.ok(layout.panelHeight <= 640)
    assert.ok(layout.panelHeight <= layout.innerHeight)
    assert.equal(settingsSheetBackdropIsViewportBound(), true)
    assert.equal(settingsSheetPanelCappedToContainingBlock(), true)
    assert.match(String(SETTINGS_SHEET_PANEL_STYLE.maxHeight), /100%/)
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.flexShrink, 1)
    assert.equal(SETTINGS_SHEET_BACKDROP_STYLE.overflow, "hidden")
  })

  it("12. mobile contracts remain unchanged", () => {
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.maxWidth, 420)
    assert.equal(SETTINGS_SHEET_PANEL_STYLE.borderRadius, 24)
    assert.equal(SETTINGS_SHEET_HEADER_STYLE.flexShrink, 0)
    assert.equal(SETTINGS_SHEET_BODY_STYLE.flex, 1)
    assert.equal(SETTINGS_SHEET_BODY_STYLE.minHeight, 0)
    assert.equal(SETTINGS_SHEET_BODY_STYLE.overflowY, "auto")
    assert.equal(SETTINGS_SHEET_BODY_STYLE.WebkitOverflowScrolling, "touch")
    assert.equal(SETTINGS_SHEET_FOOTER_STYLE.flexShrink, 0)
    assert.equal(settingsSheetAccountsForSafeAreaBottom(), true)
    assert.match(
      String(SETTINGS_SHEET_BACKDROP_STYLE.paddingTop),
      /safe-area-inset-top/
    )
    assert.match(
      String(SETTINGS_SHEET_BACKDROP_STYLE.paddingBottom),
      /safe-area-inset-bottom/
    )
    assert.equal(SETTINGS_SHEET_BACKDROP_STYLE.justifyContent, "center")
    assert.equal(SETTINGS_SHEET_BACKDROP_STYLE.alignItems, "center")
  })

  it("13. short content still shrink-wraps (desktop card is not forced full-bleed height)", () => {
    const layout = layoutSettingsSheetInViewport({
      viewportHeight: 900,
      paddingTop: 12,
      paddingBottom: 12,
      headerHeight: 64,
      footerHeight: 90,
      bodyContentHeight: 200,
    })
    assert.equal(layout.bodyScrolls, false)
    assert.equal(layout.panelHeight, 64 + 200 + 90)
    assert.ok(layout.panelHeight < layout.innerHeight)
    assert.equal(layout.footerReachable, true)
  })
})
