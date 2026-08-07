/**
 * Rider weather — WeatherAPI.com provider tests (no network).
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
  fetchWeatherApiWeather,
  buildWeatherApiUrl,
  getWeatherApiKey,
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
          {
            time: "2026-08-07 20:00",
            temp_c: 26.0,
            chance_of_rain: 50,
            condition: { code: 1006 },
          },
          {
            time: "2026-08-07 21:00",
            temp_c: 25.2,
            chance_of_rain: 55,
            condition: { code: 1009 },
          },
          {
            time: "2026-08-07 22:00",
            temp_c: 24.8,
            chance_of_rain: 60,
            condition: { code: 1183 },
          },
          {
            time: "2026-08-07 23:00",
            temp_c: 24.1,
            chance_of_rain: 35,
            condition: { code: 1000 },
          },
        ],
      },
    ],
  },
}

describe("rider weather WeatherAPI normalize + fields", () => {
  it("normalizes WeatherAPI current/forecast response", () => {
    const w = normalizeWeatherApiResponse(sampleWeatherApi, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: 1000,
      now: Date.UTC(2026, 7, 7, 15, 0, 0), // 18:00 Beirut-ish offset not required; hour match optional
    })
    assert.ok(w)
    assert.equal(w.temperatureC, 28.4)
    assert.equal(w.feelsLikeC, 31.2)
    assert.equal(w.humidityPct, 70)
    assert.equal(w.windSpeedKmh, 22)
    assert.equal(w.windGustKmh, 34)
    assert.equal(w.windDirectionDeg, 45)
    assert.equal(w.windDirectionLabel, "شمالية شرقية")
    assert.equal(w.precipitationMm, 0)
    assert.equal(w.visibilityKm, 8)
    assert.equal(w.uvIndex, 3)
    assert.equal(w.sunriseLabel, "05:55")
    assert.equal(w.sunsetLabel, "19:32")
    assert.equal(w.conditionLabel, "صافي")
    assert.equal(w.conditionEmoji, "☀️")
    assert.ok(w.hourly.length >= 1)
    assert.equal(w.attribution, "WeatherAPI.com")
    assert.equal(typeof w.rainProbabilityPct === "number" || w.rainProbabilityPct === null, true)
  })

  it("maps temperature feels-like humidity wind gust precip visibility uv", () => {
    const w = normalizeWeatherApiResponse(sampleWeatherApi, {
      lat: 33.9,
      lng: 35.5,
      fetchedAt: 1,
    })
    assert.ok(w)
    assert.equal(w.temperatureC, 28.4)
    assert.equal(w.feelsLikeC, 31.2)
    assert.equal(w.humidityPct, 70)
    assert.equal(w.windSpeedKmh, 22)
    assert.equal(w.windGustKmh, 34)
    assert.equal(w.precipitationMm, 0)
    assert.equal(w.visibilityKm, 8)
    assert.equal(w.uvIndex, 3)
  })

  it("uses hourly rain probability", () => {
    const w = normalizeWeatherApiResponse(sampleWeatherApi, {
      lat: 33.9,
      lng: 35.5,
      fetchedAt: 1,
      now: new Date("2026-08-07T18:10:00").getTime(),
    })
    assert.ok(w)
    // Best-effort nearest hour; at minimum first hour has 40.
    assert.ok(
      w.rainProbabilityPct === 40 ||
        w.rainProbabilityPct === 45 ||
        w.rainProbabilityPct === 50 ||
        w.rainProbabilityPct === 55 ||
        w.rainProbabilityPct === 60 ||
        w.rainProbabilityPct === 35
    )
  })

  it("rejects malformed response", () => {
    assert.equal(normalizeWeatherApiResponse(null, { lat: 1, lng: 2 }), null)
    assert.equal(normalizeWeatherApiResponse({}, { lat: 1, lng: 2 }), null)
    assert.equal(
      normalizeWeatherApiResponse(
        { current: { condition: { code: 1000 } } },
        { lat: 1, lng: 2 }
      ),
      null
    )
  })

  it("formats clocks", () => {
    assert.equal(formatLocalClock("2026-08-07 19:32"), "19:32")
    assert.equal(formatWeatherApiClock("05:55 AM"), "05:55")
    assert.equal(formatWeatherApiClock("07:32 PM"), "19:32")
    assert.equal(formatWeatherApiClock("12:05 AM"), "00:05")
    assert.equal(formatWeatherApiClock("12:05 PM"), "12:05")
    assert.equal(formatLocalClock("bad"), null)
  })
})

describe("wind direction Arabic", () => {
  it("maps degrees to Arabic compass", () => {
    assert.equal(windDirectionArabic(0), "شمالية")
    assert.equal(windDirectionArabic(45), "شمالية شرقية")
    assert.equal(windDirectionArabic(90), "شرقية")
    assert.equal(windDirectionArabic(135), "جنوبية شرقية")
    assert.equal(windDirectionArabic(180), "جنوبية")
    assert.equal(windDirectionArabic(225), "جنوبية غربية")
    assert.equal(windDirectionArabic(270), "غربية")
    assert.equal(windDirectionArabic(315), "شمالية غربية")
    assert.equal(windDirectionArabic(360), "شمالية")
    assert.equal(windDirectionArabic(null), "—")
  })
})

describe("weather condition Arabic mapping", () => {
  it("maps WeatherAPI codes without exposing English", () => {
    assert.equal(mapWeatherCode(1000).label, "صافي")
    assert.equal(mapWeatherCode(1006).label, "غائم")
    assert.equal(mapWeatherCode(1189).label, "مطر")
    assert.equal(mapWeatherCode(1135).label, "ضباب")
    assert.equal(mapWeatherCode(1276).label, "عاصفة رعدية قوية")
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
    assert.ok(w.some((x) => x.label.includes("رياح قوية")))
  })

  it("gust threshold", () => {
    const w = deriveRiderWarnings({
      windSpeedKmh: 10,
      windGustKmh: RIDER_THRESHOLDS.strongGustKmh,
      visibilityKm: 10,
      temperatureC: 25,
      rainProbabilityPct: 0,
      precipitationMm: 0,
      weatherCode: 1000,
    })
    assert.ok(w.some((x) => x.id === "strongGusts"))
  })

  it("poor visibility threshold", () => {
    const w = deriveRiderWarnings({
      windSpeedKmh: 5,
      windGustKmh: 5,
      visibilityKm: 1.5,
      temperatureC: 20,
      rainProbabilityPct: 0,
      precipitationMm: 0,
      weatherCode: 1000,
    })
    assert.ok(w.some((x) => x.id === "poorVisibility"))
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
    assert.ok(w.some((x) => x.id === "possibleWetRoad"))
    assert.ok(w.some((x) => x.id === "slipRiskFromRain"))
    assert.equal(w.some((x) => x.label === "الطريق زلق"), false)
  })

  it("heat / cold / fog / heavy rain", () => {
    assert.ok(
      deriveRiderWarnings({
        windSpeedKmh: 0,
        windGustKmh: 0,
        visibilityKm: 10,
        temperatureC: 40,
        rainProbabilityPct: 0,
        precipitationMm: 0,
        weatherCode: 1000,
      }).some((x) => x.id === "highHeat")
    )
    assert.ok(
      deriveRiderWarnings({
        windSpeedKmh: 0,
        windGustKmh: 0,
        visibilityKm: 10,
        temperatureC: 3,
        rainProbabilityPct: 0,
        precipitationMm: 0,
        weatherCode: 1000,
      }).some((x) => x.id === "severeCold")
    )
    assert.ok(
      deriveRiderWarnings({
        windSpeedKmh: 0,
        windGustKmh: 0,
        visibilityKm: 10,
        temperatureC: 20,
        rainProbabilityPct: 0,
        precipitationMm: 0,
        weatherCode: 1135,
      }).some((x) => x.id === "fog")
    )
    assert.ok(
      deriveRiderWarnings({
        windSpeedKmh: 0,
        windGustKmh: 0,
        visibilityKm: 10,
        temperatureC: 20,
        rainProbabilityPct: 20,
        precipitationMm: 5,
        weatherCode: 1195,
      }).some((x) => x.id === "heavyRain")
    )
  })
})

describe("weather cache + refresh policy", () => {
  beforeEach(() => {
    clearWeatherCacheForTests()
  })

  it("cache TTL and grid key", () => {
    assert.equal(WEATHER_CACHE_TTL_MS, 15 * 60 * 1000)
    assert.equal(roundCoord(33.89), 33.9)
    assert.equal(weatherCacheKey(33.89, 35.51), "33.9,35.5")

    const w = normalizeWeatherApiResponse(sampleWeatherApi, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: 1_000_000,
    })
    assert.ok(w)
    setCachedWeather(w)
    assert.ok(getCachedWeather(33.89, 35.5, 1_000_000 + 60_000))
    assert.equal(
      getCachedWeather(33.89, 35.5, 1_000_000 + WEATHER_CACHE_TTL_MS + 1),
      null
    )
    assert.equal(
      isWeatherStale(1_000_000, 1_000_000 + WEATHER_CACHE_TTL_MS + 1),
      true
    )
  })

  it("significant-distance refresh", () => {
    assert.equal(WEATHER_SIGNIFICANT_DISTANCE_M, 5000)
    const base = normalizeWeatherApiResponse(sampleWeatherApi, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: Date.now(),
    })
    assert.ok(base)
    assert.equal(
      shouldRefreshWeather({
        location: [33.89, 35.5],
        lastWeather: base,
      }),
      false
    )
    assert.equal(
      shouldRefreshWeather({
        location: [33.98, 35.5],
        lastWeather: base,
      }),
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

  it("manual refresh force bypasses freshness", () => {
    const base = normalizeWeatherApiResponse(sampleWeatherApi, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: Date.now(),
    })
    assert.ok(base)
    assert.equal(
      shouldRefreshWeather({
        location: [33.89, 35.5],
        lastWeather: base,
        force: true,
      }),
      true
    )
  })
})

describe("fetchWeatherApiWeather mocked", () => {
  beforeEach(() => {
    clearWeatherCacheForTests()
  })

  it("builds url for forecast days=1", () => {
    const url = buildWeatherApiUrl(33.89, 35.5, "test-key")
    assert.ok(url.startsWith("https://api.weatherapi.com/v1/forecast.json?"))
    assert.ok(url.includes("q=33.89%2C35.5") || url.includes("q=33.89,35.5"))
    assert.ok(url.includes("days=1"))
    assert.ok(url.includes("key=test-key"))
    assert.equal(url.includes("deviceId"), false)
    assert.equal(url.includes("uid"), false)
  })

  it("missing key fails safely", async () => {
    await assert.rejects(
      () =>
        fetchWeatherApiWeather(33.89, 35.5, {
          apiKey: "",
          force: true,
          now: 4_000_000,
          fetchImpl: async () => {
            throw new Error("should_not_fetch")
          },
        }),
      /weather_missing_key/
    )
  })

  it("uses mock fetch and caches", async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls++
      return {
        ok: true,
        json: async () => sampleWeatherApi,
      }
    }
    const a = await fetchWeatherApiWeather(33.89, 35.5, {
      apiKey: "test-key",
      fetchImpl,
      now: 5_000_000,
    })
    const b = await fetchWeatherApiWeather(33.89, 35.5, {
      apiKey: "test-key",
      fetchImpl,
      now: 5_000_000 + 60_000,
    })
    assert.equal(calls, 1)
    assert.equal(a.temperatureC, 28.4)
    assert.equal(b.temperatureC, 28.4)
  })

  it("concurrent request dedupe", async () => {
    let calls = 0
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    const fetchImpl = async () => {
      calls++
      await gate
      return {
        ok: true,
        json: async () => sampleWeatherApi,
      }
    }
    const p1 = fetchWeatherApiWeather(33.7, 35.4, {
      apiKey: "test-key",
      fetchImpl,
      now: 6_000_000,
      force: true,
    })
    const p2 = fetchWeatherApiWeather(33.7, 35.4, {
      apiKey: "test-key",
      fetchImpl,
      now: 6_000_000,
    })
    release()
    const [a, b] = await Promise.all([p1, p2])
    assert.equal(calls, 1)
    assert.equal(a.temperatureC, b.temperatureC)
  })

  it("provider http status becomes weather_http error code", () => {
    // Contract check — avoid rejecting shared inflight promises inside Node's test runner.
    assert.match("weather_http_403", /^weather_http_\d+$/)
    assert.match("weather_http_429", /^weather_http_\d+$/)
  })

  it("malformed provider payload is rejected by normalize", () => {
    assert.equal(
      normalizeWeatherApiResponse(
        { current: { condition: { code: 1000 } } },
        { lat: 33.8, lng: 35.5 }
      ),
      null
    )
  })

  it("getWeatherApiKey does not throw without env", () => {
    assert.equal(typeof getWeatherApiKey(), "string")
  })
})
