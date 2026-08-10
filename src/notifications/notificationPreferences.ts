/**
 * TRN 058B — notification preference model, normalization, and eligibility.
 * Pure helpers (no Firebase / no GPS / no FCM send).
 */

/** Legacy keys kept for production Functions + old-client writes. */
export type LegacyNotificationPreferenceKey =
  | "helperLifecycle"
  | "ownerLifecycle"
  | "stolenNearby"
  | "criticalRoads"
  | "sharedRides"
  | "communityRides"
  | "announcements"
  | "marketing"

/** Nearby category keys (additive; ignored by lifecycle Functions until 058E). */
export type NearbyNotificationPreferenceKey =
  | "nearbyAlerts"
  | "checkpoint"
  | "accident"
  | "roadClosed"
  | "slippery"
  | "importantIncidents"

export type NotificationPreferenceKey =
  | LegacyNotificationPreferenceKey
  | NearbyNotificationPreferenceKey

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>

export const LEGACY_NOTIFICATION_PREFERENCE_KEYS: readonly LegacyNotificationPreferenceKey[] = [
  "helperLifecycle",
  "ownerLifecycle",
  "stolenNearby",
  "criticalRoads",
  "sharedRides",
  "communityRides",
  "announcements",
  "marketing",
] as const

export const NEARBY_NOTIFICATION_PREFERENCE_KEYS: readonly NearbyNotificationPreferenceKey[] = [
  "nearbyAlerts",
  "checkpoint",
  "accident",
  "roadClosed",
  "slippery",
  "importantIncidents",
] as const

export const ALL_NOTIFICATION_PREFERENCE_KEYS: readonly NotificationPreferenceKey[] = [
  ...LEGACY_NOTIFICATION_PREFERENCE_KEYS,
  ...NEARBY_NOTIFICATION_PREFERENCE_KEYS,
] as const

