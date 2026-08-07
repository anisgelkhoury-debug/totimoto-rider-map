/** Normalized rider weather model (Arabic-ready, metric units). */

export type WindDirectionArabic =
  | "شمالية"
  | "شمالية شرقية"
  | "شرقية"
  | "جنوبية شرقية"
  | "جنوبية"
  | "جنوبية غربية"
  | "غربية"
  | "شمالية غربية"
  | "—"

export type RiderWarningId =
  | "strongWind"
  | "strongGusts"
  | "possibleCrosswind"
  | "possibleWetRoad"
  | "slipRiskFromRain"
  | "poorVisibility"
  | "highHeat"
  | "severeCold"
  | "rainLikely"
  | "heavyRain"
  | "fog"

export type RiderWarning = {
  id: RiderWarningId
  label: string
}

export type HourlyPreviewPoint = {
  /** Local hour label, e.g. "15:00" */
  timeLabel: string
  temperatureC: number | null
  rainProbabilityPct: number | null
  conditionLabel: string
  emoji: string
}

export type RiderWeather = {
  fetchedAt: number
  lat: number
  lng: number
  temperatureC: number | null
  feelsLikeC: number | null
  humidityPct: number | null
  windSpeedKmh: number | null
  windGustKmh: number | null
  windDirectionDeg: number | null
  windDirectionLabel: WindDirectionArabic
  rainProbabilityPct: number | null
  precipitationMm: number | null
  visibilityKm: number | null
  uvIndex: number | null
  sunriseLabel: string | null
  sunsetLabel: string | null
  conditionLabel: string
  conditionEmoji: string
  weatherCode: number | null
  isDay: boolean | null
  warnings: RiderWarning[]
  hourly: HourlyPreviewPoint[]
  attribution: string
}

export type WeatherFetchStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "no_location"

export type WeatherCacheEntry = {
  key: string
  fetchedAt: number
  weather: RiderWeather
}
