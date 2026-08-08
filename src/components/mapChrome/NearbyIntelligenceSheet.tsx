import {
  CHROME,
  sheetBackdropStyle,
  sheetHandleStyle,
  sheetPanelStyle,
  sheetTitleStyle,
} from "./chromeStyles"
import { NEARBY_COPY } from "../../nearby/nearbyConfig"
import {
  formatNearbyDistance,
  type NearbyCandidate,
} from "../../nearby/nearbyIntelligence"

type NearbyIntelligenceSheetProps = {
  open: boolean
  candidates: NearbyCandidate[]
  onClose: () => void
  onSelect: (candidate: NearbyCandidate) => void
}

export default function NearbyIntelligenceSheet({
  open,
  candidates,
  onClose,
  onSelect,
}: NearbyIntelligenceSheetProps) {
  if (!open) return null

  return (
    <div
      style={sheetBackdropStyle}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={NEARBY_COPY.sheetTitle}
        style={sheetPanelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={sheetHandleStyle} aria-hidden />
        <h2 style={sheetTitleStyle}>{NEARBY_COPY.sheetTitle}</h2>
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 14,
            fontWeight: 600,
            color: CHROME.textMuted,
            textAlign: "center",
          }}
        >
          {NEARBY_COPY.sheetHint}
        </p>

        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {candidates.map((c) => {
            const emoji =
              typeof c.report.emoji === "string" ? c.report.emoji : "⚠️"
            const typeLabel =
              typeof c.report.type === "string" ? c.report.type : "بلاغ"
            const dist = formatNearbyDistance(c.distanceMeters)
            const meta = c.freshnessLabel
              ? `${dist} · ${c.freshnessLabel}`
              : dist

            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 14px",
                    borderRadius: 16,
                    border: "1px solid #e2e8f0",
                    background: "#fff",
                    cursor: "pointer",
                    textAlign: "right",
                    fontFamily: "inherit",
                    WebkitTapHighlightColor: "transparent",
                    touchAction: "manipulation",
                    minHeight: 56,
                  }}
                >
                  <span
                    aria-hidden
                    style={{ fontSize: 26, lineHeight: 1, flexShrink: 0 }}
                  >
                    {emoji}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 16,
                        fontWeight: 800,
                        color: CHROME.textDark,
                      }}
                    >
                      {typeLabel}
                    </span>
                    <span
                      style={{
                        display: "block",
                        marginTop: 2,
                        fontSize: 13,
                        fontWeight: 600,
                        color: CHROME.textMuted,
                      }}
                    >
                      {meta}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
