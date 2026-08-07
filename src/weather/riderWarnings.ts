import { isFogCode, isHeavyRainCode, isRainyCode } from "./conditionLabels.ts"
import type { RiderWarning, RiderWeather } from "./types.ts"

/** Conservative rider thresholds (km/h, °C, m, %). */
export const RIDER_THRESHOLDS = {
  strongWindKmh: 40,
  strongGustKmh: 55,
  possibleCrosswindKmh: 30,
  poorVisibilityKm: 2,
  highHeatC: 38,
  severeColdC: 5,
  rainLikelyPct: 60,
  heavyPrecipMm: 4,
} as const

type WarningInput = Pick<
  RiderWeather,
  | "windSpeedKmh"
  | "windGustKmh"
  | "visibilityKm"
  | "temperatureC"
  | "rainProbabilityPct"
  | "precipitationMm"
  | "weatherCode"
>

export function deriveRiderWarnings(input: WarningInput): RiderWarning[] {
  const out: RiderWarning[] = []
  const push = (id: RiderWarning["id"], label: string) => {
    if (!out.some((w) => w.id === id)) out.push({ id, label })
  }

  const wind = input.windSpeedKmh
  const gust = input.windGustKmh
  const vis = input.visibilityKm
  const temp = input.temperatureC
  const rainPct = input.rainProbabilityPct
  const precip = input.precipitationMm
  const code = input.weatherCode

  if (typeof wind === "number" && wind >= RIDER_THRESHOLDS.strongWindKmh) {
    push("strongWind", "انتبه — رياح قوية")
  } else if (
    typeof wind === "number" &&
    wind >= RIDER_THRESHOLDS.possibleCrosswindKmh
  ) {
    push("possibleCrosswind", "رياح جانبية محتملة")
  }

  if (typeof gust === "number" && gust >= RIDER_THRESHOLDS.strongGustKmh) {
    push("strongGusts", "هبات قوية")
  }

  if (typeof vis === "number" && vis < RIDER_THRESHOLDS.poorVisibilityKm) {
    push("poorVisibility", "الرؤية ضعيفة")
  }

  if (isFogCode(code)) {
    push("fog", "ضباب")
  }

  if (typeof temp === "number" && temp >= RIDER_THRESHOLDS.highHeatC) {
    push("highHeat", "حرارة مرتفعة")
  }
  if (typeof temp === "number" && temp <= RIDER_THRESHOLDS.severeColdC) {
    push("severeCold", "برد شديد")
  }

  if (
    typeof rainPct === "number" &&
    rainPct >= RIDER_THRESHOLDS.rainLikelyPct
  ) {
    push("rainLikely", "احتمال المطر مرتفع")
  }

  if (
    isHeavyRainCode(code) ||
    (typeof precip === "number" && precip >= RIDER_THRESHOLDS.heavyPrecipMm)
  ) {
    push("heavyRain", "أمطار غزيرة")
  }

  const rainingNow =
    isRainyCode(code) ||
    (typeof precip === "number" && precip > 0.2) ||
    (typeof rainPct === "number" && rainPct >= RIDER_THRESHOLDS.rainLikelyPct)

  if (rainingNow) {
    push("possibleWetRoad", "احتمال طريق مبلل")
    push("slipRiskFromRain", "المطر قد يزيد خطر الانزلاق")
  }

  return out
}
