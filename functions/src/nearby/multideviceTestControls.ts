/**
 * TRN 058M — fail-closed multi-device nearby test-control helpers.
 *
 * TEST / CONTROL ONLY. Not imported by production send (`index.ts`,
 * `processNearbyReport.ts`). Never stores real subscription IDs, FCM tokens,
 * or production UIDs. Does not flip the send gate or write ops config.
 */

import { geohashForLocation } from "geofire-common"
import {
  NEARBY_BUDGET_POLICY,
  decideNearbyBudget,
  nearbyBudgetActionAfterSend,
  type NearbyBudgetState,
} from "./nearbyBudget"
import { EMPTY_NEARBY_OBSERVABILITY_COUNTS } from "./nearbyObservability"
import { NEARBY_ROLLOUT_DEFAULT_CONFIG } from "./rolloutConfig"
import {
  ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND,
  NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS,
} from "./sendGate"
import { nearbyNotificationRadiusMeters } from "../shared/nearbyNotificationRadii"
import {
  NOTIFICATION_LOCATION_GEOHASH_PRECISION,
  planNotificationRecipientCellsForCategory,
} from "../shared/recipientGeoPlan"
import {
  LOCATION_MAX_NOTIFICATION_STALENESS_MS,
  filterNearbyNotificationRecipients,
  isSelfReporterSubscription,
  type NearbyRecipientSubscriptionDoc,
} from "../shared/recipientTargeting"

export const TRN058M_ROLES = [
  "A_REPORTER",
  "B_ELIGIBLE_1",
  "C_ELIGIBLE_2",
  "D_OUTSIDE_RADIUS",
  "E_STALE",
  "F_ALERTS_OFF",
  "F_ACCIDENT_PREF_OFF",
  "G_INVALID_TOKEN",
] as const

export type Trn058mRole = (typeof TRN058M_ROLES)[number]

/** Synthetic document ids — prefixed, never production subscription ids. */
export const TRN058M_SYNTHETIC_SUB_IDS: Record<Trn058mRole, string> = {
  A_REPORTER: "trn058m-sub-a-reporter",
  B_ELIGIBLE_1: "trn058m-sub-b-eligible-1",
  C_ELIGIBLE_2: "trn058m-sub-c-eligible-2",
  D_OUTSIDE_RADIUS: "trn058m-sub-d-outside",
  E_STALE: "trn058m-sub-e-stale",
  F_ALERTS_OFF: "trn058m-sub-f-alerts-off",
  F_ACCIDENT_PREF_OFF: "trn058m-sub-f-accident-off",
  G_INVALID_TOKEN: "trn058m-sub-g-invalid-token",
}

export const TRN058M_SYNTHETIC_UIDS = {
  A_REPORTER: "trn058m-uid-a-reporter",
  B_ELIGIBLE_1: "trn058m-uid-b-eligible-1",
  C_ELIGIBLE_2: "trn058m-uid-c-eligible-2",
  D_OUTSIDE_RADIUS: "trn058m-uid-d-outside",
  E_STALE: "trn058m-uid-e-stale",
  F_ALERTS_OFF: "trn058m-uid-f-alerts-off",
  F_ACCIDENT_PREF_OFF: "trn058m-uid-f-accident-off",
  G_INVALID_TOKEN: "trn058m-uid-g-invalid-token",
  /** Optional same-uid pair (V1 budget is per subscription, not per uid). */
  SHARED_B: "trn058m-uid-shared-b",
} as const

export const TRN058M_SAME_UID_SUB_IDS = {
  B1: "trn058m-sub-shared-b1",
  B2: "trn058m-sub-shared-b2",
} as const

export const TRN058M_WAVE1_REPORT = {
  lat: 33.8938,
  lng: 35.5018,
  reportCategory: "accident" as const,
  reportFamily: "intelligence" as const,
  ownerUid: TRN058M_SYNTHETIC_UIDS.A_REPORTER,
  resolved: false,
}

/**
 * V1 recipient geo is geohash range bounds (no haversine). A 1.6 km offset can
 * still fall inside covering cells for accident 1.5 km. 058M places D ~5 km
 * north so the precision-6 geohash is outside every accident query range.
 */
