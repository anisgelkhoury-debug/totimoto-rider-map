/**
 * Open-Meteo client — browser-direct, coordinates only.
 *
 * Free endpoint: api.open-meteo.com (non-commercial terms).
 * Commercial: set VITE_OPEN_METEO_API_KEY → customer-api.open-meteo.com
 *
 * Transmitted externally: latitude, longitude, requested weather fields.
 * Never: UID, deviceId, name, phone.
 */

import { normalizeOpenMeteoResponse } from "./normalizeOpenMeteo.ts"
import type { RiderWeather } from "./types.ts"
import {
  getCachedWeather,
  getInflight,
  setCachedWeather,
  setInflight,
  weatherCacheKey,
} from "./weatherCache.ts"

const FETCH_TIMEOUT_MS = 10000

const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "precipitation",
  "rain",
  "visibility",
  "uv_index",
  "is_day",
].join(",")

const HOURLY_FIELDS = [
  "temperature_2m",
  "precipitation_probability",
  "weather_code",
].join(",")

function resolveEndpoint(): { base: string; apiKey: string } {
  const apiKey =
    typeof import.meta !== "undefined" && import.meta.env?.VITE_OPEN_METEO_API_KEY
      ? String(import.meta.env.VITE_OPEN_METEO_API_KEY).trim()
      : ""
  if (apiKey) {
    return {
      base: "https://customer-api.open-meteo.com/v1/forecast",
      apiKey,
    }
  }
  return {
    base: "https://api.open-meteo.com/v1/forecast",
    apiKey: "",
  }
}

export function buildOpenMeteoUrl(lat: number, lng: number): string {
  const { base, apiKey } = resolveEndpoint()
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    current: CURRENT_FIELDS,
    hourly: HOURLY_FIELDS,
    daily: "sunrise,sunset",
    timezone: "auto",
    forecast_days: "1",
    wind_speed_unit: "kmh",
  })
  if (apiKey) params.set("apikey", apiKey)
  return `${base}?${params.toString()}`
}

export async function fetchOpenMeteoWeather(
  lat: number,
  lng: number,
  options: { force?: boolean; now?: number; fetchImpl?: typeof fetch } = {}
): Promise<RiderWeather> {
  const now = options.now ?? Date.now()
  if (!options.force) {
    const cached = getCachedWeather(lat, lng, now)
    if (cached) return cached
  }

  const key = weatherCacheKey(lat, lng)
  if (!options.force) {
    const existing = getInflight(key)
    if (existing) return existing
  }

  const fetchImpl = options.fetchImpl ?? fetch

  const promise = (async (): Promise<RiderWeather> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetchImpl(buildOpenMeteoUrl(lat, lng), {
        signal: controller.signal,
        method: "GET",
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        throw new Error(`weather_http_${res.status}`)
      }
      const json = await res.json()
      const weather = normalizeOpenMeteoResponse(json, {
        lat,
        lng,
        fetchedAt: now,
      })
      if (!weather) throw new Error("weather_malformed")
      setCachedWeather(weather)
      return weather
    } finally {
      clearTimeout(timer)
    }
  })()

  // Deduplicate concurrent success-path callers for the same grid cell.
  setInflight(key, promise)
  return promise
}
