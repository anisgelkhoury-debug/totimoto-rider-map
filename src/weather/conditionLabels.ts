/**
 * WeatherAPI.com condition codes → Arabic rider-facing labels.
 * Never show raw English provider text to riders.
 * https://www.weatherapi.com/docs/weather_conditions.json
 */

export type ConditionMapping = {
  label: string
  emoji: string
}

const CODE_MAP: Record<number, ConditionMapping> = {
  1000: { label: "صافي", emoji: "☀️" },
  1003: { label: "غائم جزئياً", emoji: "⛅" },
  1006: { label: "غائم", emoji: "☁️" },
  1009: { label: "غائم", emoji: "☁️" },
  1030: { label: "ضباب", emoji: "🌫️" },
  1063: { label: "مطر خفيف", emoji: "🌦️" },
  1066: { label: "ثلج خفيف", emoji: "🌨️" },
  1069: { label: "مطر خفيف", emoji: "🌦️" },
  1072: { label: "رذاذ متجمد", emoji: "🌧️" },
  1087: { label: "عاصف / رعد", emoji: "⛈️" },
  1114: { label: "ثلج", emoji: "🌨️" },
  1117: { label: "ثلج غزير", emoji: "🌨️" },
  1135: { label: "ضباب", emoji: "🌫️" },
  1147: { label: "ضباب متجمد", emoji: "🌫️" },
  1150: { label: "رذاذ خفيف", emoji: "🌦️" },
  1153: { label: "رذاذ", emoji: "🌦️" },
  1168: { label: "رذاذ متجمد", emoji: "🌧️" },
  1171: { label: "رذاذ متجمد", emoji: "🌧️" },
  1180: { label: "مطر خفيف", emoji: "🌧️" },
  1183: { label: "مطر خفيف", emoji: "🌧️" },
  1186: { label: "مطر", emoji: "🌧️" },
  1189: { label: "مطر", emoji: "🌧️" },
  1192: { label: "مطر غزير", emoji: "🌧️" },
  1195: { label: "مطر غزير", emoji: "🌧️" },
  1198: { label: "مطر متجمد", emoji: "🌧️" },
  1201: { label: "مطر متجمد غزير", emoji: "🌧️" },
  1204: { label: "مطر خفيف", emoji: "🌦️" },
  1207: { label: "مطر", emoji: "🌧️" },
  1210: { label: "ثلج خفيف", emoji: "🌨️" },
  1213: { label: "ثلج خفيف", emoji: "🌨️" },
  1216: { label: "ثلج", emoji: "🌨️" },
  1219: { label: "ثلج", emoji: "🌨️" },
  1222: { label: "ثلج غزير", emoji: "🌨️" },
  1225: { label: "ثلج غزير", emoji: "🌨️" },
  1237: { label: "حبيبات ثلج", emoji: "🌨️" },
  1240: { label: "زخات مطر", emoji: "🌦️" },
  1243: { label: "زخات مطر", emoji: "🌧️" },
  1246: { label: "زخات غزيرة", emoji: "🌧️" },
  1249: { label: "زخات مطر", emoji: "🌦️" },
  1252: { label: "زخات مطر", emoji: "🌧️" },
  1255: { label: "زخات ثلج", emoji: "🌨️" },
  1258: { label: "زخات ثلج غزيرة", emoji: "🌨️" },
  1261: { label: "زخات", emoji: "🌨️" },
  1264: { label: "زخات", emoji: "🌨️" },
  1273: { label: "عاصفة رعدية", emoji: "⛈️" },
  1276: { label: "عاصفة رعدية قوية", emoji: "⛈️" },
  1279: { label: "عاصفة رعدية", emoji: "⛈️" },
  1282: { label: "عاصفة رعدية قوية", emoji: "⛈️" },
}

const FOG_CODES = new Set([1030, 1135, 1147])

const HEAVY_RAIN_CODES = new Set([1192, 1195, 1201, 1243, 1246, 1276])

const RAINY_CODES = new Set([
  1063, 1069, 1072, 1087, 1150, 1153, 1168, 1171, 1180, 1183, 1186, 1189,
  1192, 1195, 1198, 1201, 1204, 1207, 1240, 1243, 1246, 1249, 1252, 1273,
  1276,
])

export function mapWeatherCode(code: unknown): ConditionMapping {
  if (typeof code !== "number" || !Number.isFinite(code)) {
    return { label: "غير متوفر", emoji: "🌡️" }
  }
  return CODE_MAP[code] ?? { label: "غائم", emoji: "☁️" }
}

export function isFogCode(code: unknown): boolean {
  return typeof code === "number" && FOG_CODES.has(code)
}

export function isRainyCode(code: unknown): boolean {
  return typeof code === "number" && RAINY_CODES.has(code)
}

export function isHeavyRainCode(code: unknown): boolean {
  return typeof code === "number" && HEAVY_RAIN_CODES.has(code)
}
