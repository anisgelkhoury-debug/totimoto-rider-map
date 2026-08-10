/**
 * TRN 058H — hard server-side nearby FCM send gate + temporary canary allowlist.
 *
 * Real FCM requires BOTH:
 *   ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND === true
 *   AND recipient subscriptionId ∈ NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS
 *
 * Non-allowlisted eligible recipients never receive FCM.
 * After canary: gate false and allowlist empty (mandatory).
 */

/** Flip true only for controlled canary / explicit send tasks. */
export const ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND: boolean = false

/**
 * Temporary canary allowlist (subscription document ids only — never FCM tokens).
 * Empty after 058H shutdown ⇒ nobody receives real nearby FCM even if gate were true.
 */
export const NEARBY_NOTIFICATION_CANARY_SUBSCRIPTION_IDS: ReadonlySet<string> =
  new Set([])

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
