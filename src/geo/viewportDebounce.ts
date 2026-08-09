/**
 * Viewport idle debounce + significant-change gate (pure).
 */

export const VIEWPORT_IDLE_DEBOUNCE_MS = 400

/** Fraction of previous half-diagonal the center must move to resubscribe. */
export const VIEWPORT_RESUBSCRIBE_MOVE_RATIO = 0.35

export type ViewportBounds = {
  north: number
  south: number
  east: number
  west: number
}

export function viewportCenter(bounds: ViewportBounds): {
  lat: number
  lng: number
} {
  return {
    lat: (bounds.north + bounds.south) / 2,
    lng: (bounds.east + bounds.west) / 2,
  }
}

export function viewportHalfDiagonalMeters(bounds: ViewportBounds): number {
  // Approximate: 1 deg lat ≈ 111_320 m; lng scaled by cos(lat)
  const midLat = (bounds.north + bounds.south) / 2
  const dLat = Math.abs(bounds.north - bounds.south) * 111_320
  const dLng =
    Math.abs(bounds.east - bounds.west) *
    111_320 *
    Math.max(0.2, Math.cos((midLat * Math.PI) / 180))
  return Math.sqrt(dLat * dLat + dLng * dLng) / 2
}

/**
 * True when the new viewport warrants a geo resubscribe.
 * Same / nested inside previous padded coverage → false (avoid thrash).
 */
export function shouldResubscribeViewport(
  previous: ViewportBounds | null,
  next: ViewportBounds
): boolean {
  if (!previous) return true
  if (
    next.north === previous.north &&
    next.south === previous.south &&
    next.east === previous.east &&
    next.west === previous.west
  ) {
    return false
  }

  const prevCenter = viewportCenter(previous)
  const nextCenter = viewportCenter(next)
  const prevHalf = Math.max(1, viewportHalfDiagonalMeters(previous))
  const nextHalf = Math.max(1, viewportHalfDiagonalMeters(next))

  // Zoom-out significantly → resubscribe
  if (nextHalf > prevHalf * 1.4) return true

  const moveLat = Math.abs(nextCenter.lat - prevCenter.lat) * 111_320
  const moveLng =
    Math.abs(nextCenter.lng - prevCenter.lng) *
    111_320 *
    Math.max(0.2, Math.cos((prevCenter.lat * Math.PI) / 180))
  const move = Math.sqrt(moveLat * moveLat + moveLng * moveLng)

  // Still well inside previous coverage
  if (move + nextHalf < prevHalf * (1 - VIEWPORT_RESUBSCRIBE_MOVE_RATIO)) {
    return false
  }

  return move > prevHalf * VIEWPORT_RESUBSCRIBE_MOVE_RATIO || nextHalf > prevHalf * 1.15
}

export function createDebouncedViewportEmitter(
  onEmit: (bounds: ViewportBounds) => void,
  debounceMs = VIEWPORT_IDLE_DEBOUNCE_MS
): {
  push: (bounds: ViewportBounds) => void
  cancel: () => void
} {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastAccepted: ViewportBounds | null = null

  return {
    push(bounds) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        if (!shouldResubscribeViewport(lastAccepted, bounds)) return
        lastAccepted = bounds
        onEmit(bounds)
      }, debounceMs)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}
