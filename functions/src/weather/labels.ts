/**
 * WeatherAPI.com condition codes → Arabic labels (server-side).
 */

type ConditionMapping = { label: string; emoji: string }

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

const FOG = new Set([1030, 1135, 1147])
const HEAVY_RAIN = new Set([1192, 1195, 1201, 1243, 1246, 1276])
const RAINY = new Set([
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
  return typeof code === "number" && FOG.has(code)
}

export function isRainyCode(code: unknown): boolean {
  return typeof code === "number" && RAINY.has(code)
}

export function isHeavyRainCode(code: unknown): boolean {
  return typeof code === "number" && HEAVY_RAIN.has(code)
}

export function windDirectionArabic(degrees: unknown): string {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return "—"
  const d = ((degrees % 360) + 360) % 360
  const sectors = [
    "شمالية",
    "شمالية شرقية",
    "شرقية",
    "جنوبية شرقية",
    "جنوبية",
    "جنوبية غربية",
    "غربية",
    "شمالية غربية",
  ]
  return sectors[Math.round(d / 45) % 8] ?? "—"
}

const T = {
  strongWindKmh: 40,
  strongGustKmh: 55,
  possibleCrosswindKmh: 30,
  poorVisibilityKm: 2,
  highHeatC: 38,
  severeColdC: 5,
  rainLikelyPct: 60,
  heavyPrecipMm: 4,
} as const

export function deriveRiderWarnings(input: {
  windSpeedKmh: number | null
  windGustKmh: number | null
  visibilityKm: number | null
  temperatureC: number | null
  rainProbabilityPct: number | null
  precipitationMm: number | null
  weatherCode: number | null
}): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = []
  const push = (id: string, label: string) => {
    if (!out.some((w) => w.id === id)) out.push({ id, label })
  }
  const wind = input.windSpeedKmh
  const gust = input.windGustKmh
  const vis = input.visibilityKm
  const temp = input.temperatureC
  const rainPct = input.rainProbabilityPct
  const precip = input.precipitationMm
  const code = input.weatherCode

  if (typeof wind === "number" && wind >= T.strongWindKmh) {
    push("strongWind", "انتبه — رياح قوية")
  } else if (typeof wind === "number" && wind >= T.possibleCrosswindKmh) {
    push("possibleCrosswind", "رياح جانبية محتملة")
  }
  if (typeof gust === "number" && gust >= T.strongGustKmh) {
    push("strongGusts", "هبات قوية")
  }
  if (typeof vis === "number" && vis < T.poorVisibilityKm) {
    push("poorVisibility", "الرؤية ضعيفة")
  }
  if (isFogCode(code)) push("fog", "ضباب")
  if (typeof temp === "number" && temp >= T.highHeatC) push("highHeat", "حرارة مرتفعة")
  if (typeof temp === "number" && temp <= T.severeColdC) push("severeCold", "برد شديد")
  if (typeof rainPct === "number" && rainPct >= T.rainLikelyPct) {
    push("rainLikely", "احتمال المطر مرتفع")
  }
  if (
    isHeavyRainCode(code) ||
    (typeof precip === "number" && precip >= T.heavyPrecipMm)
  ) {
    push("heavyRain", "أمطار غزيرة")
  }
  const rainingNow =
    isRainyCode(code) ||
    (typeof precip === "number" && precip > 0.2) ||
    (typeof rainPct === "number" && rainPct >= T.rainLikelyPct)
  if (rainingNow) {
    push("possibleWetRoad", "احتمال طريق مبلل")
    push("slipRiskFromRain", "المطر قد يزيد خطر الانزلاق")
  }
  return out
}
