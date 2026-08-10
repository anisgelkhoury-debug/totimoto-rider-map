/**
 * Privacy-safe deep-link selection proof helpers (058L).
 * Used by unit tests and optional DEV console instrumentation.
 * Never logs tokens, UIDs, geohashes, or full PII.
 */

export type DeepLinkSelectionInput = {
  requestedReportId: string | null | undefined
  reports: ReadonlyArray<{ id?: unknown; resolved?: unknown }>
}

export type DeepLinkSelectionResult = {
  requestedReportId: string | null
  /** Truncated id for DEV logs (prefix only). */
  requestedReportIdPrefix: string | null
  found: boolean
  selected: boolean
  reason:
    | "selected"
    | "missing_report_id"
    | "report_not_in_list"
    | "report_resolved"
}

export function reportIdPrefix(reportId: string | null | undefined): string | null {
  const id = String(reportId || "").trim()
  if (!id) return null
  return id.length <= 12 ? id : id.slice(0, 12)
}

/**
 * Pure evaluation of whether a deep-linked report can become selected.
 * Mirrors App applyDeepLinkReportId find semantics (id match; unresolved preferred).
 */
export function evaluateDeepLinkReportSelection(
  input: DeepLinkSelectionInput
): DeepLinkSelectionResult {
  const requestedReportId = String(input.requestedReportId || "").trim() || null
  const prefix = reportIdPrefix(requestedReportId)
  if (!requestedReportId) {
    return {
      requestedReportId: null,
      requestedReportIdPrefix: null,
      found: false,
      selected: false,
      reason: "missing_report_id",
    }
  }
  const found = input.reports.find(
    (r) => r && r.id != null && String(r.id) === requestedReportId
  )
  if (!found) {
    return {
      requestedReportId,
      requestedReportIdPrefix: prefix,
      found: false,
      selected: false,
      reason: "report_not_in_list",
    }
  }
  // Match App applyDeepLinkReportId: select whenever present in live list.
  return {
    requestedReportId,
    requestedReportIdPrefix: prefix,
    found: true,
    selected: true,
    reason: found.resolved === true ? "report_resolved" : "selected",
  }
}

/** DEV-only console proof — no-op outside import.meta.env.DEV when available. */
export function logDeepLinkSelectionProof(
  result: DeepLinkSelectionResult,
  isDev = false
): void {
  if (!isDev) return
  // eslint-disable-next-line no-console
  console.info("[TRN deep-link proof]", {
    reportPrefix: result.requestedReportIdPrefix,
    found: result.found,
    selected: result.selected,
    reason: result.reason,
  })
}
