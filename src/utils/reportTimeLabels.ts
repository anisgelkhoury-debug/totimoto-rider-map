/** Arabic relative time labels for report UI. */

export function timeAgo(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / 1000 / 60)

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
  const minutesPassed = Math.floor((now - createdAt) / 1000 / 60)
  const remaining = (report.expiry ?? 0) - minutesPassed

  if (remaining <= 0) return "انتهى"
  if (remaining === 1) return "ينتهي خلال دقيقة"

  return `ينتهي خلال ${remaining} دقيقة`
}
