import type { CSSProperties } from "react"
import { floatingControlStyle } from "./chromeStyles"
import type { RiderWeather } from "../../weather/types"

type WeatherChipProps = {
  visible: boolean
  weather: RiderWeather | null
  onOpen: () => void
}

const chipWrap: CSSProperties = {
  position: "fixed",
  top: "calc(14px + env(safe-area-inset-top, 0px))",
  right: 12,
  zIndex: 3000,
  pointerEvents: "none",
}

export default function WeatherChip({
  visible,
  weather,
  onOpen,
}: WeatherChipProps) {
  if (!visible || !weather || weather.temperatureC == null) return null

  const temp = Math.round(weather.temperatureC)

  return (
    <div style={chipWrap}>
      <button
        type="button"
        aria-label="ظروف القيادة"
        onClick={onOpen}
        style={{
          ...floatingControlStyle,
          pointerEvents: "auto",
          minWidth: 72,
          padding: "0 14px",
          gap: 8,
          fontSize: 15,
          fontWeight: 800,
        }}
      >
        <span aria-hidden>{weather.conditionEmoji}</span>
        <span>
          {temp}°
        </span>
      </button>
    </div>
  )
}
