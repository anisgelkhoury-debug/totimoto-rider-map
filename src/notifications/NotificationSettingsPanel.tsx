/**
 * Arabic Notification Settings panel (058B).
 * Preferences + disclosure only — no GPS, no nearby send.
 */

import { useEffect, useState, type CSSProperties } from "react"
import type { Messaging } from "firebase/messaging"
import {
  NOTIFICATION_SETTINGS_COPY_AR as C,
  defaultNotificationPreferences,
  isAssistanceLifecycleEnabled,
  normalizeNotificationPreferences,
  withAssistanceLifecycle,
  type NotificationPreferences,
  type NearbyNotificationPreferenceKey,
} from "./notificationPreferences"
import {
  getHeartbeatMemoryState,
  setCachedNearbyAlertsPref,
} from "./locationHeartbeatState"
import {
  nearbyLocationStatusLabelAr,
  resolveNearbyLocationStatusAr,
} from "./locationHeartbeat"
import {
  disableNotificationsOnServer,
  loadNotificationPreferences,
  updateNotificationPreferencesOnServer,
} from "./notificationSubscription"
import {
  resolveSettingsNotificationState,
  settingsStateLabelAr,
  type SettingsNotificationState,
} from "./notificationSupport"

type Props = {
  messaging: Messaging | null
  /** Current map GPS from existing watcher (no second geolocation API). */
  hasMyLocation?: boolean
  /** Bump from parent after enable/prompt flows. */
  refreshTick?: number
  onRequestEnable: () => void
  onOpenInstallGuide: () => void
  onStatusChange?: () => void
  containerStyle?: CSSProperties
}

type CategoryRow = {
  key: NearbyNotificationPreferenceKey
  label: string
}

const CATEGORY_ROWS: CategoryRow[] = [
  { key: "checkpoint", label: C.categoryCheckpoint },
  { key: "accident", label: C.categoryAccident },
  { key: "roadClosed", label: C.categoryRoadClosed },
  { key: "slippery", label: C.categorySlippery },
  { key: "importantIncidents", label: C.categoryImportantIncidents },
]

