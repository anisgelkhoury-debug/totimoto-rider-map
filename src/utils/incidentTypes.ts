/**
 * Live incident intelligence (حدث) — situational awareness, not events/calendar.
 * Rider-facing labels are Arabic; internal slugs are English.
 */

export const INCIDENT_FAMILY = "incident" as const

export type IncidentCategory =
  | "fire"
  | "gunfire"
  | "explosionStrike"
  | "collapseDanger"
  | "otherIncident"

export type IncidentReportType = {
  label: string
  emoji: string
  color: string
  expiry: number
  priority: "high" | "critical"
  reportFamily: typeof INCIDENT_FAMILY
  reportCategory: IncidentCategory
  /** Soft area presentation for sensitive subtypes. */
  approximateArea: boolean
}

export const INCIDENT_REPORT_TYPES: readonly IncidentReportType[] = [
  {
    label: "حريق",
    emoji: "🔥",
    color: "#b91c1c",
    expiry: 90,
    priority: "high",
    reportFamily: INCIDENT_FAMILY,
    reportCategory: "fire",
    approximateArea: false,
  },
  {
    label: "إطلاق نار",
    emoji: "⚠️",
    color: "#7f1d1d",
    expiry: 30,
    priority: "critical",
    reportFamily: INCIDENT_FAMILY,
    reportCategory: "gunfire",
    approximateArea: true,
  },
  {
    label: "انفجار / غارة",
    emoji: "💥",
    color: "#9f1239",
    expiry: 90,
    priority: "critical",
    reportFamily: INCIDENT_FAMILY,
    reportCategory: "explosionStrike",
    approximateArea: true,
  },
  {
    label: "انهيار / خطر كبير",
    emoji: "⚠️",
    color: "#92400e",
    expiry: 120,
    priority: "high",
    reportFamily: INCIDENT_FAMILY,
    reportCategory: "collapseDanger",
    approximateArea: false,
  },
  {
    label: "أخرى",
    emoji: "⚠️",
    color: "#57534e",
    expiry: 60,
    priority: "high",
    reportFamily: INCIDENT_FAMILY,
    reportCategory: "otherIncident",
    approximateArea: false,
  },
] as const

export const INCIDENT_CATEGORY_SET = new Set<string>(
  INCIDENT_REPORT_TYPES.map((t) => t.reportCategory)
)

export type Incidentish = {
  type?: string
  reportFamily?: string
  reportCategory?: string
  priority?: string
}

export function isIncidentReport(report: Incidentish): boolean {
  if (report.reportFamily === INCIDENT_FAMILY) return true
  return (
    typeof report.reportCategory === "string" &&
    INCIDENT_CATEGORY_SET.has(report.reportCategory)
  )
}

export function getIncidentTypeByCategory(
  category: unknown
): IncidentReportType | null {
  if (typeof category !== "string") return null
  return INCIDENT_REPORT_TYPES.find((t) => t.reportCategory === category) ?? null
}

export function resolveIncidentExpiryMinutes(
  category: unknown,
  fallback = 60
): number {
  return getIncidentTypeByCategory(category)?.expiry ?? fallback
}

export function isSevereIncident(report: Incidentish): boolean {
  return (
    report.reportCategory === "gunfire" ||
    report.reportCategory === "explosionStrike"
  )
}

export function isSeriousIncident(report: Incidentish): boolean {
  return (
    report.reportCategory === "fire" ||
    report.reportCategory === "collapseDanger"
  )
}

/** Soft-radius / approximate location presentation. */
export function usesApproximateIncidentArea(report: Incidentish): boolean {
  if (!isIncidentReport(report)) return false
  const known = getIncidentTypeByCategory(report.reportCategory)
  if (known) return known.approximateArea
  return (
    report.reportCategory === "gunfire" ||
    report.reportCategory === "explosionStrike"
  )
}

export function buildIncidentCreateFields(type: IncidentReportType) {
  return {
    type: type.label,
    emoji: type.emoji,
    color: type.color,
    expiry: type.expiry,
    priority: type.priority,
    reportFamily: type.reportFamily,
    reportCategory: type.reportCategory,
  }
}

export function isKnownIncidentCategory(category: unknown): boolean {
  return typeof category === "string" && INCIDENT_CATEGORY_SET.has(category)
}

/** Reject unknown incident subtype for create helpers / tests. */
export function assertValidIncidentType(type: {
  reportFamily?: string
  reportCategory?: string
  label?: string
}): boolean {
  if (type.reportFamily !== INCIDENT_FAMILY) return false
  if (!isKnownIncidentCategory(type.reportCategory)) return false
  const known = getIncidentTypeByCategory(type.reportCategory)
  return !!known && known.label === type.label
}
