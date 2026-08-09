/**
 * In-memory last-heartbeat tracking + nearbyAlerts local cache (no history).
 * Firebase-free for unit tests.
 */

/** Mirrors NOTIF_STORAGE.nearbyAlertsPref in notificationSupport.ts */
const NEARBY_ALERTS_PREF_KEY = "trnNotifNearbyAlerts"

export type HeartbeatMemoryState = {
  lastGeohash: string | null
  lastWrittenAtMs: number | null
}

let memory: HeartbeatMemoryState = {
  lastGeohash: null,
  lastWrittenAtMs: null,
}

export function getHeartbeatMemoryState(): HeartbeatMemoryState {
  return { ...memory }
}

export function markHeartbeatWriteCommitted(geohash: string, atMs: number): void {
  memory = { lastGeohash: geohash, lastWrittenAtMs: atMs }
}

export function resetHeartbeatMemoryState(): void {
  memory = { lastGeohash: null, lastWrittenAtMs: null }
}

export function setCachedNearbyAlertsPref(enabled: boolean): void {
  try {
    localStorage.setItem(NEARBY_ALERTS_PREF_KEY, enabled ? "1" : "0")
  } catch {
    /* ignore */
  }
}

export function getCachedNearbyAlertsPref(): boolean | null {
  try {
    const v = localStorage.getItem(NEARBY_ALERTS_PREF_KEY)
    if (v === "1") return true
    if (v === "0") return false
    return null
  } catch {
    return null
  }
}

export function clearCachedNearbyAlertsPref(): void {
  try {
    localStorage.removeItem(NEARBY_ALERTS_PREF_KEY)
  } catch {
    /* ignore */
  }
}
