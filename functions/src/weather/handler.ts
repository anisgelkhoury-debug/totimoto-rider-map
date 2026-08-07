/**
 * Pure getRiderWeather handler — testable without Firebase runtime.
 */

import { WeatherServerCache, weatherServerCache } from "./cache"
import { normalizeProviderForecast, sanitizeWeatherPayload } from "./normalize"
import { validateRiderWeatherCoords, weatherGridKey } from "./validate"

const UPSTREAM_TIMEOUT_MS = 8000
const WEATHERAPI_URL = "https://api.weatherapi.com/v1/forecast.json"

export type RiderWeatherHandlerResult = {
  status: number
  body: Record<string, unknown>
}

export type RiderWeatherHandlerDeps = {
  apiKey: string
  fetchImpl?: typeof fetch
  now?: number
  cache?: WeatherServerCache
  skipCache?: boolean
}

export async function handleGetRiderWeather(
  latRaw: unknown,
  lngRaw: unknown,
  deps: RiderWeatherHandlerDeps
): Promise<RiderWeatherHandlerResult> {
  const parsed = validateRiderWeatherCoords(latRaw, lngRaw)
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } }
  }

  const { lat, lng } = parsed.coords
  const now = deps.now ?? Date.now()
  const cache = deps.cache ?? weatherServerCache
  const gridKey = weatherGridKey(lat, lng)

  if (!deps.skipCache) {
    const hit = cache.get(gridKey, now)
    if (hit) {
      return {
        status: 200,
        body: { ...sanitizeWeatherPayload(hit), cached: true },
      }
    }
  }

  const apiKey = typeof deps.apiKey === "string" ? deps.apiKey.trim() : ""
  if (!apiKey) {
    return { status: 503, body: { error: "weather_unavailable" } }
  }

  const fetchImpl = deps.fetchImpl ?? fetch
  const url = new URL(WEATHERAPI_URL)
  url.searchParams.set("key", apiKey)
  url.searchParams.set("q", `${lat},${lng}`)
  url.searchParams.set("days", "1")
  url.searchParams.set("aqi", "no")
  url.searchParams.set("alerts", "no")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const res = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
    if (!res.ok) {
      return { status: 502, body: { error: "weather_upstream_failed" } }
    }
    let json: unknown
    try {
      json = await res.json()
    } catch {
      return { status: 502, body: { error: "weather_upstream_failed" } }
    }

    const normalized = normalizeProviderForecast(json, {
      lat,
      lng,
      fetchedAt: now,
      now,
    })
    if (!normalized) {
      return { status: 502, body: { error: "weather_malformed" } }
    }

    const payload = sanitizeWeatherPayload(normalized)
    cache.set(gridKey, payload, now)
    return { status: 200, body: { ...payload, cached: false } }
  } catch (err: unknown) {
    const name =
      typeof err === "object" && err && "name" in err
        ? String((err as { name?: unknown }).name)
        : ""
    if (name === "AbortError") {
      return { status: 504, body: { error: "weather_timeout" } }
    }
    return { status: 502, body: { error: "weather_upstream_failed" } }
  } finally {
    clearTimeout(timer)
  }
}