function ToggleRow(props: {
  title: string
  help?: string
  checked: boolean
  disabled?: boolean
  busy?: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 0",
        opacity: props.disabled ? 0.45 : 1,
        borderBottom: "1px solid #f1f5f9",
      }}
    >
      <div style={{ textAlign: "right", flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{props.title}</div>
        {props.help ? (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
            {props.help}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        disabled={props.disabled || props.busy}
        onClick={() => props.onChange(!props.checked)}
        style={{
          flexShrink: 0,
          width: 48,
          height: 28,
          borderRadius: 999,
          border: "none",
          background: props.checked ? "#0f172a" : "#cbd5e1",
          position: "relative",
          cursor: props.disabled || props.busy ? "not-allowed" : "pointer",
          padding: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            ...(props.checked ? { left: 3 } : { right: 3 }),
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "white",
            boxShadow: "0 1px 2px rgba(0,0,0,.2)",
          }}
        />
      </button>
    </div>
  )
}

export function NotificationSettingsPanel({
  messaging,
  hasMyLocation = false,
  refreshTick = 0,
  onRequestEnable,
  onOpenInstallGuide,
  onStatusChange,
  containerStyle,
}: Props) {
  const [notifState, setNotifState] = useState<SettingsNotificationState>(() =>
    resolveSettingsNotificationState()
  )
  const [prefs, setPrefs] = useState<NotificationPreferences>(() =>
    defaultNotificationPreferences()
  )
  const [loadingPrefs, setLoadingPrefs] = useState(false)
  const [busyDisable, setBusyDisable] = useState(false)
  const [busyPrefs, setBusyPrefs] = useState(false)
  const [inlineMsg, setInlineMsg] = useState("")
  const [inlineErr, setInlineErr] = useState("")
  const [showNearbyPrivacy, setShowNearbyPrivacy] = useState(false)

  const refreshState = () => {
    setNotifState(resolveSettingsNotificationState())
  }

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoadingPrefs(true)
      setInlineErr("")
      refreshState()
      try {
        const loaded = await loadNotificationPreferences({ messaging })
        if (!cancelled) setPrefs(loaded)
      } finally {
        if (!cancelled) setLoadingPrefs(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [messaging, refreshTick])

  const persistPrefs = async (next: NotificationPreferences) => {
    setBusyPrefs(true)
    setInlineErr("")
    setInlineMsg("")
    const prev = prefs
    setPrefs(next)
    setCachedNearbyAlertsPref(next.nearbyAlerts === true)
    const result = await updateNotificationPreferencesOnServer({
      messaging,
      preferences: next,
    })
    setBusyPrefs(false)
    if (!result.ok) {
      setPrefs(prev)
      setCachedNearbyAlertsPref(prev.nearbyAlerts === true)
      setInlineErr(result.messageAr || C.prefsSaveFail)
      return false
    }
    setPrefs(result.preferences)
    setCachedNearbyAlertsPref(result.preferences.nearbyAlerts === true)
    onStatusChange?.()
    return true
  }

  const onToggleAssistance = async (enabled: boolean) => {
    if (notifState !== "active") return
    await persistPrefs(withAssistanceLifecycle(prefs, enabled))
  }

  const onToggleNearbyMaster = async (enabled: boolean) => {
    if (notifState !== "active") return
    if (enabled) {
      setShowNearbyPrivacy(true)
      return
    }
    await persistPrefs({ ...prefs, nearbyAlerts: false })
  }

  const confirmNearbyPrivacy = async () => {
    setShowNearbyPrivacy(false)
    await persistPrefs({ ...prefs, nearbyAlerts: true })
  }

  const onToggleCategory = async (
    key: NearbyNotificationPreferenceKey,
    enabled: boolean
  ) => {
    if (notifState !== "active" || !prefs.nearbyAlerts) return
    if (key === "nearbyAlerts") return
    await persistPrefs({ ...prefs, [key]: enabled })
  }

  const onDisable = async () => {
    if (busyDisable) return
    setBusyDisable(true)
    setInlineErr("")
    setInlineMsg("")
    const result = await disableNotificationsOnServer({ messaging })
    setBusyDisable(false)
    if (!result.ok) {
      setInlineErr(result.messageAr || C.disableFail)
      refreshState()
      return
    }
    setInlineMsg(C.disableOk)
    setPrefs(normalizeNotificationPreferences(prefs))
    refreshState()
    onStatusChange?.()
  }

  const label = settingsStateLabelAr(notifState)
  const active = notifState === "active"
  const nearbyOn = prefs.nearbyAlerts === true
  const heartbeatMem = getHeartbeatMemoryState()
  const locationStatus = resolveNearbyLocationStatusAr({
    nearbyAlerts: nearbyOn,
    hasMyLocation,
    lastHeartbeatAtMs: heartbeatMem.lastWrittenAtMs,
  })
  const locationStatusAr = nearbyLocationStatusLabelAr(locationStatus)

  return (
    <div
      style={{
        textAlign: "right",
        cursor: "default",
        display: "block",
        paddingTop: 14,
        paddingBottom: 14,
        ...containerStyle,
      }}
    >
      <div style={{ fontWeight: "bold", marginBottom: 4 }}>{C.sectionTitle}</div>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
        {C.statusPrefix} {label}
        {loadingPrefs ? " · …" : ""}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        {(notifState === "inactive" || notifState === "needs_setup") && (
          <button
            type="button"
            onClick={onRequestEnable}
            style={{
              flex: 1,
              minWidth: 110,
              padding: "10px 8px",
              borderRadius: 12,
              border: "none",
              background: "#0f172a",
              color: "white",
              fontWeight: "bold",
              fontSize: 13,
            }}
          >
            {notifState === "needs_setup" ? C.retry : C.enable}
          </button>
        )}
        {notifState === "needs_install" && (
          <button
            type="button"
            onClick={onOpenInstallGuide}
            style={{
              flex: 1,
              minWidth: 110,
              padding: "10px 8px",
              borderRadius: 12,
              border: "none",
              background: "#0f172a",
              color: "white",
              fontWeight: "bold",
              fontSize: 13,
            }}
          >
            {C.openInstallGuide}
          </button>
        )}
        {active && (
          <button
            type="button"
            disabled={busyDisable}
            onClick={() => void onDisable()}
            style={{
              flex: 1,
              minWidth: 110,
              padding: "10px 8px",
              borderRadius: 12,
              border: "none",
              background: "#e5e7eb",
              color: "#0f172a",
              fontWeight: "bold",
              fontSize: 13,
            }}
          >
            {busyDisable ? C.disabling : C.disable}
          </button>
        )}
        {notifState === "denied" && (
          <div style={{ fontSize: 12, color: "#b91c1c", lineHeight: 1.5 }}>{C.deniedHint}</div>
        )}
      </div>

      {inlineErr ? (
        <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8, lineHeight: 1.5 }}>
          {inlineErr}
        </div>
      ) : null}
      {inlineMsg ? (
        <div style={{ fontSize: 12, color: "#0f766e", marginBottom: 8, lineHeight: 1.5 }}>
          {inlineMsg}
        </div>
      ) : null}

      {active && (
        <div style={{ marginTop: 6 }}>
          <ToggleRow
            title={C.assistanceTitle}
            help={C.assistanceHelp}
            checked={isAssistanceLifecycleEnabled(prefs)}
            busy={busyPrefs}
            onChange={(v) => void onToggleAssistance(v)}
          />

          <ToggleRow
            title={C.nearbyTitle}
            help={`${C.nearbyHelp} ${C.nearbyDefaultOffHint}`}
            checked={nearbyOn}
            busy={busyPrefs}
            onChange={(v) => void onToggleNearbyMaster(v)}
          />

          <div
            style={{
              fontSize: 12,
              color: "#92400e",
              background: "#fffbeb",
              borderRadius: 10,
              padding: "8px 10px",
              margin: "8px 0 4px",
              lineHeight: 1.55,
            }}
          >
            {C.nearbyNotLiveYet}
          </div>

          {nearbyOn && locationStatusAr ? (
            <div
              style={{
                fontSize: 12,
                color: locationStatus === "ready" ? "#0f766e" : "#b45309",
                margin: "6px 0 4px",
                lineHeight: 1.5,
              }}
            >
              {locationStatusAr}
            </div>
          ) : null}

          {nearbyOn ? (
            <div style={{ marginTop: 4 }}>
              {CATEGORY_ROWS.map((row) => (
                <ToggleRow
                  key={row.key}
                  title={row.label}
                  checked={prefs[row.key] === true}
                  busy={busyPrefs}
                  onChange={(v) => void onToggleCategory(row.key, v)}
                />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, lineHeight: 1.5 }}>
              {C.categoriesNeedNearby}
            </div>
          )}

          {busyPrefs ? (
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>{C.saving}</div>
          ) : null}
        </div>
      )}

      {showNearbyPrivacy && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 1000001,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            padding: 16,
            direction: "rtl",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busyPrefs) setShowNearbyPrivacy(false)
          }}
        >
          <div
            style={{
              background: "white",
              width: "100%",
              maxWidth: 420,
              borderRadius: 20,
              padding: 20,
              textAlign: "right",
              lineHeight: 1.7,
            }}
          >
            <h3 style={{ margin: "0 0 10px", fontSize: 18 }}>{C.privacyTitle}</h3>
            <p style={{ margin: "0 0 12px", color: "#334155", fontSize: 14 }}>{C.privacyBody}</p>
            <p style={{ margin: "0 0 16px", color: "#92400e", fontSize: 13 }}>{C.nearbyNotLiveYet}</p>
            <button
              type="button"
              disabled={busyPrefs}
              onClick={() => void confirmNearbyPrivacy()}
              style={{
                width: "100%",
                padding: 13,
                borderRadius: 14,
                border: "none",
                background: "#0f172a",
                color: "white",
                fontWeight: "bold",
                marginBottom: 8,
              }}
            >
              {C.privacyConfirm}
            </button>
            <button
              type="button"
              disabled={busyPrefs}
              onClick={() => setShowNearbyPrivacy(false)}
              style={{
                width: "100%",
                padding: 13,
                borderRadius: 14,
                border: "none",
                background: "#e5e7eb",
                fontWeight: "bold",
              }}
            >
              {C.privacyCancel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
