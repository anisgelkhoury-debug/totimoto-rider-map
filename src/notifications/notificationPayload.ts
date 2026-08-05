/**
 * FCM / mock notification display + deep-link helpers (safe for SW + page + tests).
 * Never logs tokens.
 */

export type TrnNotificationType =
  | "helper_accepted"
  | "helper_cancelled"
  | "owner_resolved"
  | "owner_cancelled"
  | "mock"
  | string

export type TrnDeepLinkParts = {
  reportId: string | null
  notificationType: string | null
}

export type TrnDisplayNotification = {
  title: string
  body: string
  icon: string
  badge: string
  tag: string
  data: {
    reportId: string
    notificationType: string
    deepLink: string
  }
}

const DEFAULT_ICON = "/icon-192.png"
const DEFAULT_BADGE = "/icon-192.png"
const DEFAULT_TITLE = "توتيموتو"
const DEFAULT_BODY = "لديك تنبيه جديد"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export function buildTrnDeepLink(
  parts: { reportId?: string | null; notificationType?: string | null },
  origin = ""
): string {
  const params = new URLSearchParams()
  if (parts.reportId) params.set("report", String(parts.reportId))
  if (parts.notificationType) params.set("notification", String(parts.notificationType))
  const query = params.toString()
  const path = query ? `/?${query}` : "/"
  if (!origin) return path
  return `${origin.replace(/\/$/, "")}${path}`
}

export function parseTrnSearchParams(search: string): TrnDeepLinkParts {
  const raw = search.startsWith("?") ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  const reportId = params.get("report")?.trim() || null
  const notificationType = params.get("notification")?.trim() || null
  return { reportId, notificationType }
}

/**
 * Normalize FCM payload or mock object into a displayable notification.
 */
export function normalizeFcmDisplayPayload(
  payload: unknown,
  origin = ""
): TrnDisplayNotification {
  const root = asRecord(payload)
  const notification = asRecord(root.notification)
  const data = asRecord(root.data)

  const title =
    asString(notification.title) ||
    asString(data.title) ||
    asString(root.title) ||
    DEFAULT_TITLE

  const body =
    asString(notification.body) ||
    asString(data.body) ||
    asString(root.body) ||
    DEFAULT_BODY

  const reportId =
    asString(data.reportId) ||
    asString(root.reportId) ||
    ""

  const notificationType =
    asString(data.notificationType) ||
    asString(root.notificationType) ||
    "mock"

  const icon =
    asString(notification.icon) ||
    asString(data.icon) ||
    asString(root.icon) ||
    DEFAULT_ICON

  const badge =
    asString(notification.badge) ||
    asString(data.badge) ||
    asString(root.badge) ||
    DEFAULT_BADGE

  const tag =
    asString(data.tag) ||
    asString(root.tag) ||
    (reportId
      ? `trn-${notificationType}-${reportId}`
      : `trn-${notificationType}`)

  const deepLink =
    asString(data.deepLink) ||
    asString(root.deepLink) ||
    buildTrnDeepLink({ reportId, notificationType }, origin)

  return {
    title,
    body,
    icon,
    badge,
    tag,
    data: {
      reportId,
      notificationType,
      deepLink,
    },
  }
}

/** Local/dev mock payload factory — never used for production sends. */
export function createMockNotificationPayload(input?: {
  title?: string
  body?: string
  reportId?: string
  notificationType?: TrnNotificationType
  icon?: string
  tag?: string
}): Record<string, unknown> {
  const reportId = input?.reportId ?? "mock-report-1"
  const notificationType = input?.notificationType ?? "mock"
  return {
    notification: {
      title: input?.title ?? "تنبيه تجريبي",
      body: input?.body ?? "هذا اختبار محلي للإشعارات — لا إرسال إنتاجي",
      icon: input?.icon ?? DEFAULT_ICON,
    },
    data: {
      reportId,
      notificationType,
      tag: input?.tag ?? `trn-mock-${reportId}`,
      deepLink: buildTrnDeepLink({ reportId, notificationType }),
    },
  }
}
