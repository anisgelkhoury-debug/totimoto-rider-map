/**
 * TRN 058J — fail-closed nearby rollout config model (pure).
 *
 * Default / missing / malformed ⇒ Stage 0 (nobody).
 * Not Firestore-authoritative yet; in-code default is Stage 0.
 */

export type NearbyRolloutStage = 0 | 1 | 2 | 3 | 4

export const NEARBY_ROLLOUT_STAGE = {
  OFF: 0,
  TEST_ALLOWLIST: 1,
  LIMITED_ALLOWLIST: 2,
  GEO_CATEGORY_LIMITED: 3,
  PERCENT_ROLLOUT: 4,
} as const

export type NearbyNormalizedRolloutConfig = {
  /** Explicit ops disable — forces Stage 0 semantics. */
  enabled: boolean
  stage: NearbyRolloutStage
  subscriptionAllowlist: readonly string[]
  /** Precision 1–6 geohash prefixes (Stage 3/4 optional gates). */
  geohashAllowPrefixes: readonly string[]
  /** Report categories allowed by rollout (Stage 3 requires non-empty). */
  categoryAllowlist: readonly string[]
  /** 0–100; Stage 4 requires > 0. */
  percentOpen: number
  /** Optional seed mixed into percent hashing (stable). */
  percentSeed: string
  normalizeReason: string
}

/** Compile-time / in-memory default — never opens delivery. */
export const NEARBY_ROLLOUT_DEFAULT_CONFIG: NearbyNormalizedRolloutConfig = {
  enabled: false,
  stage: 0,
  subscriptionAllowlist: [],
  geohashAllowPrefixes: [],
  categoryAllowlist: [],
  percentOpen: 0,
  percentSeed: "",
  normalizeReason: "default_stage_0",
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((x) => String(x ?? "").trim())
    .filter((s) => s.length > 0)
}

function isValidGeohashPrefix(prefix: string): boolean {
  if (prefix.length < 1 || prefix.length > 6) return false
  return /^[0123456789bcdefghjkmnpqrstuvwxyz]+$/.test(prefix)
}

/**
 * Normalize unknown input to a typed config.
 * Never returns an "open to everybody" interpretation of bad input.
 */
export function normalizeNearbyRolloutConfig(
  raw: unknown
): NearbyNormalizedRolloutConfig {
  if (raw == null || typeof raw !== "object") {
    return {
      ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
      normalizeReason: "missing_rollout_config",
    }
  }
  const o = raw as Record<string, unknown>
  if (o.enabled === false) {
    return {
      ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
      enabled: false,
      normalizeReason: "config_disabled",
    }
  }

  const stageRaw = o.stage
  const stageNum =
    typeof stageRaw === "number" && Number.isInteger(stageRaw)
      ? stageRaw
      : typeof stageRaw === "string" && /^\d+$/.test(stageRaw)
        ? Number(stageRaw)
        : NaN

  if (
    stageNum !== 0 &&
    stageNum !== 1 &&
    stageNum !== 2 &&
    stageNum !== 3 &&
    stageNum !== 4
  ) {
    return {
      ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
      normalizeReason: "unknown_rollout_stage",
    }
  }

  const stage = stageNum as NearbyRolloutStage
  const subscriptionAllowlist = asStringList(o.subscriptionAllowlist)
  const geohashAllowPrefixes = asStringList(o.geohashAllowPrefixes).filter(
    isValidGeohashPrefix
  )
  const categoryAllowlist = asStringList(o.categoryAllowlist)
  const percentOpen =
    typeof o.percentOpen === "number" && Number.isFinite(o.percentOpen)
      ? o.percentOpen
      : 0
  const percentSeed =
    typeof o.percentSeed === "string" ? o.percentSeed.trim() : ""

  if (stage === 0) {
    return {
      enabled: false,
      stage: 0,
      subscriptionAllowlist: [],
      geohashAllowPrefixes: [],
      categoryAllowlist: [],
      percentOpen: 0,
      percentSeed: "",
      normalizeReason: "stage_0",
    }
  }

  if (stage === 1 || stage === 2) {
    if (subscriptionAllowlist.length === 0) {
      return {
        ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
        normalizeReason: "empty_allowlist_fail_closed",
      }
    }
    return {
      enabled: true,
      stage,
      subscriptionAllowlist,
      geohashAllowPrefixes: [],
      categoryAllowlist: [],
      percentOpen: 0,
      percentSeed: "",
      normalizeReason: "ok",
    }
  }

  if (stage === 3) {
    // BOTH category and geography required for anyone to pass eligibility.
    if (categoryAllowlist.length === 0 || geohashAllowPrefixes.length === 0) {
      return {
        ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
        normalizeReason: "stage_3_requires_category_and_geography",
      }
    }
    return {
      enabled: true,
      stage: 3,
      subscriptionAllowlist: [],
      geohashAllowPrefixes,
      categoryAllowlist,
      percentOpen: 0,
      percentSeed: "",
      normalizeReason: "ok",
    }
  }

  // Stage 4
  if (!(percentOpen > 0) || percentOpen > 100) {
    return {
      ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
      normalizeReason: "stage_4_percent_closed",
    }
  }
  return {
    enabled: true,
    stage: 4,
    subscriptionAllowlist: [],
    geohashAllowPrefixes,
    categoryAllowlist,
    percentOpen,
    percentSeed,
    normalizeReason: "ok",
  }
}

/**
 * Abstraction for a future Firestore ops doc reader.
 * Read failure / missing / malformed ⇒ Stage 0. No permissive cache.
 * 058J does not create or require a production document.
 */
export async function readNearbyRolloutConfigSafe(
  fetchRaw: () => Promise<unknown>
): Promise<NearbyNormalizedRolloutConfig> {
  try {
    const raw = await fetchRaw()
    return normalizeNearbyRolloutConfig(raw)
  } catch {
    return {
      ...NEARBY_ROLLOUT_DEFAULT_CONFIG,
      normalizeReason: "rollout_config_read_failed",
    }
  }
}

/** Three-layer kill: compile gate, ops enabled, stage > 0. */
export function isNearbyDeliveryLayerUnlocked(input: {
  compileTimeSendGate: boolean
  config: NearbyNormalizedRolloutConfig
}): boolean {
  if (input.compileTimeSendGate !== true) return false
  if (input.config.enabled !== true) return false
  if (input.config.stage === 0) return false
  if (input.config.normalizeReason !== "ok") return false
  return true
}