export const TRN058M_OUTSIDE_RADIUS_OFFSET_KM = 5
export const TRN058M_OUTSIDE_RADIUS_WHY =
  "Accident radius is 1.5 km via geohashQueryBounds, not exact haversine. " +
  "A borderline 1.6 km fixture can still match a covering cell. " +
  "D is placed ~5 km north of the report so its precision-6 geohash is " +
  "outside every accident range."

const KM_PER_DEG_LAT = 111.32

export const TRN058M_WAVE1_ROLES: readonly Trn058mRole[] = [
  "A_REPORTER",
  "B_ELIGIBLE_1",
  "C_ELIGIBLE_2",
  "D_OUTSIDE_RADIUS",
  "E_STALE",
  "F_ALERTS_OFF",
]

export const TRN058M_INVALID_TOKEN_ERROR =
  "messaging/registration-token-not-registered" as const

/**
 * Sender outcome currently returns these count fields.
 * Gaps: self/stale/preference counters exist on NearbyObservabilityCounts
 * but processNearbyReport does not populate or log them. HIGH interval
 * rejections increment cooldownRejectedCount only (no dedicated field).
 */
export const TRN058M_SENDER_COUNT_FIELDS = {
  candidateCount: true,
  eligibleCount: true,
  selfExcludedCount: false,
  staleLocationRejectedCount: false,
  preferenceRejectedCount: false,
  rolloutRejectedCount: true,
  cooldownRejectedCount: true,
  attempted: true,
  success: true,
  failed: true,
  disabledTokens: true,
} as const

export const TRN058M_OBSERVABILITY_GAPS: readonly string[] = [
  "selfExcludedCount not populated on NearbyNotifyOutcome / nearby_report_outcome",
  "staleLocationRejectedCount not populated on sender outcome / logs",
  "preferenceRejectedCount not populated on sender outcome / logs",
  "HIGH interval reject increments cooldownRejectedCount only (no highIntervalRejectedCount)",
]

export function trn058mSyntheticToken(role: string): string {
  return `tok-synth-058m-${role.toLowerCase().replace(/_/g, "-")}`
}

export function trn058mOutsideRadiusCoords(): { lat: number; lng: number } {
  return {
    lat:
      TRN058M_WAVE1_REPORT.lat +
      TRN058M_OUTSIDE_RADIUS_OFFSET_KM / KM_PER_DEG_LAT,
    lng: TRN058M_WAVE1_REPORT.lng,
  }
}

export function trn058mGeohashAt(lat: number, lng: number): string {
  return geohashForLocation(
    [lat, lng],
    NOTIFICATION_LOCATION_GEOHASH_PRECISION
  )
}

export function trn058mAccidentQueryPlan() {
  return planNotificationRecipientCellsForCategory({
    reportLat: TRN058M_WAVE1_REPORT.lat,
    reportLng: TRN058M_WAVE1_REPORT.lng,
    reportCategory: TRN058M_WAVE1_REPORT.reportCategory,
  })
}

export function geohashCoveredByRanges(
  geohash: string,
  ranges: ReadonlyArray<{ start: string; end: string }>
): boolean {
  const gh = String(geohash || "").trim().toLowerCase()
  if (gh.length !== 6) return false
  return ranges.some((r) => gh >= r.start && gh <= r.end)
}

export function trn058mGeohashInAccidentQuery(geohash: string): boolean {
  const plan = trn058mAccidentQueryPlan()
  if (!plan.ok) return false
  return geohashCoveredByRanges(geohash, plan.ranges)
}

function optedInPrefs(overrides: Record<string, boolean> = {}) {
  return {
    nearbyAlerts: true,
    accident: true,
    checkpoint: true,
    roadClosed: true,
    slippery: true,
    importantIncidents: true,
    ...overrides,
  }
}

