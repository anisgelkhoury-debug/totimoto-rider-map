/**
 * Payload safety — reject accidental PII-like keys.
 */

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

/** FCM data maps must be string-only. */
export function payloadValuesAreAllStrings(
  payload: Record<string, unknown>
): boolean {
  return Object.values(payload).every((value) => typeof value === "string")
}
