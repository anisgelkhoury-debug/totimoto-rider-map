/**
 * WeatherAPI.com client — coordinates + API key only.
 *
 * Endpoint: GET https://api.weatherapi.com/v1/forecast.json
 *   ?key=…&q=lat,lng&days=1&aqi=no&alerts=no
 *
 * SECURITY:
 * - VITE_WEATHERAPI_KEY is embedded in the client bundle if set.
 * - WeatherAPI.com does not offer domain/referrer key restrictions.
 * - Production should prefer a minimal server proxy that holds the key.
 * - This module stays adapter-clean for either direct (local/dev) or future proxy.
 *
 * Transmitted externally: latitude, longitude, requested forecast fields, API key (if direct).
 * Never: UID, deviceId, name, phone.
 */

import { normalizeWeatherApiResponse } from "./normalizeWeatherApi.ts"
import type { RiderWeather } from "./types.ts"
import {
  getCachedWeather,
  getInflight,
  setCachedWeather,
  setInflight,
  weatherCacheKey,
} from "./weatherCache.ts"

const FETCH_TIMEOUT_MS = 10000
const WEATHERAPI_FORECAST_URL = "https://api.weatherapi.com/v1/forecast.json"

export function getWeatherApiKey(): string {
  if (typeof import.meta === "undefined") return ""
  const raw = import.meta.env?.VITE_WEATHERAPI_KEY
  return typeof raw === "string" ? raw.trim() : ""
}

export function buildWeatherApiUrl(lat: number, lng: number, apiKey: string): string {
  const params = new URLSearchParams({
    key: apiKey,
    q: `${lat},${lng}`,
    days: "1",
    aqi: "no",
    alerts: "no",
  })
  return `${WEATHERAPI_FORECAST_URL}?${params.toString()}`
}

export async function fetchWeatherApiWeather(
  lat: number,
  lng: number,
  options: {
    force?: boolean
    now?: number
    fetchImpl?: typeof fetch
    /** Test/local override; production uses VITE_WEATHERAPI_KEY. */
    apiKey?: string
  } = {}
): Promise<RiderWeather> {
  const now = options.now ?? Date.now()
  if (!options.force) {
    const cached = getCachedWeather(lat, lng, now)
    if (cached) return cached
  }

  const apiKey =
    typeof options.apiKey === "string" ? options.apiKey.trim() : getWeatherApiKey()
  if (!apiKey) {
    throw new Error("weather_missing_key")
  }

  const cacheKey = weatherCacheKey(lat, lng)
  if (!options.force) {
    const existing = getInflight(cacheKey)
    if (existing) return existing
  }

  const fetchImpl = options.fetchImpl ?? fetch

  const shared: Promise<RiderWeather> = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetchImpl(buildWeatherApiUrl(lat, lng, apiKey), {
        signal: controller.signal,
        method: "GET",
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        throw new Error(`weather_http_${res.status}`)
      }
      const json = await res.json()
      const weather = normalizeWeatherApiResponse(json, {
        lat,
        lng,
        fetchedAt: now,
        now,
      })
      if (!weather) throw new Error("weather_malformed")
      setCachedWeather(weather)
      return weather
    } finally {
      clearTimeout(timer)
    }
  })()

  setInflight(cacheKey, shared)
  return shared
}
