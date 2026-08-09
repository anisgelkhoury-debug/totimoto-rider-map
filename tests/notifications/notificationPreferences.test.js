/**
 * TRN 058B — preference normalization + nearby eligibility (no FCM send).
 * Run: npm run test:notifications
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  ALL_NOTIFICATION_PREFERENCE_KEYS,
  NOTIFICATION_SETTINGS_COPY_AR,
  defaultNotificationPreferences,
  isAssistanceLifecycleEnabled,
  isNearbyCategoryEnabled,
  isNearbyCategoryPreferenceOn,
  isSubscriptionEligibleForNearbyAlert,
  normalizeNotificationPreferences,
  withAssistanceLifecycle,
} from "../../src/notifications/notificationPreferences.ts"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")

describe("notificationPreferences normalize", () => {
  it("1. old subscription doc normalizes safely", () => {
    const n = normalizeNotificationPreferences({
      helperLifecycle: true,
      ownerLifecycle: true,
      stolenNearby: false,
      criticalRoads: false,
      sharedRides: false,
      communityRides: false,
      announcements: false,
      marketing: false,
    })
    assert.equal(n.helperLifecycle, true)
    assert.equal(n.ownerLifecycle, true)
    assert.equal(n.nearbyAlerts, false)
    assert.equal(n.checkpoint, true)
    assert.equal(n.accident, true)
    assert.equal(n.roadClosed, true)
    assert.equal(n.slippery, true)
    assert.equal(n.importantIncidents, true)
  })

  it("2. nearbyAlerts absent → false", () => {
    assert.equal(normalizeNotificationPreferences({}).nearbyAlerts, false)
    assert.equal(normalizeNotificationPreferences(null).nearbyAlerts, false)
    assert.equal(normalizeNotificationPreferences(undefined).nearbyAlerts, false)
  })

  it("3. nearbyAlerts true recognized", () => {
    assert.equal(
      normalizeNotificationPreferences({ nearbyAlerts: true }).nearbyAlerts,
      true
    )
  })

  it("4–8. category preferences", () => {
    const n = normalizeNotificationPreferences({
      checkpoint: false,
      accident: false,
      roadClosed: false,
      slippery: false,
      importantIncidents: false,
    })
    assert.equal(n.checkpoint, false)
    assert.equal(n.accident, false)
    assert.equal(n.roadClosed, false)
    assert.equal(n.slippery, false)
    assert.equal(n.importantIncidents, false)
  })

  it("defaults include assistance on + nearby off", () => {
    const d = defaultNotificationPreferences()
    assert.equal(d.helperLifecycle, true)
    assert.equal(d.ownerLifecycle, true)
    assert.equal(d.nearbyAlerts, false)
  })
})

describe("nearby category eligibility", () => {
  const on = normalizeNotificationPreferences({
    nearbyAlerts: true,
    checkpoint: true,
    accident: true,
    roadClosed: true,
    slippery: true,
    importantIncidents: true,
  })

  it("4. checkpoint preference", () => {
    assert.equal(isNearbyCategoryEnabled(on, "checkpoint"), true)
  })

  it("5. accident preference", () => {
    assert.equal(isNearbyCategoryEnabled(on, "accident"), true)
  })

  it("6. roadClosed preference", () => {
    assert.equal(isNearbyCategoryEnabled(on, "road_closed"), true)
  })

  it("7. slippery preference", () => {
    assert.equal(isNearbyCategoryEnabled(on, "slippery_road"), true)
  })

  it("8. importantIncidents preference", () => {
    assert.equal(isNearbyCategoryEnabled(on, "fire"), true)
    assert.equal(isNearbyCategoryEnabled(on, "gunfire"), true)
    assert.equal(isNearbyCategoryEnabled(on, "explosionStrike"), true)
    assert.equal(isNearbyCategoryEnabled(on, "collapseDanger"), true)
  })

  it("9. traffic never eligible", () => {
    assert.equal(isNearbyCategoryEnabled(on, "traffic"), false)
    assert.equal(isNearbyCategoryPreferenceOn(on, "traffic"), false)
  })

  it("10. otherIncident never eligible", () => {
    assert.equal(isNearbyCategoryEnabled(on, "otherIncident"), false)
    assert.equal(isNearbyCategoryEnabled(on, "other"), false)
  })

  it("11. stolen never eligible", () => {
    assert.equal(isNearbyCategoryEnabled(on, "stolen"), false)
  })

  it("12. marketplace never eligible", () => {
    assert.equal(isNearbyCategoryEnabled(on, "marketplace"), false)
  })

  it("master nearbyAlerts false blocks all categories", () => {
    const off = normalizeNotificationPreferences({
      nearbyAlerts: false,
      checkpoint: true,
      accident: true,
    })
    assert.equal(isNearbyCategoryEnabled(off, "checkpoint"), false)
    assert.equal(isNearbyCategoryEnabled(off, "accident"), false)
    assert.equal(isNearbyCategoryPreferenceOn(off, "checkpoint"), true)
  })

  it("13. disabled subscription never eligible", () => {
    assert.equal(
      isSubscriptionEligibleForNearbyAlert(
        {
          enabled: false,
          permissionState: "granted",
          notificationPreferences: on,
        },
        "checkpoint"
      ),
      false
    )
    assert.equal(
      isSubscriptionEligibleForNearbyAlert(
        {
          enabled: true,
          permissionState: "denied",
          notificationPreferences: on,
        },
        "accident"
      ),
      false
    )
  })

  it("enabled + granted + nearby master eligible", () => {
    assert.equal(
      isSubscriptionEligibleForNearbyAlert(
        {
          enabled: true,
          permissionState: "granted",
          notificationPreferences: on,
        },
        "gunfire"
      ),
      true
    )
  })
})

describe("assistance lifecycle compatibility", () => {
  it("14. assistance existing behavior preserved in defaults", () => {
    const d = defaultNotificationPreferences()
    assert.equal(isAssistanceLifecycleEnabled(d), true)
    const off = withAssistanceLifecycle(d, false)
    assert.equal(off.helperLifecycle, false)
    assert.equal(off.ownerLifecycle, false)
    assert.equal(isAssistanceLifecycleEnabled(off), false)
  })
})

describe("Arabic settings labels", () => {
  it("26. Arabic settings labels present", () => {
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.sectionTitle, "الإشعارات")
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.assistanceTitle, "طلبات المساعدة")
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.nearbyTitle, "تنبيهات قريبة مني")
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.categoryCheckpoint, "الحواجز")
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.categoryAccident, "الحوادث")
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.categoryRoadClosed, "الطرق المسكرة")
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.categorySlippery, "الطرق الزلقة")
    assert.equal(NOTIFICATION_SETTINGS_COPY_AR.categoryImportantIncidents, "الأحداث المهمة")
    assert.match(NOTIFICATION_SETTINGS_COPY_AR.privacyBody, /ما منحتفظ بسجل/)
    assert.match(NOTIFICATION_SETTINGS_COPY_AR.nearbyNotLiveYet, /المرحلة القادمة/)
  })
})

describe("058B scope guardrails", () => {
  it("22. no location preference keys introduced", () => {
    for (const key of ALL_NOTIFICATION_PREFERENCE_KEYS) {
      assert.equal(/location|lat|lng|geohash|gps/i.test(key), false)
    }
  })

  it("23–25. no GPS / nearby Function / notification send in 058B modules", () => {
    const prefsSrc = readFileSync(
      join(root, "src/notifications/notificationPreferences.ts"),
      "utf8"
    )
    const subSrc = readFileSync(
      join(root, "src/notifications/notificationSubscription.ts"),
      "utf8"
    )
    const panelSrc = readFileSync(
      join(root, "src/notifications/NotificationSettingsPanel.tsx"),
      "utf8"
    )
    const combined = prefsSrc + subSrc + panelSrc
    assert.equal(combined.includes("navigator.geolocation"), false)
    assert.equal(combined.includes("getCurrentPosition"), false)
    assert.equal(combined.includes("watchPosition"), false)
    assert.equal(combined.includes("locationGeohash"), false)
    assert.equal(combined.includes("locationUpdatedAt"), false)
    assert.equal(combined.includes("onReportCreated"), false)
    assert.equal(combined.includes("sendEachForMulticast"), false)
    assert.equal(combined.includes("messaging.send"), false)
  })

  it("preference key set is exact expected size", () => {
    assert.equal(ALL_NOTIFICATION_PREFERENCE_KEYS.length, 14)
  })
})
