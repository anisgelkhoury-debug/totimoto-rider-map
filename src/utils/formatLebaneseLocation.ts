/**
 * Lebanese location extraction + formatting for TRN.
 * Nominatim/OSM reverse-geocode only — no Places/Geocoding APIs.
 */

export type LebaneseLocationParts = {
  locationName?: string | null
  street?: string | null
  district?: string | null
  city?: string | null
  area?: string | null
}

export type NominatimAddress = Record<string, unknown>

export type ParsedLebaneseLocation = {
  street: string
  area: string
  city: string
  district: string
  locationName: string
}

const GENERIC_LOCATION_RE =
  /^(unnamed(\s+(road|street))?|unknown(\s+(road|street))?|route|road|street|highway|path|طريق\s*بدون\s*اسم|شارع\s*غير\s*معروف|غير\s*معروف|موقع\s*البلاغ|موقعك\s*الحالي)$/i

/** Street-like keys in Nominatim `address`, preferred first. */
export const NOMINATIM_STREET_KEYS = [
  "road",
  "pedestrian",
  "residential",
  "street",
  "highway",
  "footway",
  "path",
  "cycleway",
] as const

export function cleanPart(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.replace(/\s+/g, " ").trim()
}

export function isGenericLocationPart(value: string): boolean {
  if (!value) return true
  if (GENERIC_LOCATION_RE.test(value)) return true
  if (/unnamed/i.test(value)) return true
  if (/بدون\s*اسم/.test(value)) return true
  if (/شارع\s*غير\s*معروف/.test(value)) return true
  if (/^route\b/i.test(value)) return true
  // Raw coordinate-looking strings
  if (/^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value)) return true
  return false
}

/** Exact-duplicate key only (do not collapse different geo levels via substring). */
export function duplicateKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ـ_\-–—•,،./]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function looksLikeJoinedName(value: string): boolean {
  return /\s[-–—•]\s/.test(value) || value.includes(" - ")
}

/**
 * Extract a real named street/road from Nominatim address fields.
 * Never invents names; returns "" when unavailable or generic.
 */
export function extractStreetFromNominatimAddress(
  address: NominatimAddress | null | undefined
): string {
  if (!address || typeof address !== "object") return ""

  for (const key of NOMINATIM_STREET_KEYS) {
    const value = cleanPart(address[key])
    if (value && !isGenericLocationPart(value)) return value
  }
  return ""
}

function extractArea(address: NominatimAddress): string {
  for (const key of [
    "neighbourhood",
    "suburb",
    "quarter",
    "city_district",
    "hamlet",
  ] as const) {
    const value = cleanPart(address[key])
    if (value && !isGenericLocationPart(value)) return value
  }
  return ""
}

function extractCity(address: NominatimAddress): string {
  for (const key of ["city", "town", "village", "municipality"] as const) {
    const value = cleanPart(address[key])
    if (value && !isGenericLocationPart(value)) return value
  }
  return ""
}

function extractDistrict(address: NominatimAddress): string {
  for (const key of ["county", "state", "region"] as const) {
    const value = cleanPart(address[key])
    if (value && !isGenericLocationPart(value)) return value
  }
  return ""
}

/**
 * Optional landmark/named place from Nominatim (never invented).
 * Prefers a short `name` that is not the same as street/area/city.
 */
function extractLandmark(
  data: { name?: unknown; display_name?: unknown; address?: NominatimAddress },
  street: string,
  area: string,
  city: string
): string {
  const name = cleanPart(data.name)
  if (
    name &&
    !isGenericLocationPart(name) &&
    !looksLikeJoinedName(name) &&
    duplicateKey(name) !== duplicateKey(street) &&
    duplicateKey(name) !== duplicateKey(area) &&
    duplicateKey(name) !== duplicateKey(city)
  ) {
    return name
  }
  return ""
}

/**
 * Parse a Nominatim reverse-geocode JSON body into TRN location fields.
 */
