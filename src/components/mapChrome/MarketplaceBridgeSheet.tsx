import {
  CHROME,
  sectionLabelStyle,
  sheetBackdropStyle,
  sheetHandleStyle,
  sheetPanelStyle,
  sheetTitleStyle,
} from "./chromeStyles"
import {
  MARKETPLACE_COPY,
  openMarketplaceDestination,
  type MarketplaceDestination,
} from "../../marketplace/marketplaceBridge"

type MarketplaceBridgeSheetProps = {
  open: boolean
  onClose: () => void
}

const actionBtnBase = {
  width: "100%",
  minHeight: 72,
  padding: "14px 16px",
  borderRadius: 18,
  border: "none",
  cursor: "pointer",
  fontFamily: "inherit",
  textAlign: "right" as const,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation" as const,
}

export default function MarketplaceBridgeSheet({
  open,
  onClose,
}: MarketplaceBridgeSheetProps) {
  if (!open) return null

  const openDest = (destination: MarketplaceDestination) => {
    openMarketplaceDestination(destination)
    onClose()
  }

  return (
    <div
      style={sheetBackdropStyle}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={MARKETPLACE_COPY.sheetTitle}
        style={sheetPanelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={sheetHandleStyle} aria-hidden />
        <h2 style={sheetTitleStyle}>{MARKETPLACE_COPY.sheetTitle}</h2>
        <p
          style={{
            margin: "0 0 18px",
            fontSize: 15,
            fontWeight: 700,
            color: CHROME.textMuted,
            textAlign: "center",
          }}
        >
          {MARKETPLACE_COPY.sheetPrompt}
        </p>

        <button
          type="button"
          aria-label={MARKETPLACE_COPY.buyTitle}
          onClick={() => openDest("buy")}
          style={{
            ...actionBtnBase,
            marginBottom: 12,
            background: "#0f766e",
            color: "#ecfdf5",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 17, displayBottom: 4 }}>
            🛒 {MARKETPLACE_COPY.buyTitle}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.92 }}>
            {MARKETPLACE_COPY.buyHint}
          </div>
        </button>

        <button
          type="button"
          aria-label={MARKETPLACE_COPY.sellTitle}
          onClick={() => openDest("sell")}
          style={{
            ...actionBtnBase,
            marginBottom: 16,
            background: "#1e3a8a",
            color: "#eff6ff",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
            🏷️ {MARKETPLACE_COPY.sellTitle}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.92 }}>
            {MARKETPLACE_COPY.sellHint}
          </div>
        </button>

        <p style={{ ...sectionLabelStyle, textAlign: "center", marginBottom: 14 }}>
          {MARKETPLACE_COPY.footer}
        </p>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            minHeight: CHROME.minTap,
            borderRadius: CHROME.radiusBtn,
            border: "none",
            background: "#e2e8f0",
            color: CHROME.textDark,
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          إغلاق
        </button>
      </div>
    </div>
  )
}
