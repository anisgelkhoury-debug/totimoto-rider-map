/**
 * Rider weather & conditions — pure unit tests (no network).
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  windDirectionArabic,
  mapWeatherCode,
  deriveRiderWarnings,
  RIDER_THRESHOLDS,
  normalizeOpenMeteoResponse,
  formatLocalClock,
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
  fetchOpenMeteoWeather,
  buildOpenMeteoUrl,
} from "../../src/weather/index.ts"

const sampleOpenMeteo = {
  latitude: 33.89,
  longitude: 35.5,
  current: {
    time: "2026-08-07T18:00",
    temperature_2m: 28.4,
    apparent_temperature: 31.2,
    relative_humidity_2m: 70,
    weather_code: 0,
    wind_speed_10m: 22,
    wind_direction_10m: 45,
    wind_gusts_10m: 34,
    precipitation: 0,
    rain: 0,
    visibility: 8000,
    uv_index: 3,
    is_day: 1,
  },
  hourly: {
    time: [
      "2026-08-07T18:00",
      "2026-08-07T19:00",
      "2026-08-07T20:00",
      "2026-08-07T21:00",
      "2026-08-07T22:00",
      "2026-08-07T23:00",
    ],
    temperature_2m: [28.4, 27.1, 26.0, 25.2, 24.8, 24.1],
    precipitation_probability: [40, 45, 50, 55, 60, 35],
    weather_code: [0, 1, 2, 3, 61, 0],
  },
  daily: {
    sunrise: ["2026-08-07T05:55"],
    sunset: ["2026-08-07T19:32"],
  },
}

describe("rider weather normalize + fields", () => {
  it("normalizes Open-Meteo response", () => {
    const w = normalizeOpenMeteoResponse(sampleOpenMeteo, {
      lat: 33.89,
      lng: 35.5,
      fetchedAt: 1000,
    })
    assert.ok(w)
    assert.equal(w.temperatureC, 28.4)
    assert.equal(w.feelsLikeC, 31.2)
    assert.equal(w.humidityPct, 70)
    assert.equal(w.windSpeedKmh, 22)
    assert.equal(w.windGustKmh, 34)
    assert.equal(w.windDirectionDeg, 45)
    assert.equal(w.windDirectionLabel, "شمالية شرقية")
    assert.equal(w.rainProbabilityPct, 40)
    assert.equal(w.precipitationMm, 0)
    assert.equal(w.visibilityKm, 8)
    assert.equal(w.uvIndex, 3)
    assert.equal(w.sunriseLabel, "05:55")
    assert.equal(w.sunsetLabel, "19:32")
    assert.equal(w.conditionLabel, "صافي")
    assert.equal(w.conditionEmoji, "☀️")
    assert.equal(w.hourly.length, 6)
    assert.equal(w.attribution, "Open-Meteo")
  })

  it("rejects malformed response", () => {
    assert.equal(normalizeOpenMeteoResponse(null, { lat: 1, lng: 2 }), null)
    assert.equal(normalizeOpenMeteoResponse({}, { lat: 1, lng: 2 }), null)
    assert.equal(
      normalizeOpenMeteoResponse(
        { current: { weather_code: 0 } },
        { lat: 1, lng: 2 }
      ),
      null
    )
  })

  it("formats local clock", () => {
    assert.equal(formatLocalClock("2026-08-07T19:32"), "19:32")
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
  it("maps WMO codes", () => {
    assert.equal(mapWeatherCode(0).label, "صافي")
    assert.equal(mapWeatherCode(3).label, "غائم")
    assert.equal(mapWeatherCode(63).label, "مطر")
    assert.equal(mapWeatherCode(45).label, "ضباب")
    assert.equal(mapWeatherCode(95).label, "عاصف / رعد")
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
      weatherCode: 0,
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
      weatherCode: 0,
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
      weatherCode: 0,
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
      weatherCode: 0,
    })
    assert.ok(w.some((x) => x.id === "rainLikely"))
    assert.ok(w.some((x) => x.id === "possibleWetRoad"))
    assert.ok(w.some((x) => x.id === "slipRiskFromRain"))
    assert.equal(
      w.some((x) => x.label === "الطريق زلق"),
      false
    )
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
        weatherCode: 0,
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
        weatherCode: 0,
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
        weatherCode: 45,
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
        weatherCode: 65,
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

    const w = normalizeOpenMeteoResponse(sampleOpenMeteo, {
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
    assert.equal(isWeatherStale(1_000_000, 1_000_000 + WEATHER_CACHE_TTL_MS + 1), true)
  })

  it("significant-distance refresh", () => {
    assert.equal(WEATHER_SIGNIFICANT_DISTANCE_M, 5000)
    const base = normalizeOpenMeteoResponse(sampleOpenMeteo, {
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
    // ~10km north
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
})

describe("fetchOpenMeteoWeather mocked", () => {
  beforeEach(() => {
    clearWeatherCacheForTests()
  })

  it("builds url without secrets", () => {
    const url = buildOpenMeteoUrl(33.89, 35.5)
    assert.ok(url.includes("api.open-meteo.com") || url.includes("open-meteo.com"))
    assert.ok(url.includes("latitude=33.89"))
    assert.ok(url.includes("wind_speed_unit=kmh"))
    assert.equal(url.includes("deviceId"), false)
    assert.equal(url.includes("uid"), false)
  })

  it("uses mock fetch and caches", async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls++
      return {
        ok: true,
        json: async () => sampleOpenMeteo,
      }
    }
    const a = await fetchOpenMeteoWeather(33.89, 35.5, {
      fetchImpl: fetchImpl,
      now: 5_000_000,
    })
    const b = await fetchOpenMeteoWeather(33.89, 35.5, {
      fetchImpl: fetchImpl,
      now: 5_000_000 + 60_000,
    })
    assert.equal(calls, 1)
    assert.equal(a.temperatureC, 28.4)
    assert.equal(b.temperatureC, 28.4)
  })

  it("malformed provider payload is rejected by normalize", () => {
    assert.equal(
      normalizeOpenMeteoResponse({ current: { weather_code: 3 } }, {
        lat: 33.8,
        lng: 35.5,
      }),
      null
    )
  })
})
