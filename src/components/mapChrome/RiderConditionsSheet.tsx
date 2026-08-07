import {
  CHROME,
  sectionLabelStyle,
  sheetBackdropStyle,
  sheetHandleStyle,
  sheetPanelStyle,
  sheetTitleStyle,
} from "./chromeStyles"
import type { RiderWeather } from "../../weather/types"

type RiderConditionsSheetProps = {
  open: boolean
  weather: RiderWeather | null
  errorMessage: string | null
  refreshing?: boolean
  onRefresh: () => void
  onClose: () => void
}

function Row({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid #e2e8f0",
      }}
    >
      <span style={{ color: CHROME.textMuted, fontWeight: 600, fontSize: 14 }}>
        {label}
      </span>
      <span style={{ color: CHROME.textDark, fontWeight: 800, fontSize: 16 }}>
        {value}
      </span>
    </div>
  )
}

function fmtTemp(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}°`
}

function fmtPct(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)}%`
}

function fmtKmh(v: number | null): string {
  return v == null ? "—" : `${Math.round(v)} كم/س`
}

function fmtKm(v: number | null): string {
  return v == null ? "—" : `${v} كم`
}

export default function RiderConditionsSheet({
  open,
  weather,
  errorMessage,
  refreshing = false,
  onRefresh,
  onClose,
}: RiderConditionsSheetProps) {
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
        aria-label="ظروف القيادة"
        style={sheetPanelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={sheetHandleStyle} aria-hidden />
        <h2 style={sheetTitleStyle}>ظروف القيادة</h2>

        {!weather ? (
          <p
            style={{
              textAlign: "center",
              color: CHROME.textMuted,
              margin: "12px 0 20px",
              fontSize: 15,
            }}
          >
            {errorMessage || "تعذر تحميل الطقس"}
          </p>
        ) : (
          <>
            <div
              style={{
                textAlign: "center",
                marginBottom: 16,
                padding: "12px 10px",
                borderRadius: 18,
                background: "#fff",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 36, lineHeight: 1.2 }} aria-hidden>
                {weather.conditionEmoji}
              </div>
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                  color: CHROME.textDark,
                  marginTop: 4,
                }}
              >
                {fmtTemp(weather.temperatureC)}
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 16,
                  fontWeight: 700,
                  color: CHROME.textMuted,
                }}
              >
                {weather.conditionLabel}
              </div>
            </div>

            <p style={sectionLabelStyle}>التفاصيل</p>
            <div style={{ marginBottom: 16 }}>
              <Row label="درجة الحرارة" value={fmtTemp(weather.temperatureC)} />
              <Row label="الحرارة المحسوسة" value={fmtTemp(weather.feelsLikeC)} />
              <Row label="الرطوبة" value={fmtPct(weather.humidityPct)} />
              <Row label="الرياح" value={fmtKmh(weather.windSpeedKmh)} />
              <Row label="الهبات" value={fmtKmh(weather.windGustKmh)} />
              <Row
                label="اتجاه الرياح"
                value={weather.windDirectionLabel}
              />
              <Row label="احتمال المطر" value={fmtPct(weather.rainProbabilityPct)} />
              <Row
                label="كمية المطر"
                value={
                  weather.precipitationMm == null
                    ? "—"
                    : `${weather.precipitationMm} مم`
                }
              />
              <Row label="مدى الرؤية" value={fmtKm(weather.visibilityKm)} />
              <Row
                label="الأشعة فوق البنفسجية"
                value={
                  weather.uvIndex == null
                    ? "—"
                    : String(Math.round(weather.uvIndex))
                }
              />
              <Row label="الشروق" value={weather.sunriseLabel ?? "—"} />
              <Row label="الغروب" value={weather.sunsetLabel ?? "—"} />
            </div>

            {weather.warnings.length > 0 && (
              <>
                <p style={sectionLabelStyle}>تنبيهات للدراج</p>
                <ul
                  style={{
                    listStyle: "none",
                    margin: "0 0 16px",
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {weather.warnings.map((w) => (
                    <li
                      key={w.id}
                      style={{
                        background: "#fff7ed",
                        border: "1px solid #fed7aa",
                        color: "#9a3412",
                        borderRadius: 14,
                        padding: "12px 14px",
                        fontWeight: 700,
                        fontSize: 14,
                      }}
                    >
                      ⚠️ {w.label}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {weather.hourly.length > 0 && (
              <>
                <p style={sectionLabelStyle}>الساعات القادمة</p>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    overflowX: "auto",
                    paddingBottom: 8,
                    marginBottom: 12,
                    WebkitOverflowScrolling: "touch",
                  }}
                >
                  {weather.hourly.map((h) => (
                    <div
                      key={h.timeLabel}
                      style={{
                        flex: "0 0 auto",
                        minWidth: 72,
                        textAlign: "center",
                        padding: "10px 8px",
                        borderRadius: 14,
                        background: "#fff",
                        border: "1px solid #e2e8f0",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: CHROME.textMuted,
                        }}
                      >
                        {h.timeLabel}
                      </div>
                      <div style={{ fontSize: 18, margin: "4px 0" }} aria-hidden>
                        {h.emoji}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>
                        {fmtTemp(h.temperatureC)}
                      </div>
                      <div
                        style={{
                          fontSize: 11,
                          color: CHROME.textMuted,
                          marginTop: 2,
                        }}
                      >
                        مطر {fmtPct(h.rainProbabilityPct)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <p
              style={{
                margin: "0 0 12px",
                fontSize: 11,
                color: CHROME.textMuted,
                textAlign: "center",
              }}
            >
              بيانات الطقس عبر {weather.attribution} — للتوعية فقط، مش تنبيه رسمي.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            width: "100%",
            minHeight: CHROME.minTap,
            marginBottom: 8,
            borderRadius: CHROME.radiusBtn,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: CHROME.textDark,
            fontWeight: 700,
            fontSize: 15,
            cursor: refreshing ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          تحديث
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
          }}
        >
          إغلاق
        </button>
      </div>
    </div>
  )
}
