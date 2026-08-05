/**
 * Safe data-only FCM payloads for remaining lifecycle events.
 */

const APP_ORIGIN = "https://app.totimoto.com"
const ICON = "/icon-192.png"
const BADGE = "/icon-192.png"

export type LifecycleDataPayload = {
  title: string
  body: string
  reportId?: string
  notificationType: string
  deepLink: string
  icon: string
  badge: string
  tag: string
  createdAt: string
}

export function buildHelperCancelledPayload(
  reportId: string,
  createdAtMs = Date.now()
): LifecycleDataPayload {
  const safeReportId = String(reportId || "").trim()
  return {
    title: "المساعد ألغى الطلب",
    body: "تم فتح طلبك مجدداً لمساعد آخر",
    reportId: safeReportId,
    notificationType: "helper_cancelled",
    deepLink: `${APP_ORIGIN}/?report=${encodeURIComponent(safeReportId)}&notification=helper_cancelled`,
    icon: ICON,
    badge: BADGE,
    tag: `trn-helper-cancelled-${safeReportId}`,
    createdAt: String(createdAtMs),
  }
}

export function buildOwnerResolvedPayload(
  reportId: string,
  createdAtMs = Date.now()
): LifecycleDataPayload {
  const safeReportId = String(reportId || "").trim()
  return {
    title: "تم إنهاء طلب المساعدة",
    body: "اضغط لمراجعة التفاصيل",
    reportId: safeReportId,
    notificationType: "owner_resolved",
    deepLink: `${APP_ORIGIN}/?report=${encodeURIComponent(safeReportId)}&notification=owner_resolved`,
    icon: ICON,
    badge: BADGE,
    tag: `trn-owner-resolved-${safeReportId}`,
    createdAt: String(createdAtMs),
  }
}

/**
 * Deleted report — omit reportId from data and deep link (report no longer exists).
 */
export function buildOwnerCancelledPayload(
  reportId: string,
  createdAtMs = Date.now()
): LifecycleDataPayload {
  const safeReportId = String(reportId || "").trim()
  return {
    title: "تم إلغاء طلب المساعدة",
    body: "لم يعد الطلب متاحاً",
    notificationType: "owner_cancelled",
    deepLink: `${APP_ORIGIN}/?notification=owner_cancelled`,
    icon: ICON,
    badge: BADGE,
    tag: `trn-owner-cancelled-${safeReportId}`,
    createdAt: String(createdAtMs),
  }
}

/** Flatten to string-only FCM data map (omit undefined). */
export function toFcmDataMap(payload: LifecycleDataPayload): Record<string, string> {
  const out: Record<string, string> = {
    title: payload.title,
    body: payload.body,
    notificationType: payload.notificationType,
    deepLink: payload.deepLink,
    icon: payload.icon,
    badge: payload.badge,
    tag: payload.tag,
    createdAt: payload.createdAt,
  }
  if (payload.reportId !== undefined) {
    out.reportId = payload.reportId
  }
  return out
}
