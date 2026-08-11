/**
 * TRN 058K — Firestore emulator concurrency proof for budget reservation.
 * Run via: firebase emulators:exec --only firestore ...
 * No FCM. Does not create production data.
 */
import { describe, it, before, after } from "node:test"
import assert from "node:assert/strict"
import { initializeApp, deleteApp, getApps, type App } from "firebase-admin/app"
import { getFirestore, type Firestore } from "firebase-admin/firestore"
import { reserveNearbyNotificationBudget } from "../nearby/firestoreBudget.js"

const PROJECT = "totimoto-rider-network"
const NOW = 1_700_000_000_000
const SUB_ID = "058k-concurrent-sub"

describe("058K emulator concurrent budget reservation", () => {
  let app: App | undefined
  let db: Firestore | undefined
  let emulatorAvailable = false

  before(async () => {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      // Allow local direct run against default emulator port when started externally.
      process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
    }
    for (const existing of getApps()) {
      await deleteApp(existing)
    }
    app = initializeApp({ projectId: PROJECT })
    db = getFirestore(app)
    try {
      await db.collection("_058k_ping").doc("x").set({ ok: true })
      emulatorAvailable = true
    } catch (err) {
      emulatorAvailable = false
      console.error("058K_EMULATOR_BLOCKER", String(err))
    }
  })

  after(async () => {
    if (app) await deleteApp(app)
  })

  it("two concurrent reserves with hourlyCount=2 → one ALLOW one REJECT; final=3", async (t) => {
    if (!emulatorAvailable || !db) {
      t.skip("Firestore emulator unavailable — mock transaction body remains the proof")
      return
    }

    await db
      .collection("notificationSubscriptions")
      .doc(SUB_ID)
      .set({
        uid: "rider-058k",
        enabled: true,
        nearbyNotificationBudget: {
          hourlyWindowStartedAt: NOW,
          hourlyCount: 2,
          dailyWindowStartedAt: NOW,
          dailyCount: 2,
          lastNearbySentAt: NOW - 20 * 60_000,
          criticalWindowStartedAt: null,
          criticalCount: 0,
          pending: {},
        },
      })

    const [a, b] = await Promise.all([
      reserveNearbyNotificationBudget({
        db,
        reportId: "report-A",
        subscriptionId: SUB_ID,
        severity: "HIGH",
        nowMs: NOW,
      }),
      reserveNearbyNotificationBudget({
        db,
        reportId: "report-B",
        subscriptionId: SUB_ID,
        severity: "HIGH",
        nowMs: NOW,
      }),
    ])

    const winners = [a, b].filter((r) => r.reserved)
    const losers = [a, b].filter((r) => !r.reserved)
    assert.equal(winners.length, 1)
    assert.equal(losers.length, 1)
    assert.equal(losers[0].reason, "REJECT_HOURLY_BUDGET")

    const snap = await db.collection("notificationSubscriptions").doc(SUB_ID).get()
    const budget = snap.data()?.nearbyNotificationBudget
    assert.equal(budget.hourlyCount, 3)
  })
})
