/**
 * HTTPS v2 getRiderWeather — browser → Function → WeatherAPI.
 * Secret: WEATHERAPI_KEY (Functions secret, never client).
 */

import { defineSecret } from "firebase-functions/params"
import { onRequest } from "firebase-functions/v2/https"
import { handleGetRiderWeather } from "./handler"

const weatherApiKey = defineSecret("WEATHERAPI_KEY")

const ALLOWED_ORIGINS = new Set([
  "https://app.totimoto.com",
  "https://totimoto-rider-network.web.app",
  "https://totimoto-rider-network.firebaseapp.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
])

function applyCors(req: { get: (name: string) => string | undefined }, res: {
  set: (field: string, value: string) => void
}): void {
  const origin = req.get("origin") || ""
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin)
    res.set("Vary", "Origin")
  }
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.set("Access-Control-Allow-Headers", "Content-Type")
  res.set("Access-Control-Max-Age", "3600")
}

/**
 * Region: us-central1 — matches existing TRN Functions.
 * (europe-west1 would be closer to Lebanon; do not relocate other Functions.)
 *
 * App Check: not enforced — TRN PWA does not initialize App Check yet.
 */
export const getRiderWeather = onRequest(
  {
    region: "us-central1",
    secrets: [weatherApiKey],
    timeoutSeconds: 15,
    memory: "256MiB",
    invoker: "public",
  },
  async (req, res) => {
    applyCors(req, res)

    if (req.method === "OPTIONS") {
      res.status(204).send("")
      return
    }

    if (req.method !== "GET") {
      res.status(405).json({ error: "method_not_allowed" })
      return
    }

    const lat = req.query.lat
    const lng = req.query.lng

    const result = await handleGetRiderWeather(lat, lng, {
      apiKey: weatherApiKey.value(),
    })

    res.status(result.status).json(result.body)
  }
)
