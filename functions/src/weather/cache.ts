/**
 * In-memory weather cache for warm Function instances.
 * Cold starts start empty — documented limitation.
 */

export type CachedWeatherPayload = {
  fetchedAt: number
  payload: Record<string, unknown>
}

export const SERVER_WEATHER_CACHE_TTL_MS = 15 * 60 * 1000

export class WeatherServerCache {
  private readonly store = new Map<string, CachedWeatherPayload>()

  get(key: string, now = Date.now()): Record<string, unknown> | null {
    const hit = this.store.get(key)
    if (!hit) return null
    if (now - hit.fetchedAt > SERVER_WEATHER_CACHE_TTL_MS) {
      this.store.delete(key)
      return null
    }
    return hit.payload
  }

  set(key: string, payload: Record<string, unknown>, fetchedAt = Date.now()): void {
    this.store.set(key, { fetchedAt, payload })
  }

  clear(): void {
    this.store.clear()
  }

  get size(): number {
    return this.store.size
  }
}

/** Process-local singleton (per warm instance). */
export const weatherServerCache = new WeatherServerCache()
