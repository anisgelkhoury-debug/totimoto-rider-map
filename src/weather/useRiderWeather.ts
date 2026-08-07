import { useCallback, useEffect, useRef, useState } from "react"
import { fetchWeatherApiWeather } from "./fetchWeatherApi.ts"
import type { RiderWeather, WeatherFetchStatus } from "./types.ts"
import { shouldRefreshWeather } from "./weatherCache.ts"

export type UseRiderWeatherResult = {
  status: WeatherFetchStatus
  weather: RiderWeather | null
  errorMessage: string | null
  refresh: () => void
}

/**
 * Weather follows rider GPS with cache/throttle.
 * Does not write Firestore or alter GPS watch frequency.
 */
export function useRiderWeather(
  location: [number, number] | null
): UseRiderWeatherResult {
  const lat = location?.[0] ?? null
  const lng = location?.[1] ?? null

  const [weather, setWeather] = useState<RiderWeather | null>(null)
  const [status, setStatus] = useState<WeatherFetchStatus>(
    lat != null && lng != null ? "idle" : "no_location"
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const weatherRef = useRef<RiderWeather | null>(null)
  const forceNextRef = useRef(false)

  useEffect(() => {
    weatherRef.current = weather
  }, [weather])

  useEffect(() => {
    const force = forceNextRef.current
    forceNextRef.current = false

    if (lat == null || lng == null) {
      const t = window.setTimeout(() => {
        setStatus("no_location")
        setErrorMessage(null)
      }, 0)
      return () => window.clearTimeout(t)
    }

    const current = weatherRef.current
    const coords: [number, number] = [lat, lng]

    if (
      !force &&
      !shouldRefreshWeather({
        location: coords,
        lastWeather: current,
      })
    ) {
      const t = window.setTimeout(() => {
        if (current) setStatus("ready")
      }, 0)
      return () => window.clearTimeout(t)
    }

    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled) return
      setStatus((prev) => (prev === "ready" && current ? "ready" : "loading"))
      setErrorMessage(null)

      void fetchWeatherApiWeather(lat, lng, { force })
        .then((next) => {
          if (cancelled) return
          setWeather(next)
          setStatus("ready")
          setErrorMessage(null)
        })
        .catch(() => {
          if (cancelled) return
          if (!weatherRef.current) {
            setStatus("error")
            setErrorMessage("تعذر تحميل الطقس")
          }
        })
    }, 0)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [lat, lng, tick])

  const refresh = useCallback(() => {
    forceNextRef.current = true
    setTick((n) => n + 1)
  }, [])

  return { status, weather, errorMessage, refresh }
}