/** Defaults for new writes and safe normalization of partial/legacy docs. */
export function defaultNotificationPreferences(): NotificationPreferences {
  return {
    helperLifecycle: true,
    ownerLifecycle: true,
    stolenNearby: false,
    criticalRoads: false,
    sharedRides: false,
    communityRides: false,
    announcements: false,
    marketing: false,
    nearbyAlerts: false,
    checkpoint: true,
    accident: true,
    roadClosed: true,
    slippery: true,
    importantIncidents: true,
  }
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

/**
 * Normalize any subscription preference blob (missing → defaults).
 * nearbyAlerts absent → false. Assistance fields default true (current prod behavior).
 */
export function normalizeNotificationPreferences(
  raw: unknown
): NotificationPreferences {
  const defaults = defaultNotificationPreferences()
  if (!raw || typeof raw !== "object") return defaults
  const src = raw as Record<string, unknown>
  return {
    helperLifecycle: asBool(src.helperLifecycle, defaults.helperLifecycle),
    ownerLifecycle: asBool(src.ownerLifecycle, defaults.ownerLifecycle),
    stolenNearby: asBool(src.stolenNearby, defaults.stolenNearby),
    criticalRoads: asBool(src.criticalRoads, defaults.criticalRoads),
    sharedRides: asBool(src.sharedRides, defaults.sharedRides),
    communityRides: asBool(src.communityRides, defaults.communityRides),
    announcements: asBool(src.announcements, defaults.announcements),
    marketing: asBool(src.marketing, defaults.marketing),
    nearbyAlerts: asBool(src.nearbyAlerts, false),
    checkpoint: asBool(src.checkpoint, defaults.checkpoint),
    accident: asBool(src.accident, defaults.accident),
    roadClosed: asBool(src.roadClosed, defaults.roadClosed),
    slippery: asBool(src.slippery, defaults.slippery),
    importantIncidents: asBool(src.importantIncidents, defaults.importantIncidents),
  }
}

/** True when both lifecycle channels are on (settings UX “طلبات المساعدة”). */
export function isAssistanceLifecycleEnabled(prefs: NotificationPreferences): boolean {
  return prefs.helperLifecycle === true && prefs.ownerLifecycle === true
}

export function withAssistanceLifecycle(
  prefs: NotificationPreferences,
  enabled: boolean
): NotificationPreferences {
  return {
    ...prefs,
    helperLifecycle: enabled,
    ownerLifecycle: enabled,
  }
}

/** Pure: re-enable preserves server prefs; optional initial overlay for first create. */
export function mergePreferencesForReenable(
  existingRaw: unknown,
  initialPreferences?: Partial<NotificationPreferences>
): NotificationPreferences {
  const base = existingRaw
    ? normalizeNotificationPreferences(existingRaw)
    : defaultNotificationPreferences()
  if (!initialPreferences) return base
  return normalizeNotificationPreferences({ ...base, ...initialPreferences })
}

/** Pure: server disable patch — retain token; mark enabled false. */
export function subscriptionDisableUpdateFields(): { enabled: false } {
  return { enabled: false }
}

/**
 * Report categories that may ever be nearby-eligible in V1.
 * traffic / other / stolen / marketplace → never.
 */
export type NearbyEligibleReportCategory =
  | "checkpoint"
  | "accident"
  | "road_closed"
  | "slippery_road"
  | "fire"
  | "gunfire"
  | "explosionStrike"
  | "collapseDanger"

const CATEGORY_TO_PREF: Record<string, NearbyNotificationPreferenceKey | null> = {
  checkpoint: "checkpoint",
  accident: "accident",
  road_closed: "roadClosed",
  slippery_road: "slippery",
  fire: "importantIncidents",
  gunfire: "importantIncidents",
  explosionStrike: "importantIncidents",
  collapseDanger: "importantIncidents",
  traffic: null,
  otherIncident: null,
  other: null,
  stolen: null,
  marketplace: null,
  assistance: null,
  sharedRide: null,
}

/**
 * Category preference only (ignores master nearbyAlerts / enabled).
 * Used for UI and unit tests; delivery must also check master + subscription.
 */
export function isNearbyCategoryPreferenceOn(
  prefs: NotificationPreferences,
  reportCategory: string | null | undefined
): boolean {
  if (typeof reportCategory !== "string" || !reportCategory) return false
  const key = CATEGORY_TO_PREF[reportCategory]
  if (!key) return false
  return prefs[key] === true
}

/**
 * Full nearby eligibility for a future sender (058E).
 * Does not send. Requires master nearbyAlerts + enabled subscription semantics.
 */
export function isNearbyCategoryEnabled(
  prefs: NotificationPreferences,
  reportCategory: string | null | undefined
): boolean {
  if (prefs.nearbyAlerts !== true) return false
  return isNearbyCategoryPreferenceOn(prefs, reportCategory)
}

export type SubscriptionEligibilityInput = {
  enabled?: unknown
  permissionState?: unknown
  notificationPreferences?: unknown
}

/** Foundation for 058E — never send when disabled / denied / master off. */
export function isSubscriptionEligibleForNearbyAlert(
  subscription: SubscriptionEligibilityInput,
  reportCategory: string | null | undefined
): boolean {
  if (subscription.enabled !== true) return false
  if (subscription.permissionState !== "granted") return false
  const prefs = normalizeNotificationPreferences(subscription.notificationPreferences)
  return isNearbyCategoryEnabled(prefs, reportCategory)
}

/** Arabic copy for Notification Settings (058B). */
export const NOTIFICATION_SETTINGS_COPY_AR = {
  sectionTitle: "الإشعارات",
  statusPrefix: "الحالة:",
  assistanceTitle: "طلبات المساعدة",
  assistanceHelp: "تنبيهات عند قبول المساعدة أو إلغائها أو إقفال الطلب.",
  nearbyTitle: "تنبيهات قريبة مني",
  nearbyHelp:
    "بنبلغك عن الأشياء المهمة القريبة من آخر موقع شاركته مع TRN.",
  nearbyNotLiveYet:
    "مشاركة آخر موقع تقريبي تصير لما التطبيق مفتوح. إرسال التنبيهات القريبة لسا بالمرحلة الجاية.",
  nearbyDefaultOffHint: "مطفأة افتراضياً — اختيارك.",
  locationReady: "الموقع جاهز للتنبيهات",
  needLocation: "فعّل الموقع حتى توصلك التنبيهات القريبة",
  locationStale: "آخر موقع للتنبيهات قديم — افتح التطبيق بالموقع",
  categoryCheckpoint: "الحواجز",
  categoryAccident: "الحوادث",
  categoryRoadClosed: "الطرق المسكرة",
  categorySlippery: "الطرق الزلقة",
  categoryImportantIncidents: "الأحداث المهمة",
  privacyTitle: "قبل تفعيل التنبيهات القريبة",
  privacyBody:
    "حتى نبعتلك تنبيهات قريبة منك، TRN رح يستخدم آخر موقع شاركته معنا (بشكل تقريبي). ما منحتفظ بسجل تحركاتك، وما منعرض موقعك للدراجين التانيين. الاستخدام فقط لتنبيهات قريبة اختيارية.",
  privacyConfirm: "موافق، فعّل التفضيل",
  privacyCancel: "رجوع",
  enable: "تفعيل الإشعارات",
  enabling: "جارٍ التفعيل...",
  retry: "إعادة المحاولة",
  disable: "إيقاف الإشعارات",
  disabling: "جارٍ الإيقاف...",
  saving: "جارٍ الحفظ...",
  openInstallGuide: "فتح تعليمات التثبيت",
  deniedHint:
    "الإشعارات موقوفة من إعدادات المتصفح. فعّلها للموقع وحاول مرة ثانية.",
  disableOk: "تم إيقاف الإشعارات على هذا الجهاز والخادم.",
  disableFail: "تعذّر إيقاف الإشعارات على الخادم. حاول مرة أخرى.",
  prefsSaveFail: "تعذّر حفظ التفضيلات. حاول مرة أخرى.",
  categoriesNeedNearby: "فعّل «تنبيهات قريبة مني» أولاً لضبط الأنواع.",
} as const
