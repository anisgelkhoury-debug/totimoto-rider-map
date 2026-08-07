import type { CSSProperties } from "react"

/** Shared visual tokens for premium map chrome (047B). */
export const CHROME = {
  bg: "rgba(15, 23, 42, 0.92)",
  bgSolid: "#0f172a",
  sheet: "#f8fafc",
  text: "#f8fafc",
  textDark: "#0f172a",
  textMuted: "#64748b",
  accent: "#c62828",
  border: "rgba(255,255,255,0.16)",
  shadow: "0 8px 24px rgba(0,0,0,0.35)",
  radiusBtn: 16,
  radiusSheet: 24,
  minTap: 48,
  fab: 60,
} as const

export const floatingControlStyle: CSSProperties = {
  minWidth: CHROME.minTap,
  minHeight: CHROME.minTap,
  padding: "0 12px",
  borderRadius: CHROME.radiusBtn,
  border: `1px solid ${CHROME.border}`,
  background: CHROME.bg,
  color: CHROME.text,
  fontWeight: 700,
  fontSize: 13,
  fontFamily: "inherit",
  cursor: "pointer",
  boxShadow: CHROME.shadow,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation",
  userSelect: "none",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
}

export const sheetBackdropStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 3200,
  background: "rgba(2, 6, 23, 0.55)",
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  padding: 0,
  direction: "rtl",
}

export const sheetPanelStyle: CSSProperties = {
  width: "100%",
  maxWidth: 480,
  maxHeight: "min(78vh, 640px)",
  overflowY: "auto",
  WebkitOverflowScrolling: "touch",
  background: CHROME.sheet,
  color: CHROME.textDark,
  borderTopLeftRadius: CHROME.radiusSheet,
  borderTopRightRadius: CHROME.radiusSheet,
  padding: "12px 16px calc(16px + env(safe-area-inset-bottom, 0px))",
  boxShadow: "0 -12px 40px rgba(0,0,0,0.28)",
  direction: "rtl",
  fontFamily: "inherit",
}

export const sheetHandleStyle: CSSProperties = {
  width: 40,
  height: 4,
  borderRadius: 999,
  background: "#cbd5e1",
  margin: "4px auto 14px",
}

export const sheetTitleStyle: CSSProperties = {
  margin: "0 0 16px",
  fontSize: 20,
  fontWeight: 800,
  textAlign: "center",
  color: CHROME.textDark,
}

export const sectionLabelStyle: CSSProperties = {
  margin: "0 0 8px",
  fontSize: 13,
  fontWeight: 700,
  color: CHROME.textMuted,
  textAlign: "right",
}
