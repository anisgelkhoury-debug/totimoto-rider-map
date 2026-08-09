/**
 * DEV comparison foundation for full-listener vs bounded IDs (057E prep).
 * Pure — never attach both listeners from this module.
 */

export type ReportIdSetComparison = {
  fullOnly: string[]
  boundedOnly: string[]
  shared: string[]
  fullCount: number
  boundedCount: number
  /** Docs present in full but missing geohash — expected gap when bounded is on. */
  missingGeohashInFull: number
}

export function compareFullVsBoundedReportIds(options: {
  fullIds: ReadonlyArray<string>
  boundedIds: ReadonlyArray<string>
  fullMissingGeohashCount?: number
}): ReportIdSetComparison {
  const full = new Set(
    options.fullIds.map((id) => String(id).trim()).filter(Boolean)
  )
  const bounded = new Set(
    options.boundedIds.map((id) => String(id).trim()).filter(Boolean)
  )
  const shared: string[] = []
  const fullOnly: string[] = []
  const boundedOnly: string[] = []

  for (const id of full) {
    if (bounded.has(id)) shared.push(id)
    else fullOnly.push(id)
  }
  for (const id of bounded) {
    if (!full.has(id)) boundedOnly.push(id)
  }

  shared.sort()
  fullOnly.sort()
  boundedOnly.sort()

  return {
    fullOnly,
    boundedOnly,
    shared,
    fullCount: full.size,
    boundedCount: bounded.size,
    missingGeohashInFull: options.fullMissingGeohashCount ?? 0,
  }
}
