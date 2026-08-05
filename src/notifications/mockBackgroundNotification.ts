/**
 * Ask the active service worker to show a mock notification (localhost only).
 * Does not send via FCM / Cloud Functions.
 */
import { createMockNotificationPayload } from "./notificationPayload"

export async function requestMockBackgroundNotification(
  overrides?: Parameters<typeof createMockNotificationPayload>[0]
): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return false
  }
  const host = window.location.hostname
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") {
    return false
  }

  const registration = await navigator.serviceWorker.ready
  const worker = registration.active
  if (!worker) return false

  worker.postMessage({
    type: "TRN_MOCK_BACKGROUND_NOTIFICATION",
    payload: createMockNotificationPayload(overrides),
  })
  return true
}
