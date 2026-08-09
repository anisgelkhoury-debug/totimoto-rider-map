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
