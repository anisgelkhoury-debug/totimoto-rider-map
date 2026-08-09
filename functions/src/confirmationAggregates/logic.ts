/**
 * Pure confirmation aggregate sync logic (Functions).
 * Recounts from confirmation docs — idempotent under at-least-once delivery.
 */

export const CONFIRMATION_STATUS = {
  present: "present",
  gone: "gone",
} as const

export type ConfirmationStatus =
  (typeof CONFIRMATION_STATUS)[keyof typeof CONFIRMATION_STATUS]

export type AggregateCounts = {
  presentCount: number
  goneCount: number
}

/** Same thresholds as client reportTrust (likely-gone side). */
export const LIKELY_GONE_MIN_GONE = 3

export function isLikelyGoneCounts(counts: AggregateCounts): boolean {
  const { presentCount: p, goneCount: g } = counts
  return g >= LIKELY_GONE_MIN_GONE && g >= p * 2
}

export function countConfirmationStatuses(
  docs: ReadonlyArray<{ status?: unknown }>
): AggregateCounts {
  let presentCount = 0
  let goneCount = 0
  for (const d of docs) {
    if (d.status === CONFIRMATION_STATUS.present) presentCount += 1
    else if (d.status === CONFIRMATION_STATUS.gone) goneCount += 1
  }
  return {
    presentCount: Math.max(0, presentCount),
    goneCount: Math.max(0, goneCount),
  }
}

/**
 * Decide likelyGoneSince for the next aggregate write.
 * - Entering likely-gone → set nowMs (or keep existing)
 * - Staying likely-gone → keep existing (or set nowMs if missing)
 * - Leaving → null (caller deletes field)
 */
export function nextLikelyGoneSinceMs(options: {
  nextCounts: AggregateCounts
  existingLikelyGoneSinceMs: number | null
  nowMs: number
}): number | null {
  const { nextCounts, existingLikelyGoneSinceMs, nowMs } = options
  if (!isLikelyGoneCounts(nextCounts)) return null
  if (
    existingLikelyGoneSinceMs != null &&
    Number.isFinite(existingLikelyGoneSinceMs)
  ) {
    return existingLikelyGoneSinceMs
  }
  return nowMs
}

export function normalizeTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value
  }
  if (value && typeof value === "object") {
    const v = value as {
      toMillis?: () => number
      seconds?: number
      nanoseconds?: number
    }
    if (typeof v.toMillis === "function") {
      const ms = v.toMillis()
      return Number.isFinite(ms) ? ms : null
    }
    if (typeof v.seconds === "number" && Number.isFinite(v.seconds)) {
      const nanos = typeof v.nanoseconds === "number" ? v.nanoseconds : 0
      return v.seconds * 1000 + Math.floor(nanos / 1e6)
    }
  }
  return null
}

/** Build parent patch fields from recount (no resolvedAt / expiry). */
export function buildAggregatePatch(options: {
  counts: AggregateCounts
  likelyGoneSinceMs: number | null
  nowMs: number
  clearLikelyGoneSince: boolean
}): {
  confirmationPresentCount: number
  confirmationGoneCount: number
  confirmationUpdatedAt: number
  likelyGoneSinceMs: number | null
  clearLikelyGoneSince: boolean
} {
  const present = Math.max(0, Math.floor(options.counts.presentCount))
  const gone = Math.max(0, Math.floor(options.counts.goneCount))
  return {
    confirmationPresentCount: present,
    confirmationGoneCount: gone,
    confirmationUpdatedAt: options.nowMs,
    likelyGoneSinceMs: options.clearLikelyGoneSince
      ? null
      : options.likelyGoneSinceMs,
    clearLikelyGoneSince: options.clearLikelyGoneSince,
  }
}

export function computeAggregateSyncState(options: {
  confirmationDocs: ReadonlyArray<{ status?: unknown }>
  existingLikelyGoneSince: unknown
  nowMs: number
}): ReturnType<typeof buildAggregatePatch> {
  const counts = countConfirmationStatuses(options.confirmationDocs)
  const existing = normalizeTimestampMs(options.existingLikelyGoneSince)
  const nextSince = nextLikelyGoneSinceMs({
    nextCounts: counts,
    existingLikelyGoneSinceMs: existing,
    nowMs: options.nowMs,
  })
  return buildAggregatePatch({
    counts,
    likelyGoneSinceMs: nextSince,
    nowMs: options.nowMs,
    clearLikelyGoneSince: nextSince == null,
  })
}
