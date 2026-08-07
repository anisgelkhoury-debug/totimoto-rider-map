import type { MapTypeMode } from "./mapTypes"
import {
  CHROME,
  sectionLabelStyle,
  sheetBackdropStyle,
  sheetHandleStyle,
  sheetPanelStyle,
  sheetTitleStyle,
} from "./chromeStyles"

const MAP_TYPE_OPTIONS: { id: MapTypeMode; label: string }[] = [
  { id: "roadmap", label: "خريطة" },
  { id: "satellite", label: "قمر صناعي" },
  { id: "terrain", label: "تضاريس" },
]

type LayersSheetProps = {
  open: boolean
  mapTypeId: MapTypeMode
  trafficOn: boolean
  onMapTypeIdChange: (id: MapTypeMode) => void
  onTrafficOnChange: (on: boolean) => void
  onClose: () => void
}

export default function LayersSheet({
  open,
  mapTypeId,
  trafficOn,
  onMapTypeIdChange,
  onTrafficOnChange,
  onClose,
}: LayersSheetProps) {
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
        aria-label="طبقات الخريطة"
        style={sheetPanelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={sheetHandleStyle} aria-hidden />
        <h2 style={sheetTitleStyle}>طبقات الخريطة</h2>

        <p style={sectionLabelStyle}>نوع الخريطة</p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 8,
            marginBottom: 18,
          }}
        >
          {MAP_TYPE_OPTIONS.map((option) => {
            const active = mapTypeId === option.id
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={active}
                onClick={() => onMapTypeIdChange(option.id)}
                style={{
                  minHeight: CHROME.minTap,
                  borderRadius: CHROME.radiusBtn,
                  border: active ? "2px solid #1d4ed8" : "1px solid #e2e8f0",
                  background: active ? "#eff6ff" : "#ffffff",
                  color: CHROME.textDark,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>

        <p style={sectionLabelStyle}>حركة المرور</p>
        <button
          type="button"
          aria-pressed={trafficOn}
          onClick={() => onTrafficOnChange(!trafficOn)}
          style={{
            width: "100%",
            minHeight: CHROME.minTap,
            borderRadius: CHROME.radiusBtn,
            border: trafficOn ? "2px solid #b45309" : "1px solid #e2e8f0",
            background: trafficOn ? "#fff7ed" : "#ffffff",
            color: CHROME.textDark,
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
            fontFamily: "inherit",
            marginBottom: 12,
            WebkitTapHighlightColor: "transparent",
          }}
        >
          {trafficOn ? "حركة السير: مفعّلة" : "حركة السير: مطفية"}
        </button>

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
