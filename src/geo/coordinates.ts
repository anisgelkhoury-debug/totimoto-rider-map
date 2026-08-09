/**
 * Coordinate validation for geo foundation.
 * Aligns with map coordinate rules (finite, lat∈[-90,90], lng∈[-180,180]).
 */

export type GeoLatLng = {
  lat: number
  lng: number
}

export function isValidGeoCoordinate(
  lat: unknown,
  lng: unknown
): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

/**
 * Strict parse — returns null for invalid / NaN / out-of-range.
 * Does not clamp or invent coordinates.
 */
export function parseGeoLatLng(
  lat: unknown,
  lng: unknown
): GeoLatLng | null {
  if (!isValidGeoCoordinate(lat, lng)) return null
  return { lat, lng }
}

/** Reject polar extremes that make longitude degrees unstable for large radii. */
export function isSafeQueryLatitude(lat: number): boolean {
  return Number.isFinite(lat) && Math.abs(lat) <= 85
}