export function buildTrn058mSubscription(
  role: Trn058mRole,
  nowMs: number,
  extra: Partial<NearbyRecipientSubscriptionDoc> = {}
): NearbyRecipientSubscriptionDoc {
  const inside = trn058mGeohashAt(
    TRN058M_WAVE1_REPORT.lat,
    TRN058M_WAVE1_REPORT.lng
  )
  const outside = trn058mGeohashAt(
    trn058mOutsideRadiusCoords().lat,
    trn058mOutsideRadiusCoords().lng
  )
  const base: NearbyRecipientSubscriptionDoc = {
    id: TRN058M_SYNTHETIC_SUB_IDS[role],
    uid: TRN058M_SYNTHETIC_UIDS[role],
    enabled: true,
    permissionState: "granted",
    token: trn058mSyntheticToken(role),
    locationGeohash: inside,
    locationUpdatedAt: nowMs - 60_000,
    notificationPreferences: optedInPrefs(),
  }
  if (role === "A_REPORTER") {
    base.uid = TRN058M_SYNTHETIC_UIDS.A_REPORTER
  }
  if (role === "D_OUTSIDE_RADIUS") {
    base.locationGeohash = outside
  }
  if (role === "E_STALE") {
    base.locationUpdatedAt =
      nowMs - LOCATION_MAX_NOTIFICATION_STALENESS_MS - 60_000
  }
  if (role === "F_ALERTS_OFF") {
    base.notificationPreferences = optedInPrefs({ nearbyAlerts: false })
  }
  if (role === "F_ACCIDENT_PREF_OFF") {
    base.notificationPreferences = optedInPrefs({ accident: false })
  }
  return { ...base, ...extra }
}

export function buildTrn058mWave1Subscriptions(
  nowMs: number
): NearbyRecipientSubscriptionDoc[] {
  return TRN058M_WAVE1_ROLES.map((role) => buildTrn058mSubscription(role, nowMs))
}

export type Trn058mDeviceExpectation = {
  role: Trn058mRole
  geoCandidate: boolean
  selfExcluded: boolean
  staleExcluded: boolean
  preferenceExcluded: boolean
  recipientEligible: boolean
  fcm: number
  eventSent: number
  budgetHourDelta: number
  budgetDayDelta: number
  pendingReservations: number
}

export type Trn058mWave1Expectation = {
  uniqueGeoCandidateRoles: Trn058mRole[]
  uniqueGeoCandidateCount: number
  selfExcludedCount: number
  staleRejectedCount: number
  preferenceRejectedCount: number
  recipientEligibleRoles: Trn058mRole[]
  sendRoles: Trn058mRole[]
  attempted: number
  success: number
  failed: number
  devices: Trn058mDeviceExpectation[]
}

function classifyDevice(
  role: Trn058mRole,
  doc: NearbyRecipientSubscriptionDoc,
  nowMs: number
): Trn058mDeviceExpectation {
  const geoCandidate = trn058mGeohashInAccidentQuery(
    String(doc.locationGeohash || "")
  )
  const selfExcluded = isSelfReporterSubscription(doc, {
    ownerUid: TRN058M_WAVE1_REPORT.ownerUid,
    reportCategory: TRN058M_WAVE1_REPORT.reportCategory,
  })
  const eligible = filterNearbyNotificationRecipients({
    candidates: [doc],
    report: {
      ownerUid: TRN058M_WAVE1_REPORT.ownerUid,
      reportCategory: TRN058M_WAVE1_REPORT.reportCategory,
      reportFamily: TRN058M_WAVE1_REPORT.reportFamily,
      resolved: false,
    },
    nowMs,
  })
  const recipientEligible = geoCandidate && eligible.length === 1
  const staleExcluded =
    geoCandidate &&
    !selfExcluded &&
    !recipientEligible &&
    role === "E_STALE"
  const preferenceExcluded =
    geoCandidate &&
    !selfExcluded &&
    !recipientEligible &&
    (role === "F_ALERTS_OFF" || role === "F_ACCIDENT_PREF_OFF")
  const send = recipientEligible && (role === "B_ELIGIBLE_1" || role === "C_ELIGIBLE_2")
  return {
    role,
    geoCandidate,
    selfExcluded,
    staleExcluded,
    preferenceExcluded,
    recipientEligible,
    fcm: send ? 1 : 0,
    eventSent: send ? 1 : 0,
    budgetHourDelta: send ? 1 : 0,
    budgetDayDelta: send ? 1 : 0,
    pendingReservations: 0,
  }
}

