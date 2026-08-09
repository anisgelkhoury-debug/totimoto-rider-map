/**
 * Bounded geo report query feature flags.
 * Default OFF — production must keep the full-collection listener.
 */

export function readEnvFlag(value: unknown): boolean {
  if (typeof value !== "string") return false
  const v = value.trim().toLowerCase()
  return v === "1" || v === "true" || v === "yes" || v === "on"
}

/**
 * VITE_USE_BOUNDED_REPORT_QUERIES — absent/empty/false → false.
 * Only explicit true enables bounded mode.
 */
export function useBoundedReportQueriesEnabled(
  env: { VITE_USE_BOUNDED_REPORT_QUERIES?: string } = import.meta.env
): boolean {
  return readEnvFlag(env.VITE_USE_BOUNDED_REPORT_QUERIES)
}

/**
 * Optional DEV comparison mode — never on by default.
 * Does not enable bounded production path by itself.
 */
export function useCompareBoundedReportQueriesEnabled(
  env: { VITE_COMPARE_BOUNDED_REPORT_QUERIES?: string } = import.meta.env
): boolean {
  return readEnvFlag(env.VITE_COMPARE_BOUNDED_REPORT_QUERIES)
}

/** Documented default when env var is absent. */
export function boundedReportQueriesDefaultOff(): boolean {
  return true
}
