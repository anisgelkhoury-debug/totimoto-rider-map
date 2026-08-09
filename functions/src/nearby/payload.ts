/**
 * TRN 058E — data-only FCM payload for nearby report alerts.
 * No UID/token/phone/coords. No exact distance (coarse location only).
 */

import { nearbyNotificationCopyForCategory } from "./copy"
import {
  payloadContainsForbiddenKeys,
  payloadValuesAreAllStrings,
} from "../shared/payloadSafety"

const APP_ORIGIN = "https://app.totimoto.com"
const ICON = "/icon-192.png"
const BADGE = "/icon-192.png"

export type NearbyReportDataPayload = {
  title: string
  body: string
  reportId: string
  notificationType: string
  deepLink: string
  icon: string
  badge: string
  tag: string
  createdAt: string
  category: string
}

export function nearbyNotificationType(category: string): string {
  return `nearby_${category}`
}

export function buildNearbyReportDeepLink(
  reportId: string,
  category: string
): string {
  const id = String(reportId || "").trim()
  const type = nearbyNotificationType(category)
  return `${APP_ORIGIN}/?report=${encodeURIComponent(id)}&notification=${encodeURIComponent(type)}`
}

export function buildNearbyReportEventKey(
  reportId: string,
  subscriptionId: string
): string {
  return `nearby_report:${String(reportId).trim()}:${String(subscriptionId).trim()}`
}

export function buildNearbyReportPayload(input: {
  reportId: string
  category: string
  createdAtMs?: number
}): NearbyReportDataPayload | null {
  const copy = nearbyNotificationCopyForCategory(input.category)
  if (!copy) return null
  const reportId = String(input.reportId || "").trim()
  if (!reportId) return null
  const notificationType = nearbyNotificationType(input.category)
  const createdAtMs = input.createdAtMs ?? Date.now()
  return {
    title: copy.title,
    body: copy.body,
    reportId,
    notificationType,
    deepLink: buildNearbyReportDeepLink(reportId, input.category),
    icon: ICON,
    badge: BADGE,
    tag: `trn-nearby-${reportId}`,
    createdAt: String(createdAtMs),
    category: input.category,
  }
}

export function assertNearbyPayloadSafe(
  payload: Record<string, string>
): boolean {
  if (payloadContainsForbiddenKeys(payload)) return false
  if (!payloadValuesAreAllStrings(payload)) return false
  const joined = `${payload.title || ""} ${payload.body || ""}`
  if (/\d+(\.\d+)?\s*كم/.test(joined)) return false
  if (/\d+\s*م\b/.test(joined)) return false
  return true
}
