/**
 * Subscription selection + invalid-token helpers (pure).
 */

export type SubscriptionDoc = {
  id: string
  uid?: unknown
  enabled?: unknown
  permissionState?: unknown
  token?: unknown
  notificationPreferences?: {
    helperLifecycle?: unknown
  } | null
}

export type SelectedSubscription = {
  id: string
  token: string
}

export function isValidFcmToken(token: unknown): token is string {
  return typeof token === "string" && token.trim().length > 0 && token.trim().length <= 4096
}

export function selectEnabledHelperLifecycleSubscriptions(
  docs: SubscriptionDoc[],
  ownerUid: string
): SelectedSubscription[] {
  const uid = ownerUid.trim()
  if (!uid) return []

  const selected: SelectedSubscription[] = []
  for (const doc of docs) {
    if (doc.uid !== uid) continue
    if (doc.enabled !== true) continue
    if (doc.permissionState !== "granted") continue
    if (doc.notificationPreferences?.helperLifecycle !== true) continue
    if (!isValidFcmToken(doc.token)) continue
    selected.push({ id: doc.id, token: doc.token.trim() })
  }
  return selected
}

export function isPermanentInvalidTokenError(code: unknown): boolean {
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  )
}
