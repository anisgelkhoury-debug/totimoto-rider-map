import { mapWeatherCode } from "./conditionLabels.ts"
import { deriveRiderWarnings } from "./riderWarnings.ts"
import type { HourlyPreviewPoint, RiderWeather } from "./types.ts"
import { windDirectionArabic } from "./windDirection.ts"

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

function metersToKm(meters: unknown): number | null {
  const m = asFiniteNumber(meters)
  if (m == null) return null
  return Math.round((m / 1000) * 10) / 10
}

/** Format Open-Meteo ISO local time "2026-08-07T18:30" → "18:30" */
export function formatLocalClock(isoLocal: unknown): string | null {
  if (typeof isoLocal !== "string" || !isoLocal.includes("T")) return null
  const time = isoLocal.split("T")[1] ?? ""
  const hhmm = time.slice(0, 5)
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null
}

type OpenMeteoResponse = {
  latitude?: unknown
  longitude?: unknown
  current?: Record<string, unknown>
  hourly?: {
    time?: unknown
    temperature_2m?: unknown
    precipitation_probability?: unknown
    weather_code?: unknown
  }
  daily?: {
    sunrise?: unknown
    sunset?: unknown
  }
}

function nearestHourlyRainProbability(
  hourly: OpenMeteoResponse["hourly"],
  currentTimeIso: unknown
): number | null {
  if (!hourly || !Array.isArray(hourly.time)) return null
  const probs = hourly.precipitation_probability
  if (!Array.isArray(probs)) return null
  let idx = 0
  if (typeof currentTimeIso === "string") {
    const found = hourly.time.findIndex((t) => t === currentTimeIso)
    if (found >= 0) idx = found
  }
  return asFiniteNumber(probs[idx])
}

function buildHourlyPreview(
  hourly: OpenMeteoResponse["hourly"],
  startIndex = 0,
  count = 6
): HourlyPreviewPoint[] {
  if (!hourly || !Array.isArray(hourly.time)) return []
  const out: HourlyPreviewPoint[] = []
  for (let i = startIndex; i < hourly.time.length && out.length < count; i++) {
    const timeLabel = formatLocalClock(hourly.time[i])
    if (!timeLabel) continue
    const temps = Array.isArray(hourly.temperature_2m)
      ? hourly.temperature_2m
      : []
    const probs = Array.isArray(hourly.precipitation_probability)
      ? hourly.precipitation_probability
      : []
    const codes = Array.isArray(hourly.weather_code) ? hourly.weather_code : []
    const mapped = mapWeatherCode(codes[i])
    out.push({
      timeLabel,
      temperatureC: asFiniteNumber(temps[i]),
      rainProbabilityPct: asFiniteNumber(probs[i]),
      conditionLabel: mapped.label,
      emoji: mapped.emoji,
    })
  }
  return out
}

/**
 * Normalize Open-Meteo forecast JSON into RiderWeather.
 * Returns null when response is unusable (no current block / no temp).
 */
export function normalizeOpenMeteoResponse(
  raw: unknown,
  options: { lat: number; lng: number; fetchedAt?: number }
): RiderWeather | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as OpenMeteoResponse
  const current = data.current
  if (!current || typeof current !== "object") return null

  const temperatureC = asFiniteNumber(current.temperature_2m)
  if (temperatureC == null) return null

  const weatherCode = asFiniteNumber(current.weather_code)
  const mapped = mapWeatherCode(weatherCode)
  const windDirectionDeg = asFiniteNumber(current.wind_direction_10m)
  const visibilityKm = metersToKm(current.visibility)
  const rainProbabilityPct = nearestHourlyRainProbability(
    data.hourly,
    current.time
  )
  const precipitationMm = asFiniteNumber(current.precipitation ?? current.rain)

  const sunriseArr = Array.isArray(data.daily?.sunrise)
    ? data.daily?.sunrise
    : []
  const sunsetArr = Array.isArray(data.daily?.sunset) ? data.daily?.sunset : []

  let hourlyStart = 0
  if (
    data.hourly &&
    Array.isArray(data.hourly.time) &&
    typeof current.time === "string"
  ) {
    const idx = data.hourly.time.findIndex((t) => t === current.time)
    hourlyStart = idx >= 0 ? idx : 0
  }

  const base: RiderWeather = {
    fetchedAt: options.fetchedAt ?? Date.now(),
    lat: options.lat,
    lng: options.lng,
    temperatureC,
    feelsLikeC: asFiniteNumber(current.apparent_temperature),
    humidityPct: asFiniteNumber(current.relative_humidity_2m),
    windSpeedKmh: asFiniteNumber(current.wind_speed_10m),
    windGustKmh: asFiniteNumber(current.wind_gusts_10m),
    windDirectionDeg,
    windDirectionLabel: windDirectionArabic(windDirectionDeg),
    rainProbabilityPct,
    precipitationMm,
    visibilityKm,
    uvIndex: asFiniteNumber(current.uv_index),
    sunriseLabel: formatLocalClock(sunriseArr[0]),
    sunsetLabel: formatLocalClock(sunsetArr[0]),
    conditionLabel: mapped.label,
    conditionEmoji: mapped.emoji,
    weatherCode,
    isDay:
      typeof current.is_day === "number" ? current.is_day === 1 : null,
    warnings: [],
    hourly: buildHourlyPreview(data.hourly, hourlyStart, 6),
    attribution: "Open-Meteo",
  }

  return {
    ...base,
    warnings: deriveRiderWarnings(base),
  }
}
