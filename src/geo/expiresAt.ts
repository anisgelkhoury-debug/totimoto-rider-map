/**
 * Absolute expiry timestamp derivation (pure).
 * Source of truth for minutes remains report `expiry` field / type catalogs.
 */

import { normalizeReportCreatedAt } from "../utils/reportSnapshot.ts"

const MS_PER_MINUTE = 60_000
/** Guard absurd values (e.g. accidental seconds-as-minutes * huge createdAt). */
const MAX_EXPIRY_MINUTES = 365 * 24 * 60 // 1 year

export type DeriveExpiresAtInput = {
  createdAt: unknown
  /** TTL in minutes (same meaning as report.expiry). */
  expiryMinutes: unknown
}

export type DeriveExpiresAtResult =
  | { ok: true; expiresAt: number; createdAtMs: number; expiryMinutes: number }
  | { ok: false; reason: string }

/**
 * createdAt + expiryMinutes → expiresAt (epoch ms).
 * - Invalid / missing expiry → ok:false (no fabricated lifetime)
 * - Negative / non-finite expiry → ok:false
 * - Stolen long TTL (e.g. 43200) is valid when finite and ≤ MAX
 */
export function deriveExpiresAt(
  input: DeriveExpiresAtInput
): DeriveExpiresAtResult {
  const createdAtMs = normalizeReportCreatedAt(input.createdAt)
  if (createdAtMs == null) {
    return { ok: false, reason: "invalid_createdAt" }
  }

  const raw = input.expiryMinutes
  if (raw == null) {
    return { ok: false, reason: "missing_expiry" }
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return { ok: false, reason: "invalid_expiry" }
  }
  if (raw <= 0) {
    return { ok: false, reason: "non_positive_expiry" }
  }
  if (raw > MAX_EXPIRY_MINUTES) {
    return { ok: false, reason: "expiry_too_large" }
  }

  const expiryMinutes = raw
  const expiresAt = createdAtMs + expiryMinutes * MS_PER_MINUTE
  if (!Number.isFinite(expiresAt) || expiresAt <= createdAtMs) {
    return { ok: false, reason: "expiresAt_overflow" }
  }

  return { ok: true, expiresAt, createdAtMs, expiryMinutes }
}

/** Convenience: number or null (legacy / no-expiry safe). */
export function expiresAtOrNull(
  createdAt: unknown,
  expiryMinutes: unknown
): number | null {
  const r = deriveExpiresAt({ createdAt, expiryMinutes })
  return r.ok ? r.expiresAt : null
}
