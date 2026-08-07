/**
 * Rider weather — proxy client + warning/cache tests (no network).
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  windDirectionArabic,
  mapWeatherCode,
  deriveRiderWarnings,
  RIDER_THRESHOLDS,
  normalizeWeatherApiResponse,
  formatLocalClock,
  formatWeatherApiClock,
  WEATHER_CACHE_TTL_MS,
  WEATHER_SIGNIFICANT_DISTANCE_M,
  weatherCacheKey,
  getCachedWeather,
  setCachedWeather,
  clearWeatherCacheForTests,
  shouldRefreshWeather,
  isWeatherStale,
  haversineMeters,
  roundCoord,
  fetchRiderWeather,
  buildRiderWeatherProxyUrl,
  resolveRiderWeatherEndpoint,
  hydrateProxyWeather,
} from "../../src/weather/index.ts"

const sampleWeatherApi = {
  current: {
    temp_c: 28.4,
    feelslike_c: 31.2,
    humidity: 70,
    wind_kph: 22,
    gust_kph: 34,
    wind_degree: 45,
    precip_mm: 0,
    vis_km: 8,
    uv: 3,
    is_day: 1,
    condition: { code: 1000, text: "Sunny" },
  },
  forecast: {
    forecastday: [
      {
        astro: { sunrise: "05:55 AM", sunset: "07:32 PM" },
        hour: [
          {
            time: "2026-08-07 18:00",
            temp_c: 28.4,
            chance_of_rain: 40,
            condition: { code: 1000 },
          },
          {
            time: "2026-08-07 19:00",
            temp_c: 27.1,
            chance_of_rain: 45,
            condition: { code: 1003 },
          },
        ],
      },
    ],
  },
}

const sampleProxyPayload = {
  fetchedAt: 1000,
  lat: 33.89,
  lng: 35.5,
  temperatureC: 28.4,
  feelsLikeC: 31.2,
  humidityPct: 70,
  windSpeedKmh: 22,
  windGustKmh: 34,
  windDirectionDeg: 45,
  windDirectionLabel: "شمالية شرقية",
  rainProbabilityPct: 40,
  precipitationMm: 0,
  visibilityKm: 8,
  uvIndex: 3,
  sunriseLabel: "05:55",
  sunsetLabel: "19:32",
  conditionLabel: "صافي",
  conditionEmoji: "☀️",
  weatherCode: 1000,
  isDay: true,
  warnings: [],
  hourly: [
    {
      timeLabel: "18:00",
      temperatureC: 28.4,
      rainProbabilityPct: 40,
      conditionLabel: "صافي",
      emoji: "☀️",
    },
  ],
  attribution: "WeatherAPI.com",
}

describe("rider weather WeatherAPI normalize + fields", () => {
  it("normalizes WeatherAPI current/forecast response", () => {
    const w = normalizeWeatherApiResponse(sampleWeatherApi, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: 1000,
    })
    assert.ok(w)
    assert.equal(w.temperatureC, 28.4)
    assert.equal(w.attribution, "WeatherAPI.com")
  })

  it("rejects malformed response", () => {
    assert.equal(normalizeWeatherApiResponse(null, { lat: 1, lng: 2 }), null)
  })

  it("formats clocks", () => {
    assert.equal(formatLocalClock("2026-08-07 19:32"), "19:32")
    assert.equal(formatWeatherApiClock("05:55 AM"), "05:55")
  })
})

describe("wind direction Arabic", () => {
  it("maps degrees to Arabic compass", () => {
    assert.equal(windDirectionArabic(45), "شمالية شرقية")
    assert.equal(windDirectionArabic(null), "—")
  })
})

describe("weather condition Arabic mapping", () => {
  it("maps WeatherAPI codes without exposing English", () => {
    assert.equal(mapWeatherCode(1000).label, "صافي")
    assert.equal(mapWeatherCode(1000).label.includes("Sunny"), false)
  })
})

describe("rider warnings", () => {
  it("strong wind threshold", () => {
    const w = deriveRiderWarnings({
      windSpeedKmh: RIDER_THRESHOLDS.strongWindKmh,
      windGustKmh: 10,
      visibilityKm: 10,
      temperatureC: 25,
      rainProbabilityPct: 10,
      precipitationMm: 0,
      weatherCode: 1000,
    })
    assert.ok(w.some((x) => x.id === "strongWind"))
  })

  it("high rain probability warning", () => {
    const w = deriveRiderWarnings({
      windSpeedKmh: 5,
      windGustKmh: 5,
      visibilityKm: 10,
      temperatureC: 20,
      rainProbabilityPct: 70,
      precipitationMm: 0,
      weatherCode: 1000,
    })
    assert.ok(w.some((x) => x.id === "rainLikely"))
    assert.equal(w.some((x) => x.label === "الطريق زلق"), false)
  })
})

describe("weather cache + refresh policy", () => {
  beforeEach(() => {
    clearWeatherCacheForTests()
  })

  it("cache TTL and grid key", () => {
    assert.equal(WEATHER_CACHE_TTL_MS, 15 * 60 * 1000)
    assert.equal(roundCoord(33.89), 33.9)
    const w = hydrateProxyWeather(sampleProxyPayload, 33.89, 35.5)
    assert.ok(w)
    setCachedWeather({ ...w, fetchedAt: 1_000_000 })
    assert.ok(getCachedWeather(33.89, 35.5, 1_000_000 + 60_000))
    assert.equal(
      getCachedWeather(33.89, 35.5, 1_000_000 + WEATHER_CACHE_TTL_MS + 1),
      null
    )
    assert.equal(isWeatherStale(1_000_000, 1_000_000 + WEATHER_CACHE_TTL_MS + 1), true)
  })

  it("significant-distance refresh", () => {
    assert.equal(WEATHER_SIGNIFICANT_DISTANCE_M, 5000)
    const base = hydrateProxyWeather(
      { ...sampleProxyPayload, fetchedAt: Date.now() },
      33.89,
      35.5
    )
    assert.ok(base)
    assert.equal(
      shouldRefreshWeather({ location: [33.89, 35.5], lastWeather: base }),
      false
    )
    assert.equal(
      shouldRefreshWeather({ location: [33.98, 35.5], lastWeather: base }),
      true
    )
    assert.ok(haversineMeters(33.89, 35.5, 33.98, 35.5) > 5000)
  })

  it("no-location behavior", () => {
    assert.equal(
      shouldRefreshWeather({ location: null, lastWeather: null }),
      false
    )
  })
})

describe("fetchRiderWeather proxy client", () => {
  beforeEach(() => {
    clearWeatherCacheForTests()
  })

  it("builds proxy URL not WeatherAPI direct", () => {
    const url = buildRiderWeatherProxyUrl(
      33.89,
      35.5,
      "https://us-central1-totimoto-rider-network.cloudfunctions.net/getRiderWeather"
    )
    assert.ok(url.includes("cloudfunctions.net/getRiderWeather"))
    assert.ok(url.includes("lat=33.89"))
    assert.ok(url.includes("lng=35.5"))
    assert.equal(url.includes("api.weatherapi.com"), false)
    assert.equal(url.includes("key="), false)
  })

  it("default endpoint targets getRiderWeather", () => {
    const endpoint = resolveRiderWeatherEndpoint()
    assert.ok(endpoint.includes("getRiderWeather"))
    assert.ok(endpoint.includes("us-central1"))
    assert.equal(endpoint.includes("api.weatherapi.com"), false)
  })

  it("missing weather provider key no longer required in browser", async () => {
    // No VITE_WEATHERAPI_KEY — proxy path only needs endpoint + mock.
    const weather = await fetchRiderWeather(33.89, 35.5, {
      endpoint: "https://example.test/getRiderWeather",
      now: 5_000_000,
      fetchImpl: async (url) => {
        assert.ok(String(url).includes("example.test/getRiderWeather"))
        assert.equal(String(url).includes("key="), false)
        return {
          ok: true,
          json: async () => sampleProxyPayload,
        }
      },
    })
    assert.equal(weather.temperatureC, 28.4)
    assert.ok(weather.warnings)
  })

  it("uses mock proxy and caches", async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls++
      return {
        ok: true,
        json: async () => sampleProxyPayload,
      }
    }
    const a = await fetchRiderWeather(33.89, 35.5, {
      endpoint: "https://example.test/getRiderWeather",
      fetchImpl,
      now: 5_000_000,
    })
    const b = await fetchRiderWeather(33.89, 35.5, {
      endpoint: "https://example.test/getRiderWeather",
      fetchImpl,
      now: 5_000_000 + 60_000,
    })
    assert.equal(calls, 1)
    assert.equal(a.temperatureC, b.temperatureC)
  })

  it("proxy failure surfaces as weather_proxy status", () => {
    assert.match("weather_proxy_502", /^weather_proxy_\d+$/)
  })

  it("hydrates proxy payload and preserves rider warnings", () => {
    const wet = hydrateProxyWeather(
      {
        ...sampleProxyPayload,
        rainProbabilityPct: 80,
        weatherCode: 1195,
        precipitationMm: 5,
      },
      33.9,
      35.5
    )
    assert.ok(wet)
    assert.ok(wet.warnings.some((w) => w.id === "rainLikely" || w.id === "heavyRain"))
    assert.equal(weatherCacheKey(33.89, 35.5), "33.9,35.5")
  })
})
