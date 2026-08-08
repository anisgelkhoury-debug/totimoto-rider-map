import type { CSSProperties } from "react"
import { floatingControlStyle } from "./chromeStyles"
import { formatNearbyChipLabel } from "../../nearby/nearbyIntelligence"

type NearbyChipProps = {
  visible: boolean
  count: number
  /** When weather chip is showing, stack below it. */
  stackBelowWeather: boolean
  onOpen: () => void
}

export default function NearbyChip({
  visible,
  count,
  stackBelowWeather,
  onOpen,
}: NearbyChipProps) {
  if (!visible || count <= 0) return null

  const label = formatNearbyChipLabel(count)
  if (!label) return null

  const wrap: CSSProperties = {
    position: "fixed",
    top: stackBelowWeather
      ? "calc(70px + env(safe-area-inset-top, 0px))"
      : "calc(14px + env(safe-area-inset-top, 0px))",
    right: 12,
    zIndex: 3000,
    pointerEvents: "none",
    maxWidth: "min(220px, calc(100vw - 88px))",
  }

  return (
    <div style={wrap}>
      <button
        type="button"
        aria-label={label}
        onClick={onOpen}
        style={{
          ...floatingControlStyle,
          pointerEvents: "auto",
          minWidth: 0,
          maxWidth: "100%",
          padding: "0 12px",
          gap: 6,
          fontSize: 13,
          fontWeight: 800,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        <span aria-hidden>⚠️</span>
        <span>{label}</span>
      </button>
    </div>
  )
}
