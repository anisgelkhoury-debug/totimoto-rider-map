/**
 * One-shot high-accuracy geolocation for report create (no permanent watch).
 */

export type LatLngTuple = [number, number]

export type FreshLocationSource = "fresh" | "fallback" | "none"

export type FreshLocationResult = {
  coords: LatLngTuple | null
  source: FreshLocationSource
}

export type GeolocationPositionLike = {
  coords: { latitude: number; longitude: number }
}

export type GetCurrentPositionFn = (
  success: (position: GeolocationPositionLike) => void,
  error?: (error: { code?: number; message?: string }) => void,
  options?: {
    enableHighAccuracy?: boolean
    maximumAge?: number
    timeout?: number
  }
) => void

export function isValidLatLngTuple(value: unknown): value is LatLngTuple {
  if (!Array.isArray(value) || value.length < 2) return false
  const [lat, lng] = value
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  )
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * Prefer a fresh HA fix; else keep a valid existing location; else null.
 * Never invent Beirut here — callers decide ultimate defaults.
 */
export async function resolveCreateLocation(input: {
  existing: LatLngTuple | null | undefined
  getCurrentPosition?: GetCurrentPositionFn | null
  timeoutMs?: number
}): Promise<FreshLocationResult> {
  const existing = isValidLatLngTuple(input.existing) ? input.existing : null
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const getter =
    input.getCurrentPosition ??
    (typeof navigator !== "undefined" && navigator.geolocation
      ? (navigator.geolocation.getCurrentPosition.bind(
          navigator.geolocation
        ) as GetCurrentPositionFn)
      : null)

  if (getter) {
    try {
      const fresh = await new Promise<LatLngTuple>((resolve, reject) => {
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          reject(new Error("geolocation-timeout"))
        }, timeoutMs + 250)

        getter(
          (position) => {
            if (settled) return
            const next: LatLngTuple = [
              position.coords.latitude,
              position.coords.longitude,
            ]
            if (!isValidLatLngTuple(next)) {
              settled = true
              clearTimeout(timer)
              reject(new Error("geolocation-invalid"))
              return
            }
            settled = true
            clearTimeout(timer)
            resolve(next)
          },
          () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            reject(new Error("geolocation-error"))
          },
          {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: timeoutMs,
          }
        )
      })
      return { coords: fresh, source: "fresh" }
    } catch {
      /* fall through */
    }
  }

  if (existing) {
    return { coords: existing, source: "fallback" }
  }

  return { coords: null, source: "none" }
}
