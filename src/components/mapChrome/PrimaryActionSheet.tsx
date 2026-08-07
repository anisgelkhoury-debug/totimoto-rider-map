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

export default function PrimaryActionSheet({
  open,
  roadTypes,
  helpTypes,
  stolenType,
  onSelectType,
  onClose,
}: PrimaryActionSheetProps) {
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
        aria-label="ماذا تريد؟"
        style={sheetPanelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={sheetHandleStyle} aria-hidden />
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
            <TypeButton key={type.label} type={type} onSelect={onSelectType} />
          ))}
        </div>

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
            <TypeButton key={type.label} type={type} onSelect={onSelectType} />
          ))}
        </div>

        {stolenType && (
          <>
            <p style={sectionLabelStyle}>بلاغ طارئ</p>
            <button
              type="button"
              onClick={() => onSelectType(stolenType)}
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
            WebkitTapHighlightColor: "transparent",
          }}
        >
          إغلاق
        </button>
      </div>
    </div>
  )
}