export function parseNominatimToLocationInfo(data: {
  name?: unknown
  display_name?: unknown
  address?: NominatimAddress
} | null): ParsedLebaneseLocation {
  const address = (data?.address || {}) as NominatimAddress
  const street = extractStreetFromNominatimAddress(address)
  const area = extractArea(address)
  const city = extractCity(address)
  const district = extractDistrict(address)
  const landmark = extractLandmark(data || {}, street, area, city)

  const locationName =
    landmark ||
    [street, area, city, district].filter(Boolean).join(" - ") ||
    cleanPart(data?.display_name) ||
    "موقع البلاغ"

  return {
    street,
    area: area || city || district || locationName,
    city,
    district,
    locationName,
  }
}

function pushUnique(parts: string[], value: string, maxParts: number): void {
  if (parts.length >= maxParts) return
  const cleaned = cleanPart(value)
  if (!cleaned || isGenericLocationPart(cleaned)) return
  const key = duplicateKey(cleaned)
  if (!key) return
  if (parts.some((p) => duplicateKey(p) === key)) return
  parts.push(cleaned)
}

/**
 * Concise label for cards / map summaries.
 * Prefer: Street • Area • City  (up to 3 meaningful parts)
 */
export function formatLebaneseLocationConcise(
  parts: LebaneseLocationParts,
  options?: { fallback?: string }
): string {
  const fallback = options?.fallback ?? "موقع البلاغ"
  const out: string[] = []

  pushUnique(out, parts.street || "", 3)
  pushUnique(out, parts.area || "", 3)
  pushUnique(out, parts.city || "", 3)

  // If no street/area/city, allow village-style district pairing.
  if (out.length === 0) {
    pushUnique(out, parts.city || "", 2)
    pushUnique(out, parts.district || "", 2)
  } else if (out.length < 2) {
    pushUnique(out, parts.district || "", 3)
  }

  // Landmark-only locationName when atomic fields are thin.
  const locationName = cleanPart(parts.locationName)
  if (
    out.length === 0 &&
    locationName &&
    !isGenericLocationPart(locationName) &&
    !looksLikeJoinedName(locationName)
  ) {
    pushUnique(out, locationName, 3)
  }

  if (out.length === 0 && locationName && looksLikeJoinedName(locationName)) {
    for (const segment of locationName.split(/\s[-–—•]\s|\s-\s/)) {
      pushUnique(out, segment, 3)
    }
  }

  return out.join(" • ") || fallback
}

/**
 * Detailed label for full report sheets / share text.
 * Prefer: Landmark • Street • Area • City • District  (up to 5 parts)
 */
export function formatLebaneseLocationDetailed(
  parts: LebaneseLocationParts,
  options?: { fallback?: string }
): string {
  const fallback = options?.fallback ?? "موقع البلاغ"
  const out: string[] = []

  const locationName = cleanPart(parts.locationName)
  if (
    locationName &&
    !isGenericLocationPart(locationName) &&
    !looksLikeJoinedName(locationName)
  ) {
    pushUnique(out, locationName, 5)
  }

  pushUnique(out, parts.street || "", 5)
  pushUnique(out, parts.area || "", 5)
  pushUnique(out, parts.city || "", 5)
  pushUnique(out, parts.district || "", 5)

  if (out.length === 0 && locationName && looksLikeJoinedName(locationName)) {
    for (const segment of locationName.split(/\s[-–—•]\s|\s-\s/)) {
      pushUnique(out, segment, 5)
    }
  }

  return out.join(" • ") || fallback
}

/**
 * @deprecated Prefer formatLebaneseLocationConcise / Detailed.
 * Defaults to concise for compact surfaces.
 */
export function formatLebaneseLocation(
  parts: LebaneseLocationParts,
  options?: { maxParts?: number; fallback?: string; detailed?: boolean }
): string {
  if (options?.detailed) {
    return formatLebaneseLocationDetailed(parts, {
      fallback: options.fallback,
    })
  }
  return formatLebaneseLocationConcise(parts, { fallback: options?.fallback })
}
