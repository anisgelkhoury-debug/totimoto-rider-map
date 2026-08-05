/**
 * Lightweight subscription metadata + production write kill switch.
 * Kept Firebase-free so unit tests can import without the client SDK.
 */

import type { NotificationSupportResult } from "./notificationSupport"

/** Flip to true only after secure rules are live (or when targeting emulator). */
export const ALLOW_PRODUCTION_SUBSCRIPTION_WRITE = false

export function detectPlatform(
  support: NotificationSupportResult
): "android" | "ios" | "desktop" | "unknown" {
  if (support.isIos) return "ios"
  if (typeof navigator === "undefined") return "unknown"
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return "android"
  if (/Windows|Macintosh|Linux/i.test(ua)) return "desktop"
  return "unknown"
}

export function detectBrowserLabel(): string {
  if (typeof navigator === "undefined") return "unknown"
  const ua = navigator.userAgent
  if (/Edg\//i.test(ua)) return "edge"
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return "chrome"
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "safari"
  if (/Firefox\//i.test(ua)) return "firefox"
  return "other"
}