/** Pure Wave-1 expected counts from synthetic fixtures + existing filters. */
export function evaluateTrn058mWave1Expectations(
  nowMs: number
): Trn058mWave1Expectation {
  const docs = buildTrn058mWave1Subscriptions(nowMs)
  const devices = TRN058M_WAVE1_ROLES.map((role, i) =>
    classifyDevice(role, docs[i], nowMs)
  )
  const uniqueGeoCandidateRoles = devices
    .filter((d) => d.geoCandidate)
    .map((d) => d.role)
  const recipientEligibleRoles = devices
    .filter((d) => d.recipientEligible)
    .map((d) => d.role)
  const sendRoles = devices.filter((d) => d.fcm === 1).map((d) => d.role)
  return {
    uniqueGeoCandidateRoles,
    uniqueGeoCandidateCount: uniqueGeoCandidateRoles.length,
    selfExcludedCount: devices.filter((d) => d.selfExcluded).length,
    staleRejectedCount: devices.filter((d) => d.staleExcluded).length,
    preferenceRejectedCount: devices.filter((d) => d.preferenceExcluded).length,
    recipientEligibleRoles,
    sendRoles,
    attempted: sendRoles.length,
    success: sendRoles.length,
    failed: 0,
    devices,
  }
}

export function trn058mWave1Stage1Allowlist(): string[] {
  return [
    TRN058M_SYNTHETIC_SUB_IDS.B_ELIGIBLE_1,
    TRN058M_SYNTHETIC_SUB_IDS.C_ELIGIBLE_2,
    TRN058M_SYNTHETIC_SUB_IDS.D_OUTSIDE_RADIUS,
    TRN058M_SYNTHETIC_SUB_IDS.E_STALE,
    TRN058M_SYNTHETIC_SUB_IDS.F_ALERTS_OFF,
  ]
}

export function assertTrn058mProductionClosed(): {
  sendGate: false
  canaryEmpty: true
  defaultStage: 0
  defaultEnabled: false
} {
  if (ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND !== false) {
    throw new Error("058M stop: production send gate is not false")
  }
  if (NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS.size !== 0) {
    throw new Error("058M stop: canary Set is not empty")
  }
  if (NEARBY_ROLLOUT_DEFAULT_CONFIG.stage !== 0) {
    throw new Error("058M stop: default stage is not 0")
  }
  if (NEARBY_ROLLOUT_DEFAULT_CONFIG.enabled !== false) {
    throw new Error("058M stop: default ops enabled is not false")
  }
  return {
    sendGate: false,
    canaryEmpty: true,
    defaultStage: 0,
    defaultEnabled: false,
  }
}

export function highIntervalStillOpen(
  lastSentAtMs: number,
  nowMs: number
): boolean {
  return nowMs - lastSentAtMs >= NEARBY_BUDGET_POLICY.highMinIntervalMs
}

export function expectHighCooldownReject(input: {
  lastSentAtMs: number
  nowMs: number
}): boolean {
  const state: NearbyBudgetState = {
    hourWindowStartMs: input.lastSentAtMs,
    hourCount: 1,
    dayWindowStartMs: input.lastSentAtMs,
    dayCount: 1,
    lastSentAtMs: input.lastSentAtMs,
    criticalWindowStartMs: null,
    criticalCount: 0,
  }
  const d = decideNearbyBudget({
    state,
    severity: "HIGH",
    nowMs: input.nowMs,
  })
  return d.allow === false && d.reason === "REJECT_HIGH_INTERVAL"
}

export function invalidTokenBudgetAction(): ReturnType<
  typeof nearbyBudgetActionAfterSend
> {
  return nearbyBudgetActionAfterSend({
    fcmSuccess: false,
    permanentInvalidToken: true,
    eventClaim: "claimed",
  })
}

export function emptyObservabilityBaseline() {
  return { ...EMPTY_NEARBY_OBSERVABILITY_COUNTS }
}

export function accidentRadiusMeters(): number {
  return nearbyNotificationRadiusMeters("accident") ?? 0
}
