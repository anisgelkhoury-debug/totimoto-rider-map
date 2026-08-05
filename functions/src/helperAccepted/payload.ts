/**
 * Safe data-only FCM payload for helper_accepted.
 * No UIDs, tokens, phones, names, or coordinates.
 */

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

/** Reject payloads that accidentally include PII-like keys. */
export function payloadContainsForbiddenKeys(
  payload: Record<string, unknown>
): boolean {
  const forbidden = [
    "uid",
    "ownerUid",
    "helperUid",
    "token",
    "phone",
    "ownerPhone",
    "helperPhone",
    "ownerName",
    "helperName",
    "lat",
    "lng",
    "helperLat",
    "helperLng",
  ]
  return Object.keys(payload).some((key) => forbidden.includes(key))
}
