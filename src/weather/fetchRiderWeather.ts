/**
 * Client fetch for rider weather via secure HTTPS proxy (getRiderWeather).
 * Browser sends only lat/lng. Never holds WEATHERAPI_KEY.
 */

import { firebaseConfig } from "../firebaseConfig.ts"
import { deriveRiderWarnings } from "./riderWarnings.ts"
import type { RiderWeather, WindDirectionArabic } from "./types.ts"
import {
  getCachedWeather,
  getInflight,
  setCachedWeather,
  setInflight,
  weatherCacheKey,
} from "./weatherCache.ts"

const FETCH_TIMEOUT_MS = 12000

export function resolveRiderWeatherEndpoint(): string {
  if (typeof import.meta !== "undefined") {
    const override = import.meta.env?.VITE_WEATHER_PROXY_URL
    if (typeof override === "string" && override.trim()) {
      return override.trim().replace(/\/$/, "")
    }
  }
  return `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net/getRiderWeather`
}

export function buildRiderWeatherProxyUrl(
  lat: number,
  lng: number,
  endpoint = resolveRiderWeatherEndpoint()
): string {
  const url = new URL(endpoint)
  url.searchParams.set("lat", String(lat))
  url.searchParams.set("lng", String(lng))
  return url.toString()
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return null
}

function asWindLabel(value: unknown): WindDirectionArabic {
  const allowed: WindDirectionArabic[] = [
    "شمالية",
    "شمالية شرقية",
    "شرقية",
    "جنوبية شرقية",
    "جنوبية",
    "جنوبية غربية",
    "غربية",
    "شمالية غربية",
    "—",
  ]
  return allowed.includes(value as WindDirectionArabic)
    ? (value as WindDirectionArabic)
    : "—"
}

/** Hydrate proxy JSON into RiderWeather; re-apply client warning engine. */
export function hydrateProxyWeather(
  raw: unknown,
  fallbackLat: number,
  fallbackLng: number
): RiderWeather | null {
  if (!raw || typeof raw !== "object") return null
  const data = raw as Record<string, unknown>
  const temperatureC = asFiniteNumber(data.temperatureC)
  if (temperatureC == null) return null

  const hourlyRaw = Array.isArray(data.hourly) ? data.hourly : []
  const hourly = hourlyRaw
    .map((h) => {
      if (!h || typeof h !== "object") return null
      const row = h as Record<string, unknown>
      if (typeof row.timeLabel !== "string") return null
      return {
        timeLabel: row.timeLabel,
        temperatureC: asFiniteNumber(row.temperatureC),
        rainProbabilityPct: asFiniteNumber(row.rainProbabilityPct),
        conditionLabel:
          typeof row.conditionLabel === "string" ? row.conditionLabel : "—",
        emoji: typeof row.emoji === "string" ? row.emoji : "🌡️",
      }
    })
    .filter(Boolean) as RiderWeather["hourly"]

  const base: RiderWeather = {
    fetchedAt:
      asFiniteNumber(data.fetchedAt) ?? Date.now(),
    lat: asFiniteNumber(data.lat) ?? fallbackLat,
    lng: asFiniteNumber(data.lng) ?? fallbackLng,
    temperatureC,
    feelsLikeC: asFiniteNumber(data.feelsLikeC),
    humidityPct: asFiniteNumber(data.humidityPct),
    windSpeedKmh: asFiniteNumber(data.windSpeedKmh),
    windGustKmh: asFiniteNumber(data.windGustKmh),
    windDirectionDeg: asFiniteNumber(data.windDirectionDeg),
    windDirectionLabel: asWindLabel(data.windDirectionLabel),
    rainProbabilityPct: asFiniteNumber(data.rainProbabilityPct),
    precipitationMm: asFiniteNumber(data.precipitationMm),
    visibilityKm: asFiniteNumber(data.visibilityKm),
    uvIndex: asFiniteNumber(data.uvIndex),
    sunriseLabel:
      typeof data.sunriseLabel === "string" ? data.sunriseLabel : null,
    sunsetLabel: typeof data.sunsetLabel === "string" ? data.sunsetLabel : null,
    conditionLabel:
      typeof data.conditionLabel === "string" ? data.conditionLabel : "غير متوفر",
    conditionEmoji:
      typeof data.conditionEmoji === "string" ? data.conditionEmoji : "🌡️",
    weatherCode: asFiniteNumber(data.weatherCode),
    isDay:
      data.isDay === true ? true : data.isDay === false ? false : null,
    warnings: [],
    hourly,
    attribution:
      typeof data.attribution === "string" ? data.attribution : "WeatherAPI.com",
  }

  return {
    ...base,
    warnings: deriveRiderWarnings(base),
  }
}

export async function fetchRiderWeather(
  lat: number,
  lng: number,
  options: {
    force?: boolean
    now?: number
    fetchImpl?: typeof fetch
    endpoint?: string
  } = {}
): Promise<RiderWeather> {
  const now = options.now ?? Date.now()
  if (!options.force) {
    const cached = getCachedWeather(lat, lng, now)
    if (cached) return cached
  }

  const cacheKey = weatherCacheKey(lat, lng)
  if (!options.force) {
    const existing = getInflight(cacheKey)
    if (existing) return existing
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const endpoint = options.endpoint ?? resolveRiderWeatherEndpoint()

  const shared: Promise<RiderWeather> = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetchImpl(buildRiderWeatherProxyUrl(lat, lng, endpoint), {
        signal: controller.signal,
        method: "GET",
        headers: { Accept: "application/json" },
      })
      if (!res.ok) {
        throw new Error(`weather_proxy_${res.status}`)
      }
      const json = await res.json()
      const weather = hydrateProxyWeather(json, lat, lng)
      if (!weather) throw new Error("weather_malformed")
      const stamped = { ...weather, fetchedAt: now }
      setCachedWeather(stamped)
      return stamped
    } finally {
      clearTimeout(timer)
    }
  })()

  setInflight(cacheKey, shared)
  return shared
}
