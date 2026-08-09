/**
 * TRN 058E — hard server-side nearby FCM send gate.
 * Default FALSE. Flip only for controlled canary / production rollout tasks.
 */

/** Must stay false until Anis explicitly enables a canary/production send task. */
export const ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND: boolean = false

export function isNearbyNotificationSendAllowed(
  override?: boolean
): boolean {
  if (typeof override === "boolean") return override
  return ALLOW_PRODUCTION_NEARBY_NOTIFICATION_SEND
}
