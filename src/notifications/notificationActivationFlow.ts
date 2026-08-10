/**
 * Pure helpers for notification activation UX (058G-DIAG).
 * Keeps settings enable path free of modal ghost-dismiss races.
 */

import type { NotificationPermissionState } from "./notificationSupport"

/** When permission already granted, skip a redundant browser prompt UX branch. */
export function shouldRequestBrowserPermission(
  permission: NotificationPermissionState
): boolean {
  return permission === "default"
}

/**
 * Denied cannot be re-prompted via Notification.requestPermission().
 * UI must show an actionable Arabic hint instead of a silent no-op.
 */
export function deniedRequiresBrowserSettingsHint(
  permission: NotificationPermissionState
): boolean {
  return permission === "denied"
}
