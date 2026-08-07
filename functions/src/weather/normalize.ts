import {
  deriveRiderWarnings,
  mapWeatherCode,
  windDirectionArabic,
} from "./labels"

function asNumberish(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function formatLocalClock(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (/^\d{2}:\d{2}$/.test(trimmed)) return trimmed
  const space = trimmed.match(/\b(\d{2}:\d{2})\b/)
  return space ? space[1] : null
}

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

type Hour = {
  time?: unknown
  temp_c?: unknown
  chance_of_rain?: unknown
  condition?: { code?: unknown }
}

const HOURLY_LIMIT = 6

function buildHourly(hours: Hour[] | undefined, startIndex: number) {
  if (!Array.isArray(hours)) return []
  const out: Array<Record<string, unknown>> = []
  for (let i = startIndex; i < hours.length && out.length < HOURLY_LIMIT; i++) {
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

function findHourIndex(hours: Hour[] | undefined, now: number): number {
  if (!Array.isArray(hours) || hours.length === 0) return 0
  const localHour = new Date(now).getHours()
  for (let i = 0; i < hours.length; i++) {
    const label = formatLocalClock(hours[i]?.time)
    if (!label) continue
    if (Number(label.slice(0, 2)) === localHour) return i
  }
  return 0
}

/**
 * Normalize WeatherAPI forecast into TRN rider weather payload.
 * Never includes API key or raw provider dumps.
 */
export function normalizeProviderForecast(
  raw: unknown,
  options: { lat: number; lng: number; fetchedAt: number; now?: number }
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as {
    current?: Record<string, unknown> & {
      condition?: { code?: unknown }
    }
    forecast?: {
      forecastday?: Array<{
        astro?: { sunrise?: unknown; sunset?: unknown }
        hour?: Hour[]
      }>
    }
  }
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
  const hourIndex = findHourIndex(hours, options.now ?? options.fetchedAt)
  const rainProbabilityPct = asNumberish(hours?.[hourIndex]?.chance_of_rain)

  const base = {
    fetchedAt: options.fetchedAt,
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
    hourly: buildHourly(hours, hourIndex),
    attribution: "WeatherAPI.com",
  }

  return {
    ...base,
    warnings: deriveRiderWarnings({
      windSpeedKmh: base.windSpeedKmh,
      windGustKmh: base.windGustKmh,
      visibilityKm: base.visibilityKm,
      temperatureC: base.temperatureC,
      rainProbabilityPct: base.rainProbabilityPct,
      precipitationMm: base.precipitationMm,
      weatherCode: base.weatherCode,
    }),
  }
}

/** Strip any accidental secret-like keys before responding. */
export function sanitizeWeatherPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const forbidden = ["key", "apiKey", "apikey", "WEATHERAPI_KEY", "token", "secret"]
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(payload)) {
    if (forbidden.includes(k)) continue
    out[k] = v
  }
  return out
}
