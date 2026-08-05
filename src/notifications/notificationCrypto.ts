/**
 * Pure crypto helpers for notification subscription IDs.
 */

export async function sha256Hex(value: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/** Deterministic subscription doc id when subtle crypto is available. */
export async function subscriptionIdFromToken(token: string): Promise<string | null> {
  const hex = await sha256Hex(token)
  if (!hex) return null
  return hex.slice(0, 32)
}
