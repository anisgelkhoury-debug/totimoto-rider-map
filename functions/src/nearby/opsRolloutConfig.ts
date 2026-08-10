/**
 * TRN 058K — fail-closed operational nearby rollout config reader.
 *
 * Document path: systemConfig/nearbyNotifications (Admin-only; not created here).
 * Short in-memory TTL cache; never turns failure into permissive behavior.
 */

import type { Firestore } from "firebase-admin/firestore"
import {
  NEARBY_ROLLOUT_DEFAULT_CONFIG,
  normalizeNearbyRolloutConfig,
  type NearbyNormalizedRolloutConfig,
} from "./rolloutConfig"

export const NEARBY_OPS_CONFIG_COLLECTION = "systemConfig"
export const NEARBY_OPS_CONFIG_DOC_ID = "nearbyNotifications"
export const NEARBY_OPS_CONFIG_PATH = `${NEARBY_OPS_CONFIG_COLLECTION}/${NEARBY_OPS_CONFIG_DOC_ID}`

/** V1: short TTL — balance freshness vs reads. */
export const NEARBY_OPS_CONFIG_CACHE_TTL_MS = 45_000

type CacheEntry = {
  config: NearbyNormalizedRolloutConfig
  expiresAtMs: number
}

let cache: CacheEntry | null = null

/** Test helper — reset process cache. */
export function resetNearbyOpsConfigCache(): void {
  cache = null
}

/** Map ops document field aliases into normalizeNearbyRolloutConfig input. */
export function mapNearbyOpsConfigRaw(raw: unknown): unknown {
  if (raw == null || typeof raw !== "object") return raw
  const o = raw as Record<string, unknown>
  return {
    enabled: o.enabled,
    stage: o.stage,
    subscriptionAllowlist:
      o.subscriptionAllowlist ?? o.allowlistedSubscriptionIds,
    categoryAllowlist: o.categoryAllowlist ?? o.allowedCategories,
    geohashAllowPrefixes: o.geohashAllowPrefixes ?? o.allowedGeoPrefixes,
    percentOpen: o.percentOpen ?? o.percentage,
    percentSeed: o.percentSeed ?? o.seed,
  }
}

export function getCachedNearbyOpsConfig(
  nowMs: number
): NearbyNormalizedRolloutConfig | null {
  if (!cache) return null
  if (nowMs >= cache.expiresAtMs) return null
  return cache.config
}

export function setCachedNearbyOpsConfig(
  config: NearbyNormalizedRolloutConfig,
  nowMs: number,
  ttlMs = NEARBY_OPS_CONFIG_CACHE_TTL_MS
): void {
  cache = {
    config,
    expiresAtMs: nowMs + ttlMs,
  }
}

/**
 * Read + normalize ops config with fail-closed cache semantics.
 * - cold start / miss → fetch
 * - fetch failure → Stage 0 (and cache Stage 0 briefly so we don't hammer)
 * - expired + failure → Stage 0
 * - never returns a stale permissive config past TTL
 */
export async function loadNearbyOpsRolloutConfig(input: {
  fetchRaw: () => Promise<unknown>
  nowMs?: number
  ttlMs?: number
}): Promise<NearbyNormalizedRolloutConfig> {
  const nowMs = input.nowMs ?? Date.now()
  const hit = getCachedNearbyOpsConfig(nowMs)
  if (hit) return hit

  try {
    const raw = await input.fetchRaw()
    if (raw == null) {
      const missing = {
        ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
        normalizeReason: "missing_rollout_config",
      }
      setCachedNearbyOpsConfig(missing, nowMs, input.ttlMs)
      return missing
    }
    const mapped = mapNearbyOpsConfigRaw(raw)
    const normalized = normalizeNearbyRolloutConfig(mapped)
    setCachedNearbyOpsConfig(normalized, nowMs, input.ttlMs)
    return normalized
  } catch {
    const failed = {
      ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
      normalizeReason: "rollout_config_read_failed",
    }
    setCachedNearbyOpsConfig(failed, nowMs, input.ttlMs)
    return failed
  }
}

export async function fetchNearbyOpsConfigFromFirestore(
  db: Firestore
): Promise<NearbyNormalizedRolloutConfig> {
  return loadNearbyOpsRolloutConfig({
    fetchRaw: async () => {
      const snap = await db
        .collection(NEARBY_OPS_CONFIG_COLLECTION)
        .doc(NEARBY_OPS_CONFIG_DOC_ID)
        .get()
      if (!snap.exists) return null
      return snap.data() ?? null
    },
  })
}
