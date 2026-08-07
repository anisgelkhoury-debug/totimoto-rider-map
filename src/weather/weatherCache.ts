/**
 * In-memory weather cache + refresh policy.
 * No Firestore. Coordinates only rounded for cache key.
 */

import type { RiderWeather, WeatherCacheEntry } from "./types.ts"

/** ~15 minutes current-conditions TTL. */
export const WEATHER_CACHE_TTL_MS = 15 * 60 * 1000

/** Refetch when rider moves ~5 km. */
export const WEATHER_SIGNIFICANT_DISTANCE_M = 5000

/** Round to ~0.05° (~5 km) grid cells. */
export const WEATHER_GRID_DECIMALS = 1

const cache = new Map<string, WeatherCacheEntry>()
const inflight = new Map<string, Promise<RiderWeather>>()

export function roundCoord(value: number, decimals = WEATHER_GRID_DECIMALS): number {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

export function weatherCacheKey(lat: number, lng: number): string {
  return `${roundCoord(lat)},${roundCoord(lng)}`
}

export function clearWeatherCacheForTests(): void {
  cache.clear()
  inflight.clear()
}

export function getCachedWeather(
  lat: number,
  lng: number,
  now = Date.now()
): RiderWeather | null {
  const key = weatherCacheKey(lat, lng)
  const entry = cache.get(key)
  if (!entry) return null
  if (now - entry.fetchedAt > WEATHER_CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.weather
}

export function setCachedWeather(weather: RiderWeather): void {
  const key = weatherCacheKey(weather.lat, weather.lng)
  cache.set(key, { key, fetchedAt: weather.fetchedAt, weather })
}

export function getInflight(key: string): Promise<RiderWeather> | undefined {
  return inflight.get(key)
}

export function setInflight(key: string, promise: Promise<RiderWeather>): void {
  inflight.set(key, promise)
  promise.finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key)
  })
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export function isWeatherStale(fetchedAt: number, now = Date.now()): boolean {
  return now - fetchedAt > WEATHER_CACHE_TTL_MS
}

export function shouldRefreshWeather(options: {
  location: [number, number] | null
  lastWeather: RiderWeather | null
  now?: number
  force?: boolean
}): boolean {
  const { location, lastWeather, force = false } = options
  const now = options.now ?? Date.now()
  if (!location) return false
  if (force) return true
  if (!lastWeather) return true
  if (isWeatherStale(lastWeather.fetchedAt, now)) return true
  const moved = haversineMeters(
    lastWeather.lat,
    lastWeather.lng,
    location[0],
    location[1]
  )
  return moved >= WEATHER_SIGNIFICANT_DISTANCE_M
}
