/**
 * Coordinate validation for getRiderWeather.
 */

export type ValidCoords = { lat: number; lng: number }

export function parseCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function validateRiderWeatherCoords(
  latRaw: unknown,
  lngRaw: unknown
): { ok: true; coords: ValidCoords } | { ok: false; error: string } {
  if (latRaw == null || lngRaw == null || latRaw === "" || lngRaw === "") {
    return { ok: false, error: "missing_coordinates" }
  }
  const lat = parseCoordinate(latRaw)
  const lng = parseCoordinate(lngRaw)
  if (lat == null) return { ok: false, error: "invalid_latitude" }
  if (lng == null) return { ok: false, error: "invalid_longitude" }
  if (lat < -90 || lat > 90) return { ok: false, error: "invalid_latitude" }
  if (lng < -180 || lng > 180) return { ok: false, error: "invalid_longitude" }
  return { ok: true, coords: { lat, lng } }
}

/** ~0.1° grid — same order as client weather cache. */
export function weatherGridKey(lat: number, lng: number): string {
  const round = (v: number) => Math.round(v * 10) / 10
  return `${round(lat)},${round(lng)}`
}
