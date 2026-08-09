/**
 * React hook: bounded geo report data source (flag must be true to use).
 * Does not attach the full-collection listener.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import type { Firestore } from "firebase/firestore"
import { planRiderCenteredGeoQuery } from "./queryPlans.ts"
import { planViewportGeoQuery } from "./queryPlans.ts"
import { RIDER_NEARBY_MAX_RADIUS_M } from "./geoConfig.ts"
import { subscribeReportsByGeoRanges } from "./subscribeGeoRanges.ts"
import { subscribeOwnerUnresolvedReports } from "./subscribeOwnerReports.ts"
import { mergeGeoReportSets } from "./mergeReports.ts"
import { filterBoundedLiveReports } from "./filterBoundedReports.ts"
import type { ViewportBounds } from "./viewportDebounce.ts"
import { fetchReportById } from "./fetchReportById.ts"
export type UseBoundedReportsOptions = {
  db: Firestore
  enabled: boolean
  authReady: boolean
  ownerUid: string | null
  riderLat: number | null
  riderLng: number | null
  viewportBounds: ViewportBounds | null
  selectedReportId?: string | null
  viewerDeviceId?: string | null
  pendingDeepLinkReportId?: string | null
}
export type UseBoundedReportsResult = {
  reports: Array<Record<string, unknown> & { id: string }>
  riderReports: Array<Record<string, unknown> & { id: string }>
  indexError: string | null
  /** DEV: true when stolen national layer is deferred (geo radius only). */
  stolenDeferred: true
}
type ReportDoc = Record<string, unknown> & { id: string }
export function useBoundedReports(
  options: UseBoundedReportsOptions
): UseBoundedReportsResult {
  const [viewportRaw, setViewportRaw] = useState<ReportDoc[]>([])
  const [riderRaw, setRiderRaw] = useState<ReportDoc[]>([])
  const [ownerRaw, setOwnerRaw] = useState<ReportDoc[]>([])
  const [forcedRaw, setForcedRaw] = useState<ReportDoc[]>([])
  const [indexError, setIndexError] = useState<string | null>(null)
  const forcedTried = useRef(new Set<string>())
  const riderLive =
    options.enabled &&
    options.authReady &&
    options.riderLat != null &&
    options.riderLng != null
  const viewportLive =
    options.enabled && options.authReady && options.viewportBounds != null
  const ownerLive =
    options.enabled &&
    options.authReady &&
    typeof options.ownerUid === "string" &&
    options.ownerUid.trim().length > 0
  // Rider-centered ~15 km
  useEffect(() => {
    if (!riderLive) return
    const plan = planRiderCenteredGeoQuery(
      options.riderLat,
      options.riderLng,
      RIDER_NEARBY_MAX_RADIUS_M
    )
    if (!plan.ok) return
    const sub = subscribeReportsByGeoRanges({
      db: options.db,
      ranges: plan.plan.ranges,
      onData: (reports) => setRiderRaw(reports),
      onRangeError: ({ missingIndex, code }) => {
        if (missingIndex) setIndexError(code)
      },
    })
    return () => sub.unsubscribe()
  }, [riderLive, options.db, options.riderLat, options.riderLng])
  // Viewport
  useEffect(() => {
    if (!viewportLive || !options.viewportBounds) return
    const plan = planViewportGeoQuery(options.viewportBounds)
    if (!plan.ok) return
    const sub = subscribeReportsByGeoRanges({
      db: options.db,
      ranges: plan.plan.ranges,
      onData: (reports) => setViewportRaw(reports),
      onRangeError: ({ missingIndex, code }) => {
        if (missingIndex) setIndexError(code)
      },
    })
    return () => sub.unsubscribe()
  }, [viewportLive, options.db, options.viewportBounds])
  // Owner escape
  useEffect(() => {
    if (!ownerLive || !options.ownerUid) return
    const sub = subscribeOwnerUnresolvedReports({
      db: options.db,
      ownerUid: options.ownerUid,
      onData: (reports) => setOwnerRaw(reports),
      onError: ({ missingIndex, code }) => {
        if (missingIndex) setIndexError(code)
      },
    })
    return () => sub?.unsubscribe()
  }, [ownerLive, options.db, options.ownerUid])
  // Deep-link / selected one-shot (no persistent by-id listener)
  useEffect(() => {
    if (!options.enabled || !options.authReady) return
    const ids = [
      options.pendingDeepLinkReportId,
      options.selectedReportId,
    ].filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0
    )
    let cancelled = false
    for (const id of ids) {
      if (forcedTried.current.has(id)) continue
      forcedTried.current.add(id)
      void fetchReportById(options.db, id).then((result) => {
        if (cancelled || !result.ok) return
        setForcedRaw((prev) => {
          if (prev.some((r) => r.id === result.report.id)) return prev
          return [...prev, result.report]
        })
      })
    }
    return () => {
      cancelled = true
    }
  }, [
    options.enabled,
    options.authReady,
    options.db,
    options.pendingDeepLinkReportId,
    options.selectedReportId,
  ])
  const riderSource = useMemo(
    () => (riderLive ? riderRaw : []),
    [riderLive, riderRaw]
  )
  const viewportSource = useMemo(
    () => (viewportLive ? viewportRaw : []),
    [viewportLive, viewportRaw]
  )
  const ownerSource = useMemo(
    () => (ownerLive ? ownerRaw : []),
    [ownerLive, ownerRaw]
  )
  const forcedSource = useMemo(
    () => (options.enabled && options.authReady ? forcedRaw : []),
    [options.enabled, options.authReady, forcedRaw]
  )
  const riderReports = useMemo(() => {
    if (options.riderLat == null || options.riderLng == null) {
      return filterBoundedLiveReports(riderSource, {
        selectedReportId: options.selectedReportId,
        viewerDeviceId: options.viewerDeviceId,
        viewerUid: options.ownerUid,
      })
    }
    return filterBoundedLiveReports(riderSource, {
      centerLat: options.riderLat,
      centerLng: options.riderLng,
      maxDistanceMeters: RIDER_NEARBY_MAX_RADIUS_M,
      selectedReportId: options.selectedReportId,
      viewerDeviceId: options.viewerDeviceId,
      viewerUid: options.ownerUid,
    })
  }, [
    riderSource,
    options.riderLat,
    options.riderLng,
    options.selectedReportId,
    options.viewerDeviceId,
    options.ownerUid,
  ])
  const reports = useMemo(() => {
    const merged = mergeGeoReportSets({
      batches: [viewportSource, riderSource],
      owner: ownerSource,
      forced: forcedSource,
    }) as ReportDoc[]
    return filterBoundedLiveReports(merged, {
      selectedReportId: options.selectedReportId,
      viewerDeviceId: options.viewerDeviceId,
      viewerUid: options.ownerUid,
    })
  }, [
    viewportSource,
    riderSource,
    ownerSource,
    forcedSource,
    options.selectedReportId,
    options.viewerDeviceId,
    options.ownerUid,
  ])
  return {
    reports,
    riderReports,
    indexError: options.enabled ? indexError : null,
    stolenDeferred: true,
  }
}
