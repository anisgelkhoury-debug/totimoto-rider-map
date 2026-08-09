/**
 * TRN geographic query foundation (057A).
 * Pure helpers only — no App wiring, no Firestore listeners/writes.
 */

export {
  GEO_HASH_STORE_PRECISION,
  GEO_HASH_CELL_SIZE_NOTE,
  RIDER_NEARBY_MAX_RADIUS_KM,
  RIDER_NEARBY_MAX_RADIUS_M,
  GEO_QUERY_RADIUS_MIN_M,
  GEO_QUERY_RADIUS_MAX_M,
  VIEWPORT_RADIUS_PADDING,
  STOLEN_GEO_QUERY_STRATEGY,
} from "./geoConfig.ts"

export {
  isValidGeoCoordinate,
  parseGeoLatLng,
  isSafeQueryLatitude,
  type GeoLatLng,
} from "./coordinates.ts"

export {
  deriveExpiresAt,
  expiresAtOrNull,
  type DeriveExpiresAtInput,
  type DeriveExpiresAtResult,
} from "./expiresAt.ts"

export {
  encodeReportGeohash,
  geohashOrNull,
  type EncodeGeohashResult,
} from "./geohash.ts"

export {
  planGeohashQueryRanges,
  dedupeGeohashRanges,
  type GeohashQueryRange,
  type GeoQueryRangesResult,
} from "./queryRanges.ts"

export {
  planRiderCenteredGeoQuery,
  planViewportGeoQuery,
  type GeoQueryPlan,
  type GeoQueryPlanResult,
  type ViewportBoundsInput,
} from "./queryPlans.ts"

export {
  mergeGeoReportSets,
  readLegacyGeoFields,
  type GeoMergeableReport,
  type MergeGeoReportsOptions,
} from "./mergeReports.ts"

export {
  buildReportGeoMetadata,
  type ReportGeoMetadata,
  type BuildReportGeoMetadataInput,
  type BuildReportGeoMetadataResult,
} from "./reportGeoMetadata.ts"

export {
  buildReportGeoWriteFields,
  withGeoWriteFields,
  isValidStoredGeohashShape,
  geoDualWriteUsesFollowUpUpdate,
  geoDualWriteRequestsGps,
  type ReportGeoWriteFields,
  type BuildReportGeoWriteFieldsResult,
} from "./geoWriteFields.ts"

export {
  PLANNED_GEO_RANGE_QUERY,
  PLANNED_OWNER_UNRESOLVED_QUERY,
  EXPIRES_AT_QUERY_DECISION,
  STOLEN_INDEX_DECISION,
  ASSISTANCE_GEO_INDEX_DECISION,
  plannedGeoIndexDefinitions,
} from "./plannedQueries.ts"

export {
  useBoundedReportQueriesEnabled,
  useCompareBoundedReportQueriesEnabled,
  boundedReportQueriesDefaultOff,
  readEnvFlag,
} from "./featureFlag.ts"

export {
  buildResolvedGeohashRangeQueryShape,
  buildOwnerUnresolvedQueryShape,
  isMissingIndexError,
  BOUNDED_GEO_INDEX_REQUIRED,
  OWNER_UNRESOLVED_LIMIT,
} from "./queryBuilder.ts"

export {
  isReportExpiredForBounded,
  filterBoundedLiveReports,
  countMissingGeohash,
} from "./filterBoundedReports.ts"

export {
  VIEWPORT_IDLE_DEBOUNCE_MS,
  VIEWPORT_RESUBSCRIBE_MOVE_RATIO,
  shouldResubscribeViewport,
  createDebouncedViewportEmitter,
  viewportCenter,
  type ViewportBounds,
} from "./viewportDebounce.ts"

export {
  subscribeReportsByGeoRanges,
  mergeGeoRangeBuckets,
  retainRangeOnError,
} from "./subscribeGeoRanges.ts"
export { subscribeOwnerUnresolvedReports } from "./subscribeOwnerReports.ts"
export { fetchReportById } from "./fetchReportById.ts"
export { useBoundedReports } from "./useBoundedReports.ts"
export {
  compareFullVsBoundedReportIds,
  type ReportIdSetComparison,
} from "./compareReportIds.ts"

export {
  auditGeoMetadataCoverage,
  meetsShortLivedGeoCoverageGate,
  SHORT_LIVED_GEO_COVERAGE_CANARY_PCT,
  type GeoMetadataCoverageReport,
  type FamilyCoverage,
} from "./geoCoverageAudit.ts"

export {
  summarizeIdComparison,
  classifyComparisonDiffs,
  compareExpectedFilteredVsBounded,
  expectedOwnerEscapeIds,
  estimateBoundedReadCost,
  STOLEN_BOUNDED_CANARY_RECOMMENDATION,
  type ComparisonSummary,
  type ExpectedVsBoundedResult,
  type ReadCostEstimate,
  type DiffReason,
} from "./geoComparison.ts"
