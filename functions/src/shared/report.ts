/**
 * Shared report snapshot helpers for lifecycle notifications.
 */

export type ReportSnapshot = {
  ownerUid?: unknown
  helperUid?: unknown
  helperComing?: unknown
  helperAcceptedAt?: unknown
  resolved?: unknown
  reportFamily?: unknown
}

export type PreferenceKey = "helperLifecycle" | "ownerLifecycle"

export function asNonEmptyString(value: unknown): string {
  if (typeof value !== "string") return ""
  return value.trim()
}

export function isTruthyComing(value: unknown): boolean {
  return value === true
}

export function isResolved(value: unknown): boolean {
  return value === true
}

export function isNotifiableReportFamily(family: unknown): boolean {
  return family === "assistance" || family === "sharedRide"
}

export function reportFamilyOf(
  primary: ReportSnapshot | null | undefined,
  fallback?: ReportSnapshot | null | undefined
): unknown {
  return primary?.reportFamily ?? fallback?.reportFamily
}
