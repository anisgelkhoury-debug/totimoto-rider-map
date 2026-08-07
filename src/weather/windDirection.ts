import type { WindDirectionArabic } from "./types.ts"

/** Convert meteorological wind-from degrees (0–360) to Arabic compass label. */
export function windDirectionArabic(degrees: unknown): WindDirectionArabic {
  if (typeof degrees !== "number" || !Number.isFinite(degrees)) return "—"
  const d = ((degrees % 360) + 360) % 360
  const sectors: WindDirectionArabic[] = [
    "شمالية",
    "شمالية شرقية",
    "شرقية",
    "جنوبية شرقية",
    "جنوبية",
    "جنوبية غربية",
    "غربية",
    "شمالية غربية",
  ]
  const index = Math.round(d / 45) % 8
  return sectors[index] ?? "—"
}
