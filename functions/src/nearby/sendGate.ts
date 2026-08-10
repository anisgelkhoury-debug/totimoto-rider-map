/**
 * TRN 058H — hard server-side nearby FCM send gate + temporary canary allowlist.
 *
 * Real FCM requires BOTH:
 *   ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND === true
 *   AND recipient subscriptionId ∈ NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
 *
 * Non-allowlisted eligible recipients never receive FCM.
 * After canary: set gate false and clear allowlist.
 */

/** Flip true only for controlled canary / explicit send tasks. */
export const ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND: boolean = true

/**
 * Temporary canary: only these subscription document ids may receive real nearby FCM.
 * Empty set ⇒ nobody receives real nearby FCM even if gate is true.
 * Do not put FCM tokens here.
 */
export const NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS: ReadonlySet<string> =
  new Set([
    // Device B (058G verified recipient) — subscription doc id only
    "d5b037a3d04c2a75763a0e7c07d6a5ff",
  ])

export function isNearbyNotificationSendAllowed(
  override?: boolean
): boolean {
  if (typeof override === "boolean") return override
  return ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND
}

export function nearbyCanaryAllowlistSize(
  allowlist: ReadonlySet<string> = NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
): number {
  return allowlist.size
}

export function isNearbyCanaryModeActive(
  allowlist: ReadonlySet<string> = NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
): boolean {
  return (
    isNearbyNotificationSendAllowed() && nearbyCanaryAllowlistSize(allowlist) > 0
  )
}

/** True when this subscription may receive a real nearby send under canary rules. */
export function isNearbyCanaryRecipient(
  subscriptionId: string | null | undefined,
  allowlist: ReadonlySet<string> = NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
): boolean {
  const id = String(subscriptionId || "").trim()
  if (!id) return false
  return allowlist.has(id)
}

export function filterNearbyCanaryRecipients<
  T extends { subscriptionId: string },
>(
  recipients: readonly T[],
  allowlist: ReadonlySet<string> = NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
): T[] {
  return recipients.filter((r) =>
    isNearbyCanaryRecipient(r.subscriptionId, allowlist)
  )
}
