import type { CSSProperties } from "react"
import { CHROME, floatingControlStyle } from "./chromeStyles"

type MapChromeControlsProps = {
  visible: boolean
  onOpenLayers: () => void
  onLocate: () => void
  onOpenList: () => void
  onOpenAction: () => void
  onOpenSettings: () => void
}

const stackStyle: CSSProperties = {
  position: "fixed",
  zIndex: 3000,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  pointerEvents: "none",
}

const bottomBarStyle: CSSProperties = {
  position: "fixed",
  left: 12,
  right: 12,
  bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
  zIndex: 3000,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  pointerEvents: "none",
  direction: "rtl",
}

const interactive: CSSProperties = { pointerEvents: "auto" }

export default function MapChromeControls({
  visible,
  onOpenLayers,
  onLocate,
  onOpenList,
  onOpenAction,
  onOpenSettings,
}: MapChromeControlsProps) {
  if (!visible) return null

  return (
    <>
      {/* Top-left stack: clear of Google Maps zoom (right). */}
      <div
        style={{
          ...stackStyle,
          top: "calc(14px + env(safe-area-inset-top, 0px))",
          left: 12,
        }}
      >
        <button
          type="button"
          aria-label="طبقات الخريطة"
          onClick={onOpenLayers}
          style={{ ...floatingControlStyle, ...interactive }}
        >
          طبقات
        </button>
        <button
          type="button"
          aria-label="موقعي على الخريطة"
          onClick={onLocate}
          style={{ ...floatingControlStyle, ...interactive }}
        >
          موقعي
        </button>
      </div>

      <div style={bottomBarStyle}>
        <button
          type="button"
          aria-label="قائمة البلاغات"
          onClick={onOpenList}
          style={{
            ...floatingControlStyle,
            ...interactive,
            flex: "0 0 auto",
            minWidth: 72,
          }}
        >
          قائمة
        </button>

        <button
          type="button"
          aria-label="إضافة بلاغ"
          onClick={onOpenAction}
          style={{
            ...interactive,
            width: CHROME.fab,
            height: CHROME.fab,
            borderRadius: 999,
            border: "none",
            background: CHROME.accent,
            color: "#ffffff",
            fontSize: 32,
            fontWeight: 300,
            lineHeight: 1,
            cursor: "pointer",
            boxShadow: "0 10px 28px rgba(198,40,40,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            WebkitTapHighlightColor: "transparent",
            touchAction: "manipulation",
            flex: "0 0 auto",
          }}
        >
          <span aria-hidden>＋</span>
        </button>

        <button
          type="button"
          aria-label="الإعدادات"
          onClick={onOpenSettings}
          style={{
            ...floatingControlStyle,
            ...interactive,
            flex: "0 0 auto",
            minWidth: 72,
          }}
        >
          إعدادات
        </button>
      </div>
    </>
  )
}
