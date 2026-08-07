/**
 * WMO Weather interpretation codes → Arabic rider-facing labels.
 * https://open-meteo.com/en/docs
 */

export type ConditionMapping = {
  label: string
  emoji: string
}

const CODE_MAP: Record<number, ConditionMapping> = {
  0: { label: "صافي", emoji: "☀️" },
  1: { label: "غالباً صافي", emoji: "🌤️" },
  2: { label: "غائم جزئياً", emoji: "⛅" },
  3: { label: "غائم", emoji: "☁️" },
  45: { label: "ضباب", emoji: "🌫️" },
  48: { label: "ضباب متجمد", emoji: "🌫️" },
  51: { label: "رذاذ خفيف", emoji: "🌦️" },
  53: { label: "رذاذ", emoji: "🌦️" },
  55: { label: "رذاذ غزير", emoji: "🌧️" },
  56: { label: "رذاذ متجمد", emoji: "🌧️" },
  57: { label: "رذاذ متجمد", emoji: "🌧️" },
  61: { label: "مطر خفيف", emoji: "🌧️" },
  63: { label: "مطر", emoji: "🌧️" },
  65: { label: "مطر غزير", emoji: "🌧️" },
  66: { label: "مطر متجمد", emoji: "🌧️" },
  67: { label: "مطر متجمد غزير", emoji: "🌧️" },
  71: { label: "ثلج خفيف", emoji: "🌨️" },
  73: { label: "ثلج", emoji: "🌨️" },
  75: { label: "ثلج غزير", emoji: "🌨️" },
  77: { label: "حبيبات ثلج", emoji: "🌨️" },
  80: { label: "زخات مطر", emoji: "🌦️" },
  81: { label: "زخات مطر", emoji: "🌧️" },
  82: { label: "زخات غزيرة", emoji: "🌧️" },
  85: { label: "زخات ثلج", emoji: "🌨️" },
  86: { label: "زخات ثلج غزيرة", emoji: "🌨️" },
  95: { label: "عاصف / رعد", emoji: "⛈️" },
  96: { label: "عاصفة رعدية", emoji: "⛈️" },
  99: { label: "عاصفة رعدية قوية", emoji: "⛈️" },
}

export function mapWeatherCode(code: unknown): ConditionMapping {
  if (typeof code !== "number" || !Number.isFinite(code)) {
    return { label: "غير متوفر", emoji: "🌡️" }
  }
  const exact = CODE_MAP[code]
  if (exact) return exact
  if (code >= 50 && code < 60) return { label: "رذاذ", emoji: "🌦️" }
  if (code >= 60 && code < 70) return { label: "مطر", emoji: "🌧️" }
  if (code >= 70 && code < 80) return { label: "ثلج", emoji: "🌨️" }
  if (code >= 80 && code < 90) return { label: "زخات", emoji: "🌦️" }
  if (code >= 90) return { label: "عاصف", emoji: "⛈️" }
  return { label: "غائم", emoji: "☁️" }
}

export function isFogCode(code: unknown): boolean {
  return code === 45 || code === 48
}

export function isRainyCode(code: unknown): boolean {
  if (typeof code !== "number") return false
  return (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    code === 95 ||
    code === 96 ||
    code === 99
  )
}

export function isHeavyRainCode(code: unknown): boolean {
  return code === 65 || code === 67 || code === 82 || code === 99
}
