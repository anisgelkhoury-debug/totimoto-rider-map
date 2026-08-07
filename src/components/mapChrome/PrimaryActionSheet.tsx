import { useState } from "react"
import {
  CHROME,
  sectionLabelStyle,
  sheetBackdropStyle,
  sheetHandleStyle,
  sheetPanelStyle,
  sheetTitleStyle,
} from "./chromeStyles"

export type ActionReportType = {
  label: string
  emoji: string
  color: string
  expiry: number
  priority: string
  reportFamily: string
  reportCategory: string
}

type PrimaryActionSheetProps = {
  open: boolean
  roadTypes: ActionReportType[]
  helpTypes: ActionReportType[]
  incidentTypes: ActionReportType[]
  stolenType: ActionReportType | null
  onSelectType: (type: ActionReportType) => void
  onClose: () => void
}

function TypeButton({
  type,
  onSelect,
}: {
  type: ActionReportType
  onSelect: (type: ActionReportType) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(type)}
      style={{
        minHeight: 56,
        padding: "12px 10px",
        borderRadius: 18,
        border: "none",
        background: type.color,
        color: "white",
        fontWeight: 700,
        fontSize: 15,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        WebkitTapHighlightColor: "transparent",
        touchAction: "manipulation",
      }}
    >
      <span style={{ fontSize: 22 }} aria-hidden>
        {type.emoji}
      </span>
      <span>{type.label}</span>
    </button>
  )
}

const closeBtnStyle = {
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
  WebkitTapHighlightColor: "transparent",
} as const

export default function PrimaryActionSheet({
  open,
  roadTypes,
  helpTypes,
  incidentTypes,
  stolenType,
  onSelectType,
  onClose,
}: PrimaryActionSheetProps) {
  const [view, setView] = useState<"main" | "incident">("main")

  const handleClose = () => {
    setView("main")
    onClose()
  }

  const handleSelectType = (type: ActionReportType) => {
    setView("main")
    onSelectType(type)
  }

  if (!open) return null

  return (
    <div
      style={sheetBackdropStyle}
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={view === "incident" ? "حدث" : "ماذا تريد؟"}
        style={sheetPanelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={sheetHandleStyle} aria-hidden />

        {view === "main" ? (
          <>
            <h2 style={sheetTitleStyle}>ماذا تريد؟</h2>

            <p style={sectionLabelStyle}>بلاغات الطريق</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 18,
              }}
            >
              {roadTypes.map((type) => (
                <TypeButton key={type.label} type={type} onSelect={handleSelectType} />
              ))}
            </div>

            {incidentTypes.length > 0 && (
              <>
                <p style={sectionLabelStyle}>حدث</p>
                <button
                  type="button"
                  onClick={() => setView("incident")}
                  style={{
                    width: "100%",
                    minHeight: 56,
                    marginBottom: 18,
                    padding: "12px 14px",
                    borderRadius: 18,
                    border: "1px solid #fecaca",
                    background: "#450a0a",
                    color: "#fff1f2",
                    fontWeight: 800,
                    fontSize: 16,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    textAlign: "right",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <div>حدث</div>
                  <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, marginTop: 4 }}>
                    وضع مهم بالمنطقة الآن — حريق، إطلاق نار، …
                  </div>
                </button>
              </>
            )}

            <p style={sectionLabelStyle}>مساعدة على الطريق</p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 18,
              }}
            >
              {helpTypes.map((type) => (
                <TypeButton key={type.label} type={type} onSelect={handleSelectType} />
              ))}
            </div>

            {stolenType && (
              <>
                <p style={sectionLabelStyle}>بلاغ طارئ</p>
                <button
                  type="button"
                  onClick={() => handleSelectType(stolenType)}
                  style={{
                    width: "100%",
                    minHeight: 56,
                    marginBottom: 12,
                    padding: "12px 10px",
                    borderRadius: 18,
                    border: "none",
                    background: stolenType.color,
                    color: "white",
                    fontWeight: 800,
                    fontSize: 16,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <span aria-hidden>{stolenType.emoji}</span>
                  <span>{stolenType.label}</span>
                </button>
              </>
            )}

            <button type="button" onClick={handleClose} style={closeBtnStyle}>
              إغلاق
            </button>
          </>
        ) : (
          <>
            <h2 style={sheetTitleStyle}>حدث</h2>
            <p
              style={{
                margin: "0 0 14px",
                fontSize: 13,
                color: CHROME.textMuted,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              بلّغ عما تشوفه أو تسمعه هلق. مش منصة أخبار — للتوعية على سلامة الدراجين.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 14,
              }}
            >
              {incidentTypes.map((type) => (
                <TypeButton key={type.label} type={type} onSelect={handleSelectType} />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setView("main")}
              style={{ ...closeBtnStyle, marginBottom: 8 }}
            >
              رجوع
            </button>
            <button type="button" onClick={handleClose} style={closeBtnStyle}>
              إغلاق
            </button>
          </>
        )}
      </div>
    </div>
  )
}
