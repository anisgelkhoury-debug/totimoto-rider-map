import {
  CHROME,
  sheetBackdropStyle,
  sheetHandleStyle,
  sheetPanelStyle,
  sheetTitleStyle,
} from "./chromeStyles"
import { DUPLICATE_COPY } from "../../duplicateReports/duplicateConfig"
import type { DuplicateMatch } from "../../duplicateReports/duplicateReportIntelligence"

type DuplicateReportSheetProps = {
  open: boolean
  match: DuplicateMatch | null
  isOwnReport: boolean
  busy: boolean
  errorMessage: string | null
  onConfirmPresent: () => void
  onViewReport: () => void
  onCreateAnyway: () => void
  onClose: () => void
}

const primaryBtn = {
  width: "100%" as const,
  minHeight: 52,
  padding: "12px 14px",
  borderRadius: 16,
  border: "none" as const,
  fontWeight: 800 as const,
  fontSize: 16,
  fontFamily: "inherit" as const,
  cursor: "pointer" as const,
  WebkitTapHighlightColor: "transparent",
  touchAction: "manipulation" as const,
}

export default function DuplicateReportSheet({
  open,
  match,
  isOwnReport,
  busy,
  errorMessage,
  onConfirmPresent,
  onViewReport,
  onCreateAnyway,
  onClose,
}: DuplicateReportSheetProps) {
  if (!open || !match) return null

  const emoji =
    typeof match.report.emoji === "string" ? match.report.emoji : "⚠️"
  const typeLabel =
    typeof match.report.type === "string" ? match.report.type : "بلاغ"
  const meta = match.freshnessLabel
    ? `${match.distanceLabel} · ${match.freshnessLabel}`
    : match.distanceLabel

  return (
    <div
      style={sheetBackdropStyle}
      role="presentation"
      onClick={() => {
        if (!busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={DUPLICATE_COPY.title}
        style={sheetPanelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={sheetHandleStyle} aria-hidden />
        <h2 style={sheetTitleStyle}>{DUPLICATE_COPY.title}</h2>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            borderRadius: 16,
            border: "1px solid #e2e8f0",
            background: "#fff",
            marginBottom: 14,
            textAlign: "right",
          }}
        >
          <span aria-hidden style={{ fontSize: 28, lineHeight: 1 }}>
            {emoji}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span
              style={{
                display: "block",
                fontSize: 17,
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
            {isOwnReport ? (
              <span
                style={{
                  display: "block",
                  marginTop: 6,
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#0f766e",
                }}
              >
                {DUPLICATE_COPY.ownReport}
              </span>
            ) : null}
          </span>
        </div>

        {!isOwnReport ? (
          <button
            type="button"
            disabled={busy}
            onClick={onConfirmPresent}
            style={{
              ...primaryBtn,
              marginBottom: 10,
              background: "#16a34a",
              color: "#fff",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {DUPLICATE_COPY.confirmPresent}
          </button>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={onViewReport}
          style={{
            ...primaryBtn,
            marginBottom: 10,
            background: "#0f172a",
            color: "#fff",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {DUPLICATE_COPY.viewReport}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={onCreateAnyway}
          style={{
            ...primaryBtn,
            marginBottom: 8,
            background: "#f1f5f9",
            color: "#0f172a",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {DUPLICATE_COPY.createAnyway}
        </button>

        {errorMessage ? (
          <div
            role="status"
            style={{
              marginTop: 8,
              fontSize: 12,
              fontWeight: 700,
              color: "#b45309",
              textAlign: "center",
            }}
          >
            {errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  )
}
