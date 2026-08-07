/**
 * getRiderWeather Function unit tests (mocked upstream, no network).
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { WeatherServerCache } from "../weather/cache"
import { handleGetRiderWeather } from "../weather/handler"
import {
  formatWeatherApiClock,
  normalizeProviderForecast,
  sanitizeWeatherPayload,
} from "../weather/normalize"
import { validateRiderWeatherCoords, weatherGridKey } from "../weather/validate"

const sampleProvider = {
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
        hour: Array.from({ length: 10 }, (_, i) => ({
          time: `2026-08-07 ${String(18 + (i % 6)).padStart(2, "0")}:00`,
          temp_c: 28 - i * 0.5,
          chance_of_rain: 40 + i,
          condition: { code: 1000 },
        })),
      },
    ],
  },
}

describe("getRiderWeather validate", () => {
  it("accepts valid coordinates", () => {
    const r = validateRiderWeatherCoords(33.89, 35.5)
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.coords.lat, 33.89)
      assert.equal(r.coords.lng, 35.5)
    }
  })

  it("rejects invalid latitude", () => {
    assert.equal(validateRiderWeatherCoords(91, 35).ok, false)
    assert.equal(validateRiderWeatherCoords("nan", 35).ok, false)
  })

  it("rejects invalid longitude", () => {
    assert.equal(validateRiderWeatherCoords(33, 200).ok, false)
  })

  it("rejects missing coordinates", () => {
    assert.equal(validateRiderWeatherCoords(undefined, 35).ok, false)
    assert.equal(validateRiderWeatherCoords(33, null).ok, false)
    assert.equal(validateRiderWeatherCoords("", "").ok, false)
  })
})

describe("getRiderWeather normalize", () => {
  it("normalizes provider success payload", () => {
    const n = normalizeProviderForecast(sampleProvider, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: 1000,
      now: 1000,
    })
    assert.ok(n)
    assert.equal(n.temperatureC, 28.4)
    assert.equal(n.feelsLikeC, 31.2)
    assert.equal(n.humidityPct, 70)
    assert.equal(n.windSpeedKmh, 22)
    assert.equal(n.windGustKmh, 34)
    assert.equal(n.windDirectionLabel, "شمالية شرقية")
    assert.equal(n.visibilityKm, 8)
    assert.equal(n.uvIndex, 3)
    assert.equal(n.sunriseLabel, "05:55")
    assert.equal(n.sunsetLabel, "19:32")
    assert.equal(n.conditionLabel, "صافي")
    assert.ok(Array.isArray(n.hourly))
    assert.ok((n.hourly as unknown[]).length <= 6)
    assert.equal(n.attribution, "WeatherAPI.com")
  })

  it("truncates hourly preview", () => {
    const n = normalizeProviderForecast(sampleProvider, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: 1,
    })
    assert.ok(n)
    assert.ok((n.hourly as unknown[]).length <= 6)
  })

  it("rejects malformed provider response", () => {
    assert.equal(
      normalizeProviderForecast({ current: {} }, { lat: 1, lng: 2, fetchedAt: 1 }),
      null
    )
  })

  it("formats sunrise clocks", () => {
    assert.equal(formatWeatherApiClock("06:12 AM"), "06:12")
    assert.equal(formatWeatherApiClock("07:32 PM"), "19:32")
  })

  it("sanitizes secrets from payload", () => {
    const clean = sanitizeWeatherPayload({
      temperatureC: 20,
      key: "secret",
      apiKey: "x",
      WEATHERAPI_KEY: "y",
    })
    assert.equal(clean.temperatureC, 20)
    assert.equal("key" in clean, false)
    assert.equal("apiKey" in clean, false)
    assert.equal("WEATHERAPI_KEY" in clean, false)
  })
})

describe("getRiderWeather handler", () => {
  let cache: WeatherServerCache

  beforeEach(() => {
    cache = new WeatherServerCache()
  })

  it("returns 400 for invalid latitude", async () => {
    const r = await handleGetRiderWeather(999, 35, {
      apiKey: "test",
      cache,
    })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, "invalid_latitude")
  })

  it("returns 400 for missing coordinates", async () => {
    const r = await handleGetRiderWeather(undefined, undefined, {
      apiKey: "test",
      cache,
    })
    assert.equal(r.status, 400)
    assert.equal(r.body.error, "missing_coordinates")
  })

  it("WeatherAPI success path", async () => {
    const r = await handleGetRiderWeather(33.89, 35.5, {
      apiKey: "test-key",
      cache,
      now: 5_000_000,
      fetchImpl: async (url) => {
        assert.ok(String(url).includes("api.weatherapi.com"))
        assert.ok(String(url).includes("key=test-key"))
        assert.ok(String(url).includes("days=1"))
        return {
          ok: true,
          json: async () => sampleProvider,
        } as Response
      },
    })
    assert.equal(r.status, 200)
    assert.equal(r.body.temperatureC, 28.4)
    assert.equal(r.body.cached, false)
    assert.equal("key" in r.body, false)
    assert.equal("apiKey" in r.body, false)
    assert.equal("WEATHERAPI_KEY" in r.body, false)
    const bodyStr = JSON.stringify(r.body)
    assert.equal(bodyStr.includes("test-key"), false)
  })

  it("provider failure", async () => {
    const r = await handleGetRiderWeather(33.8, 35.4, {
      apiKey: "test-key",
      cache,
      now: 6_000_000,
      fetchImpl: async () => ({ ok: false, status: 403 }) as Response,
    })
    assert.equal(r.status, 502)
    assert.equal(r.body.error, "weather_upstream_failed")
  })

  it("timeout", async () => {
    const r = await handleGetRiderWeather(33.7, 35.3, {
      apiKey: "test-key",
      cache,
      now: 7_000_000,
      fetchImpl: async (_url, init) => {
        const err = new Error("aborted")
        err.name = "AbortError"
        // Simulate abort by checking signal briefly then throwing AbortError
        void init
        throw err
      },
    })
    assert.equal(r.status, 504)
    assert.equal(r.body.error, "weather_timeout")
  })

  it("malformed provider response", async () => {
    const r = await handleGetRiderWeather(33.6, 35.2, {
      apiKey: "test-key",
      cache,
      now: 8_000_000,
      fetchImpl: async () =>
        ({
          ok: true,
          json: async () => ({ current: { condition: { code: 1000 } } }),
        }) as Response,
    })
    assert.equal(r.status, 502)
    assert.equal(r.body.error, "weather_malformed")
  })

  it("cache hit behavior", async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls++
      return {
        ok: true,
        json: async () => sampleProvider,
      } as Response
    }
    const a = await handleGetRiderWeather(33.89, 35.5, {
      apiKey: "k",
      cache,
      now: 9_000_000,
      fetchImpl,
    })
    const b = await handleGetRiderWeather(33.89, 35.5, {
      apiKey: "k",
      cache,
      now: 9_000_000 + 60_000,
      fetchImpl,
    })
    assert.equal(a.status, 200)
    assert.equal(b.status, 200)
    assert.equal(calls, 1)
    assert.equal(b.body.cached, true)
    assert.equal(weatherGridKey(33.89, 35.5), weatherGridKey(33.91, 35.49))
  })

  it("missing server key returns unavailable", async () => {
    const r = await handleGetRiderWeather(33.5, 35.1, {
      apiKey: "",
      cache,
    })
    assert.equal(r.status, 503)
    assert.equal(r.body.error, "weather_unavailable")
  })
})
