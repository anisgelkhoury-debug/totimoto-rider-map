/** Arabic relative time labels for report UI. */

export function minutesSince(timestamp: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - timestamp) / 1000 / 60))
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const minutes = minutesSince(timestamp, now)

  if (minutes <= 0) return "الآن"
  if (minutes === 1) return "منذ دقيقة"
  if (minutes < 60) return `منذ ${minutes} دقائق`

  const hours = Math.floor(minutes / 60)

  if (hours === 1) return "منذ ساعة"
  return `منذ ${hours} ساعات`
}

export function timeLeft(
  report: { createdAt?: number; expiry?: number },
  now = Date.now()
): string {
  const createdAt = report.createdAt ?? now
  const minutesPassed = minutesSince(createdAt, now)
  const remaining = (report.expiry ?? 0) - minutesPassed

  if (remaining <= 0) return "انتهى"
  if (remaining === 1) return "ينتهي خلال دقيقة"

  return `ينتهي خلال ${remaining} دقيقة`
}

/** Age color for list cards: fresh / mid / stale. */
export function reportAgeColor(timestamp: number, now = Date.now()): string {
  const minutes = minutesSince(timestamp, now)
  if (minutes < 10) return "#22c55e"
  if (minutes < 30) return "#f59e0b"
  return "#ef4444"
}
