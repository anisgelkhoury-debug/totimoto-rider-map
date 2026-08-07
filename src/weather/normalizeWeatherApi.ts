import { mapWeatherCode } from "./conditionLabels.ts"
import { deriveRiderWarnings } from "./riderWarnings.ts"
import type { HourlyPreviewPoint, RiderWeather } from "./types.ts"
import { windDirectionArabic } from "./windDirection.ts"

function asFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}

function asNumberish(value: unknown): number | null {
  if (typeof value === "number") return asFiniteNumber(value)
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** "18:00" or "2026-08-07 18:00" → "18:00" */
export function formatLocalClock(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed
  const space = trimmed.match(/\b(\d{2}:\d{2})\b/)
  return space ? space[1] : null
}

/**
 * WeatherAPI astronomy clocks: "06:12 AM" / "7:32 PM" → 24h "HH:MM".
 */
export function formatWeatherApiClock(value: unknown): string | null {
  if (typeof value !== "string") return null
  const direct = formatLocalClock(value)
  if (direct && !/[AP]M/i.test(value)) return direct
  const m = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2]
  const ap = m[3].toUpperCase()
  if (!Number.isFinite(hour)) return null
  if (ap === "AM") {
    if (hour === 12) hour = 0
  } else if (hour !== 12) {
    hour += 12
  }
  return `${String(hour).padStart(2, "0")}:${minute}`
}

type WeatherApiHour = {
  time?: unknown
  temp_c?: unknown
  chance_of_rain?: unknown
  condition?: { code?: unknown; text?: unknown }
}

type WeatherApiResponse = {
  current?: {
    temp_c?: unknown
    feelslike_c?: unknown
    humidity?: unknown
    wind_kph?: unknown
    gust_kph?: unknown
    wind_degree?: unknown
    precip_mm?: unknown
    vis_km?: unknown
    uv?: unknown
    is_day?: unknown
    condition?: { code?: unknown; text?: unknown }
  }
  forecast?: {
    forecastday?: Array<{
      astro?: { sunrise?: unknown; sunset?: unknown }
      hour?: WeatherApiHour[]
    }>
  }
}

function buildHourlyPreview(
  hours: WeatherApiHour[] | undefined,
  startIndex: number,
  count = 6
): HourlyPreviewPoint[] {
  if (!Array.isArray(hours)) return []
  const out: HourlyPreviewPoint[] = []
  for (let i = startIndex; i < hours.length && out.length < count; i++) {
    const h = hours[i]
    const timeLabel = formatLocalClock(h?.time)
    if (!timeLabel) continue
    const code = asNumberish(h?.condition?.code)
    const mapped = mapWeatherCode(code)
    out.push({
      timeLabel,
      temperatureC: asNumberish(h?.temp_c),
      rainProbabilityPct: asNumberish(h?.chance_of_rain),
      conditionLabel: mapped.label,
      emoji: mapped.emoji,
    })
  }
  return out
}

function findHourIndex(hours: WeatherApiHour[] | undefined, now = Date.now()): number {
  if (!Array.isArray(hours) || hours.length === 0) return 0
  // Prefer hour whose local clock matches current local hour when possible.
  const localHour = new Date(now).getHours()
  for (let i = 0; i < hours.length; i++) {
    const label = formatLocalClock(hours[i]?.time)
    if (!label) continue
    const hh = Number(label.slice(0, 2))
    if (hh === localHour) return i
  }
  return 0
}

/**
 * Normalize WeatherAPI forecast.json into RiderWeather.
 * Returns null when response is unusable (no current / no temp).
 */
export function normalizeWeatherApiResponse(
  raw: unknown,
  options: { lat: number; lng: number; fetchedAt?: number; now?: number }
): RiderWeather | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as WeatherApiResponse
  const current = data.current
  if (!current || typeof current !== "object") return null

  const temperatureC = asNumberish(current.temp_c)
  if (temperatureC == null) return null

  const weatherCode = asNumberish(current.condition?.code)
  const mapped = mapWeatherCode(weatherCode)
  const windDirectionDeg = asNumberish(current.wind_degree)

  const day0 = Array.isArray(data.forecast?.forecastday)
    ? data.forecast?.forecastday[0]
    : undefined
  const hours = day0?.hour
  const hourIndex = findHourIndex(hours, options.now ?? Date.now())
  const rainProbabilityPct = asNumberish(hours?.[hourIndex]?.chance_of_rain)

  const base: RiderWeather = {
    fetchedAt: options.fetchedAt ?? Date.now(),
    lat: options.lat,
    lng: options.lng,
    temperatureC,
    feelsLikeC: asNumberish(current.feelslike_c),
    humidityPct: asNumberish(current.humidity),
    windSpeedKmh: asNumberish(current.wind_kph),
    windGustKmh: asNumberish(current.gust_kph),
    windDirectionDeg,
    windDirectionLabel: windDirectionArabic(windDirectionDeg),
    rainProbabilityPct,
    precipitationMm: asNumberish(current.precip_mm),
    visibilityKm: asNumberish(current.vis_km),
    uvIndex: asNumberish(current.uv),
    sunriseLabel: formatWeatherApiClock(day0?.astro?.sunrise),
    sunsetLabel: formatWeatherApiClock(day0?.astro?.sunset),
    conditionLabel: mapped.label,
    conditionEmoji: mapped.emoji,
    weatherCode,
    isDay:
      current.is_day === 1 || current.is_day === true
        ? true
        : current.is_day === 0 || current.is_day === false
          ? false
          : null,
    warnings: [],
    hourly: buildHourlyPreview(hours, hourIndex, 6),
    attribution: "WeatherAPI.com",
  }

  return {
    ...base,
    warnings: deriveRiderWarnings(base),
  }
}
