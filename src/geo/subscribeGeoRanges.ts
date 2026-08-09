/**
 * Multi-range geohash onSnapshot subscription (Firestore).
 * Merges ranges by doc id; partial range failure does not wipe good data.
 */

import {
  collection,
  query,
  where,
  orderBy,
  startAt,
  endAt,
  onSnapshot,
  type Firestore,
  type Unsubscribe,
  type QueryDocumentSnapshot,
  type DocumentData,
} from "firebase/firestore"
import type { GeohashQueryRange } from "./queryRanges.ts"
import { normalizeLiveReports } from "../utils/reportSnapshot.ts"
import {
  BOUNDED_GEO_INDEX_REQUIRED,
  isMissingIndexError,
} from "./queryBuilder.ts"

export type GeoRangeDoc = Record<string, unknown> & {
  id: string
  createdAt: number | null
}

export type SubscribeGeoRangesOptions = {
  db: Firestore
  ranges: ReadonlyArray<GeohashQueryRange>
  onData: (reports: GeoRangeDoc[]) => void
  onRangeError?: (info: {
    range: GeohashQueryRange
    error: unknown
    missingIndex: boolean
    code: string
  }) => void
  now?: number
}

export type GeoRangesSubscription = {
  unsubscribe: () => void
}

function rangeKey(range: GeohashQueryRange): string {
  return `${range.start}\0${range.end}`
}

function docsToReports(
  docs: QueryDocumentSnapshot<DocumentData>[],
  now: number
): GeoRangeDoc[] {
  return normalizeLiveReports(docs, now) as GeoRangeDoc[]
}

/**
 * Pure merge of per-range doc maps (testable without Firestore).
 * First-seen id wins across ranges.
 */
export function mergeGeoRangeBuckets(
  byRange: ReadonlyMap<string, ReadonlyMap<string, GeoRangeDoc>>
): GeoRangeDoc[] {
  const merged = new Map<string, GeoRangeDoc>()
  for (const docs of byRange.values()) {
    for (const [id, report] of docs) {
      if (!merged.has(id)) merged.set(id, report)
    }
  }
  return Array.from(merged.values())
}

/**
 * Partial failure: keep previous good docs for the failing range.
 * Does not clear other ranges.
 */
export function retainRangeOnError<T>(
  byRange: Map<string, Map<string, T>>,
  failingKey: string
): Map<string, Map<string, T>> {
  // Intentionally no-op mutation — documents retain behavior for tests.
  void failingKey
  return byRange
}


/**
 * Subscribe to one or more resolved+geohash range queries.
 * Successful ranges keep contributing after another range errors.
 */
export function subscribeReportsByGeoRanges(
  options: SubscribeGeoRangesOptions
): GeoRangesSubscription {
  const { db, ranges, onData, onRangeError } = options
  const now = options.now ?? Date.now()
  const byRange = new Map<string, Map<string, GeoRangeDoc>>()
  const unsubs: Unsubscribe[] = []

  const emit = () => {
    onData(mergeGeoRangeBuckets(byRange))
  }

  for (const range of ranges) {
    const key = rangeKey(range)
    byRange.set(key, new Map())

    const q = query(
      collection(db, "reports"),
      where("resolved", "==", false),
      orderBy("geohash"),
      startAt(range.start),
      endAt(range.end)
    )

    const unsub = onSnapshot(
      q,
      (snap) => {
        const map = new Map<string, GeoRangeDoc>()
        for (const report of docsToReports(snap.docs, now)) {
          map.set(report.id, report)
        }
        byRange.set(key, map)
        emit()
      },
      (error) => {
        const missingIndex = isMissingIndexError(error)
        if (import.meta.env.DEV) {
          console.error(
            missingIndex
              ? `[TRN Geo] ${BOUNDED_GEO_INDEX_REQUIRED}`
              : "[TRN Geo] range listener error",
            missingIndex ? undefined : error
          )
        }
        onRangeError?.({
          range,
          error,
          missingIndex,
          code: missingIndex
            ? BOUNDED_GEO_INDEX_REQUIRED
            : "bounded_geo_range_error",
        })
        // Keep last good data for this range; do not clear other ranges.
      }
    )
    unsubs.push(unsub)
  }

  // Empty ranges → empty emit once
  if (ranges.length === 0) {
    onData([])
  }

  return {
    unsubscribe() {
      for (const u of unsubs) u()
      unsubs.length = 0
      byRange.clear()
    },
  }
}
