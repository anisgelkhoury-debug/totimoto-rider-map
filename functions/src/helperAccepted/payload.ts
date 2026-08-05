/**
 * Safe data-only FCM payload for helper_accepted.
 * No UIDs, tokens, phones, names, or coordinates.
 */

export { payloadContainsForbiddenKeys } from "../shared/payloadSafety"

export type HelperAcceptedDataPayload = {
  title: string
  body: string
  reportId: string
  notificationType: string
  deepLink: string
  icon: string
  badge: string
  tag: string
  createdAt: string
}

const APP_ORIGIN = "https://app.totimoto.com"
const ICON = "/icon-192.png"
const BADGE = "/icon-192.png"

export function buildHelperAcceptedPayload(
  reportId: string,
  createdAtMs = Date.now()
): HelperAcceptedDataPayload {
  const safeReportId = String(reportId || "").trim()
  return {
    title: "يوجد درّاج قادم لمساعدتك",
    body: "اضغط لمتابعة الطلب على الخريطة",
    reportId: safeReportId,
    notificationType: "helper_accepted",
    deepLink: `${APP_ORIGIN}/?report=${encodeURIComponent(safeReportId)}&notification=helper_accepted`,
    icon: ICON,
    badge: BADGE,
    tag: `trn-helper-accepted-${safeReportId}`,
    createdAt: String(createdAtMs),
  }
}
