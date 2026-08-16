/**
 * TRN — Settings sheet mobile viewport layout (pure styles/helpers).
 * Keeps إغلاق reachable on iPhone PWA without changing notification logic.
 */

import type { CSSProperties } from "react"

/** Outer backdrop — full viewport, safe-area aware padding. */
export const SETTINGS_SHEET_BACKDROP_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.55)",
  zIndex: 999999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  paddingTop: "max(12px, env(safe-area-inset-top, 0px))",
  paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))",
  paddingLeft: "max(12px, env(safe-area-inset-left, 0px))",
  paddingRight: "max(12px, env(safe-area-inset-right, 0px))",
  boxSizing: "border-box",
  direction: "rtl",
}

/**
 * Modal panel — capped to dynamic viewport; column flex so body scrolls
 * and footer stays visible. Desktop keeps maxWidth; mobile uses near-full height.
 */
export const SETTINGS_SHEET_PANEL_STYLE: CSSProperties = {
  background: "white",
  width: "100%",
  maxWidth: 420,
  borderRadius: 24,
  textAlign: "center",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  boxSizing: "border-box",
  // Prefer dvh; 94vh fallback for older engines. Safe-area handled by backdrop padding.
  maxHeight: "min(94vh, calc(100dvh - 24px))",
  minHeight: 0,
}

export const SETTINGS_SHEET_HEADER_STYLE: CSSProperties = {
  position: "relative",
  flexShrink: 0,
  padding: "18px 22px 8px",
  boxSizing: "border-box",
}

export const SETTINGS_SHEET_TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 800,
  textAlign: "center",
}

/** Secondary top close (×) — does not replace bottom إغلاق. */
export const SETTINGS_SHEET_TOP_CLOSE_STYLE: CSSProperties = {
  position: "absolute",
  top: 10,
  left: 10,
  width: 44,
  height: 44,
  borderRadius: 12,
  border: "none",
  background: "#f1f5f9",
  color: "#0f172a",
  fontSize: 26,
  lineHeight: "44px",
  fontWeight: 700,
  cursor: "pointer",
  padding: 0,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
}

/** Scrollable middle — notification panel + menu rows. */
export const SETTINGS_SHEET_BODY_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overflowX: "hidden",
  WebkitOverflowScrolling: "touch",
  overscrollBehavior: "contain",
  padding: "4px 22px 12px",
  boxSizing: "border-box",
  textAlign: "center",
}

/**
 * Persistent footer — stays at bottom of the capped panel (not page-fixed).
 * Extra bottom padding for home indicator when panel sits near the bottom.
 */
export const SETTINGS_SHEET_FOOTER_STYLE: CSSProperties = {
  flexShrink: 0,
  position: "sticky",
  bottom: 0,
  background: "white",
  borderTop: "1px solid #e2e8f0",
  paddingTop: 12,
  paddingLeft: 22,
  paddingRight: 22,
  paddingBottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
  boxSizing: "border-box",
  boxShadow: "0 -6px 16px rgba(15, 23, 42, 0.06)",
}

export const SETTINGS_SHEET_CLOSE_BUTTON_STYLE: CSSProperties = {
  width: "100%",
  minHeight: 48,
  padding: 14,
  borderRadius: 16,
  border: "none",
  background: "#e5e7eb",
  fontWeight: "bold",
  fontSize: 16,
  cursor: "pointer",
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
}

/** Pure checks for layout contracts (unit tests). */
export function settingsSheetUsesViewportCap(
  panel: CSSProperties = SETTINGS_SHEET_PANEL_STYLE
): boolean {
  const maxHeight = String(panel.maxHeight ?? "")
  return (
    maxHeight.includes("100dvh") ||
    maxHeight.includes("vh") ||
    maxHeight.includes("dvh")
  )
}

export function settingsSheetBodyIsScrollable(
  body: CSSProperties = SETTINGS_SHEET_BODY_STYLE
): boolean {
  return body.overflowY === "auto" || body.overflowY === "scroll"
}

export function settingsSheetFooterIsPersistent(
  footer: CSSProperties = SETTINGS_SHEET_FOOTER_STYLE
): boolean {
  return (
    footer.position === "sticky" ||
    footer.flexShrink === 0 ||
    footer.position === "relative"
  )
}

export function settingsSheetAccountsForSafeAreaBottom(
  footer: CSSProperties = SETTINGS_SHEET_FOOTER_STYLE
): boolean {
  const pad = String(footer.paddingBottom ?? "")
  return pad.includes("safe-area-inset-bottom")
}
