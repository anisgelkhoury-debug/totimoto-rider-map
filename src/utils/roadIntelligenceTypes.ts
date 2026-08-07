/**
 * Road-intelligence helpers for حاجز (checkpoint) and related types.
 * Rider-facing labels stay Arabic; internal slugs stay English.
 */

export const CHECKPOINT_REPORT_TYPE = {
  label: "حاجز",
  emoji: "🛂",
  color: "#334155",
  expiry: 60,
  priority: "high",
  reportFamily: "intelligence" as const,
  reportCategory: "checkpoint" as const,
}

export type Checkpointish = {
  type?: string
  reportFamily?: string
  reportCategory?: string
  priority?: string
}

export function isCheckpointReport(report: Checkpointish): boolean {
  return (
    report.reportCategory === "checkpoint" ||
    report.type === CHECKPOINT_REPORT_TYPE.label
  )
}

export function isRoadIntelligenceReport(report: Checkpointish): boolean {
  if (report.reportFamily === "intelligence") return true
  if (isCheckpointReport(report)) return true
  const t = report.type
  return (
    t === "زحمة" ||
    t === "حادث" ||
    t === "طريق مسكر" ||
    t === "طريق زلق" ||
    t === "حاجز"
  )
}

/** Build the Firestore/client payload fields for a catalog type (shared create shape). */
export function buildIntelligenceCreateFields(type: {
  label: string
  emoji: string
  color: string
  expiry: number
  priority: string
  reportFamily: string
  reportCategory: string
}) {
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

/**
 * List tab search: empty / الكل = all.
 * Matches Arabic type label, short tab labels, or checkpoint category.
 */
export function matchesReportTypeSearch(
  report: Checkpointish & { type?: string },
  search: string
): boolean {
  const q = (search || "").trim()
  if (!q || q === "الكل") return true
  if (q === "حاجز") return isCheckpointReport(report)
  if (q === "حدث") {
    return report.reportFamily === "incident"
  }
  if (q === "مسروقة") {
    return (
      report.reportFamily === "stolen" ||
      (typeof report.type === "string" && report.type.includes("مسروقة"))
    )
  }
  if (q === "مسكر") return report.type === "طريق مسكر"
  if (q === "زلق") return report.type === "طريق زلق"
  if (q === "عطل") return report.type === "عطل بالدراجة"
  if (q === "بنزين") return report.type === "ما معي بنزين"
  return report.type === q || (typeof report.type === "string" && report.type.includes(q))
}
