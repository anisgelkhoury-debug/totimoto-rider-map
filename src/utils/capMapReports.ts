/**
 * Limit map markers for large report sets while keeping owner + selected.
 */
export type CapMapReport = {
  id?: string | number
  ownerId?: string
}

export function capMapReports<T extends CapMapReport>(
  reports: T[],
  options: {
    cap: number
    deviceId: string
    selectedId?: string | number | null
  }
): T[] {
  const { cap, deviceId, selectedId } = options
  if (reports.length <= cap) return reports

  const keep = new Set<string>()
  const out: T[] = []

  for (const r of reports) {
    if (
      r.ownerId === deviceId ||
      (selectedId != null && String(r.id) === String(selectedId))
    ) {
      out.push(r)
      keep.add(String(r.id))
    }
  }

  for (const r of reports) {
    if (out.length >= cap) break
    const id = String(r.id)
    if (keep.has(id)) continue
    out.push(r)
    keep.add(id)
  }

  return out
}
