/**
 * TRN Task 005 — Firestore + Storage security rules emulator tests.
 * Run via: npm run test:rules
 * Requires Firebase Emulator Suite (Java) — started by firebase emulators:exec.
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing"
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  getDocs,
  deleteField,
} from "firebase/firestore"
import {
  ref,
  uploadBytes,
  getBytes,
  deleteObject,
} from "firebase/storage"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "../..")
const PROJECT_ID = "totimoto-rider-network"
const STORAGE_BUCKET = "totimoto-rider-network.firebasestorage.app"

const firestoreRules = readFileSync(resolve(root, "firestore.rules"), "utf8")
const storageRules = readFileSync(resolve(root, "storage.rules"), "utf8")

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let testEnv

function baseReport(ownerUid, ownerId, extras = {}) {
  return {
    type: "عطل بالدراجة",
    reportFamily: "assistance",
    reportCategory: "bike_broken",
    emoji: "🛠️",
    color: "#16a34a",
    priority: "high",
    ownerId,
    ownerUid,
    phone: "03123456",
    ownerPhone: "03123456",
    ownerName: "Owner",
    description: "test",
    reportImageUrl: "",
    lat: 33.89,
    lng: 35.5,
    createdAt: Date.now(),
    expiry: 60,
    helperComing: false,
    helperArrived: false,
    helpers: 0,
    helpersList: [],
    resolved: false,
    ...extras,
  }
}

/** Mirrors src/App.tsx createUserReport object construction (including ...type → label). */
function productionCreateUserReportPayload(ownerUid, ownerId, typeOverrides = {}) {
  const type = {
    label: "محتاج دفشة",
    emoji: "🛵",
    color: "#16a34a",
    expiry: 30,
    priority: "medium",
    reportFamily: "assistance",
    reportCategory: "push",
    ...typeOverrides,
  }
  const description = typeOverrides.description ?? "UID TEST production-shape"
  const locationInfo = {
    area: "الحمرا",
    street: "شارع فoch",
    city: "بيروت",
    district: "بيروت",
    locationName: "شارع فoch - الحمرا - بيروت",
  }
  const contactPhone = "03123456"
  const contactName = "Owner"
  const reportImageUrl = ""
  const lat = 33.8938
  const lng = 35.5018

  return {
    phone: contactPhone,
    ownerPhone: contactPhone,
    ownerName: contactName,
    description: description || "",
    reportImageUrl,
    ...type,
    type: type.label,
    color: type.color,
    emoji: type.emoji,
    priority: type.priority,
    expiry: type.expiry,
    helperComing: false,
    helperArrived: false,
    helpers: 0,
    helpersList: [],
    resolved: false,
    area: locationInfo.area,
    street: locationInfo.street,
    city: locationInfo.city,
    district: locationInfo.district,
    locationName: locationInfo.locationName,
    distance: "مباشر",
    lat,
    lng,
    ownerId,
    ownerUid,
    createdAt: Date.now(),
  }
}

/** Mirrors src/App.tsx submitStolenBikeReport create payload. */
function productionStolenReportPayload(ownerUid, ownerId) {
  return {
    id: Date.now(),
    type: "بلاغ عن دراجة مسروقة",
    reportFamily: "stolen",
    reportCategory: "stolen",
    emoji: "🚨",
    priority: "high",
    ownerId,
    ownerUid,
    area: "بيروت",
    street: "",
    city: "بيروت",
    district: "",
    locationName: "بيروت",
    lat: 33.8938,
    lng: 35.5018,
    distance: "الآن",
    color: "#7f1d1d",
    expiry: 43200,
    helperComing: false,
    helperArrived: false,
    helpers: 0,
    resolved: false,
    stolenBikeType: "هوندا",
    stolenBikeColor: "أحمر",
    stolenBikePlate: "B123456",
    stolenBikePhone: "03123456",
    stolenBikePlace: "الحمرا",
    stolenBikeDate: "2026-08-02",
    stolenBikeTime: "20:00",
    stolenBikeImageUrls: ["https://example.com/a.jpg"],
    createdAt: Date.now(),
  }
}

function claimPayload(helperUid, helperId) {
  return {
    helperComing: true,
    helperStatus: "مساعد بالطريق",
    helpers: 1,
    joined: true,
    helperId,
    helperUid,
    helperPhone: "03999999",
    helperName: "Helper",
    helperLat: 33.9,
    helperLng: 35.51,
    helperLocationUpdatedAt: Date.now(),
    helperAcceptedAt: Date.now(),
  }
}

function jpegBytes(size = 64) {
  // Minimal JPEG-ish payload; contentType metadata drives MIME checks.
  const bytes = new Uint8Array(size)
  bytes[0] = 0xff
  bytes[1] = 0xd8
  bytes[2] = 0xff
  return bytes
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: firestoreRules,
      host: "127.0.0.1",
      port: 8080,
    },
    storage: {
      rules: storageRules,
      host: "127.0.0.1",
      port: 9199,
    },
  })
})

after(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.clearStorage()
})

describe("Firestore reports — positive", () => {
  it("authenticated owner creates valid report", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertSucceeds(
      setDoc(doc(db, "reports", "r-create"), baseReport("owner-a", "device-owner-a"))
    )
  })

  it("production createUserReport payload shape is accepted", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore()
    const payload = productionCreateUserReportPayload("owner-a", "device-owner-a")
    assert.equal("label" in payload, true, "expected label from ...type spread")
    assert.equal(payload.type, "محتاج دفشة")
    await assertSucceeds(setDoc(doc(db, "reports", "r-prod-assist"), payload))
  })

  it("production shared-ride createUserReport payload is accepted", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertSucceeds(
      setDoc(
        doc(db, "reports", "r-prod-ride"),
        productionCreateUserReportPayload("owner-a", "device-owner-a", {
          label: "وصلني معك",
          emoji: "🤝",
          color: "#db2777",
          expiry: 10,
          priority: "medium",
          reportFamily: "sharedRide",
          reportCategory: "ride",
          description: "UID TEST shared ride shape",
        })
      )
    )
  })

  it("production incident (حدث) create payload is accepted without rules change", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertSucceeds(
      setDoc(
        doc(db, "reports", "r-prod-incident-fire"),
        productionCreateUserReportPayload("owner-a", "device-owner-a", {
          label: "حريق",
          emoji: "🔥",
          color: "#b91c1c",
          expiry: 90,
          priority: "high",
          reportFamily: "incident",
          reportCategory: "fire",
          description: "دخان قرب الجسر",
        })
      )
    )
  })

  it("production stolen-bike create payload is accepted", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertSucceeds(
      setDoc(
        doc(db, "reports", "r-prod-stolen"),
        productionStolenReportPayload("owner-a", "device-owner-a")
      )
    )
  })

  it("owner resolves own report", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-resolve"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "reports", "r-resolve"), {
        resolved: true,
        solvedAt: Date.now(),
      })
    )
  })

  it("owner deletes own report", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-delete"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertSucceeds(deleteDoc(doc(db, "reports", "r-delete")))
  })

  it("helper claims an unclaimed report", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-claim"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.authenticatedContext("helper-b").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "reports", "r-claim"), claimPayload("helper-b", "device-helper-b"))
    )
  })

  it("accepted helper updates GPS", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "reports", "r-gps"), {
        ...baseReport("owner-a", "device-owner-a"),
        ...claimPayload("helper-b", "device-helper-b"),
      })
    })
    const db = testEnv.authenticatedContext("helper-b").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "reports", "r-gps"), {
        helperLat: 33.91,
        helperLng: 35.52,
        helperLocationUpdatedAt: Date.now(),
      })
    )
  })

  it("accepted helper cancels and clears helper data", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "reports", "r-cancel"), {
        ...baseReport("owner-a", "device-owner-a"),
        ...claimPayload("helper-b", "device-helper-b"),
      })
    })
    const db = testEnv.authenticatedContext("helper-b").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "reports", "r-cancel"), {
        helperComing: false,
        helperStatus: "",
        helpers: 0,
        joined: false,
        helperArrived: false,
        helperId: "",
        helperUid: deleteField(),
        helperName: deleteField(),
        helperPhone: deleteField(),
        helperLat: deleteField(),
        helperLng: deleteField(),
        helperLocationUpdatedAt: deleteField(),
        helperAcceptedAt: deleteField(),
      })
    )
    let data
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "reports", "r-cancel"))
      data = snap.data()
    })
    assert.ok(data, "expected cancelled report document")
    assert.equal(data.helperComing, false)
    assert.equal(data.helperId, "")
    assert.equal(data.helpers, 0)
    assert.equal("helperUid" in data, false)
    assert.equal("helperPhone" in data, false)
    assert.equal("helperLat" in data, false)
    assert.equal(data.ownerUid, "owner-a")
  })

  it("authenticated user creates feedback", async () => {
    const db = testEnv.authenticatedContext("user-f").firestore()
    await assertSucceeds(
      addDoc(collection(db, "feedback"), {
        message: "great app",
        deviceId: "device-f",
        contactName: "Rider",
        contactPhone: "03111111",
        createdAt: Date.now(),
        source: "beta-feedback",
      })
    )
  })
})

describe("Firestore reports — negative", () => {
  it("unauthenticated report read fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-unauth-read"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, "reports", "r-unauth-read")))
  })

  it("unauthenticated report create fails", async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(doc(db, "reports", "r-unauth-create"), baseReport("owner-a", "device-owner-a"))
    )
  })

  it("forged ownerUid fails", async () => {
    const db = testEnv.authenticatedContext("attacker").firestore()
    await assertFails(
      setDoc(doc(db, "reports", "r-forge"), baseReport("victim-uid", "device-attacker"))
    )
  })

  it("create missing resolved fails under strict equality", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore()
    const payload = productionCreateUserReportPayload("owner-a", "device-owner-a")
    delete payload.resolved
    await assertFails(setDoc(doc(db, "reports", "r-no-resolved"), payload))
  })

  it("create with helperArrived null fails helperArrived check", async () => {
    const db = testEnv.authenticatedContext("owner-a").firestore()
    const payload = productionCreateUserReportPayload("owner-a", "device-owner-a")
    payload.helperArrived = null
    await assertFails(setDoc(doc(db, "reports", "r-arrived-null"), payload))
  })

  it("unauthenticated production payload create fails", async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(
        doc(db, "reports", "r-prod-unauth"),
        productionCreateUserReportPayload("owner-a", "device-owner-a")
      )
    )
  })

  it("non-owner resolve fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-nonowner-resolve"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.authenticatedContext("other").firestore()
    await assertFails(
      updateDoc(doc(db, "reports", "r-nonowner-resolve"), {
        resolved: true,
        solvedAt: Date.now(),
      })
    )
  })

  it("non-owner delete fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-nonowner-delete"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.authenticatedContext("other").firestore()
    await assertFails(deleteDoc(doc(db, "reports", "r-nonowner-delete")))
  })

  it("helper claim on claimed report fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "reports", "r-already"), {
        ...baseReport("owner-a", "device-owner-a"),
        ...claimPayload("helper-b", "device-helper-b"),
      })
    })
    const db = testEnv.authenticatedContext("helper-c").firestore()
    await assertFails(
      updateDoc(doc(db, "reports", "r-already"), claimPayload("helper-c", "device-helper-c"))
    )
  })

  it("owner claiming own report fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-self-claim"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertFails(
      updateDoc(doc(db, "reports", "r-self-claim"), claimPayload("owner-a", "device-owner-a"))
    )
  })

  it("unrelated user GPS update fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "reports", "r-gps-deny"), {
        ...baseReport("owner-a", "device-owner-a"),
        ...claimPayload("helper-b", "device-helper-b"),
      })
    })
    const db = testEnv.authenticatedContext("stranger").firestore()
    await assertFails(
      updateDoc(doc(db, "reports", "r-gps-deny"), {
        helperLat: 1,
        helperLng: 2,
        helperLocationUpdatedAt: Date.now(),
      })
    )
  })

  it("helper modifying owner fields fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "reports", "r-helper-tamper"), {
        ...baseReport("owner-a", "device-owner-a"),
        ...claimPayload("helper-b", "device-helper-b"),
      })
    })
    const db = testEnv.authenticatedContext("helper-b").firestore()
    await assertFails(
      updateDoc(doc(db, "reports", "r-helper-tamper"), {
        helperLat: 33.91,
        helperLng: 35.52,
        helperLocationUpdatedAt: Date.now(),
        ownerPhone: "00000000",
      })
    )
  })

  it("helper cancellation leaving stale helper data fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "reports", "r-stale-cancel"), {
        ...baseReport("owner-a", "device-owner-a"),
        ...claimPayload("helper-b", "device-helper-b"),
      })
    })
    const db = testEnv.authenticatedContext("helper-b").firestore()
    await assertFails(
      updateDoc(doc(db, "reports", "r-stale-cancel"), {
        helperComing: false,
        helperStatus: "",
        helpers: 0,
        joined: false,
        helperArrived: false,
        helperId: "",
        // intentionally leave helperUid / phone / GPS
      })
    )
  })

  it("feedback read fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "feedback", "fb1"), {
        message: "secret",
        deviceId: "d",
        contactName: "n",
        contactPhone: "p",
        createdAt: Date.now(),
        source: "beta-feedback",
      })
    })
    const db = testEnv.authenticatedContext("user-f").firestore()
    await assertFails(getDoc(doc(db, "feedback", "fb1")))
  })

  it("feedback update and delete fail", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "feedback", "fb2"), {
        message: "secret",
        deviceId: "d",
        contactName: "n",
        contactPhone: "p",
        createdAt: Date.now(),
        source: "beta-feedback",
      })
    })
    const db = testEnv.authenticatedContext("user-f").firestore()
    await assertFails(updateDoc(doc(db, "feedback", "fb2"), { message: "hacked" }))
    await assertFails(deleteDoc(doc(db, "feedback", "fb2")))
  })

  it("legacy report owner mutation is denied", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const legacy = baseReport("unused", "device-legacy")
      delete legacy.ownerUid
      await setDoc(doc(ctx.firestore(), "reports", "r-legacy"), legacy)
    })
    // Authenticated read still allowed (map).
    const reader = testEnv.authenticatedContext("anyone").firestore()
    await assertSucceeds(getDoc(doc(reader, "reports", "r-legacy")))

    // Cannot resolve/delete by forging device ownership — no ownerUid.
    const pretender = testEnv.authenticatedContext("device-legacy-user").firestore()
    await assertFails(
      updateDoc(doc(pretender, "reports", "r-legacy"), {
        resolved: true,
        solvedAt: Date.now(),
      })
    )
    await assertFails(deleteDoc(doc(pretender, "reports", "r-legacy")))
  })
})

describe("Firestore race — helper claim", () => {
  it("only one of two competing claims succeeds", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-race"),
        baseReport("owner-a", "device-owner-a")
      )
    })

    const db1 = testEnv.authenticatedContext("helper-1").firestore()
    const db2 = testEnv.authenticatedContext("helper-2").firestore()

    const settled = await Promise.allSettled([
      updateDoc(doc(db1, "reports", "r-race"), claimPayload("helper-1", "device-h1")),
      updateDoc(doc(db2, "reports", "r-race"), claimPayload("helper-2", "device-h2")),
    ])

    const ok = settled.filter((r) => r.status === "fulfilled").length
    const fail = settled.filter((r) => r.status === "rejected").length
    assert.equal(ok, 1, `expected exactly one claim success, got ${ok}`)
    assert.equal(fail, 1, `expected exactly one claim failure, got ${fail}`)

    let winner
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), "reports", "r-race"))
      winner = snap.data()?.helperUid
    })
    assert.ok(winner === "helper-1" || winner === "helper-2")
  })
})

describe("Storage — positive", () => {
  it("authenticated valid image upload succeeds (report-images)", async () => {
    const storage = testEnv.authenticatedContext("owner-a").storage(STORAGE_BUCKET)
    const objectRef = ref(storage, "report-images/1234-test.jpg")
    await assertSucceeds(
      uploadBytes(objectRef, jpegBytes(128), { contentType: "image/jpeg" })
    )
  })

  it("authenticated valid image upload succeeds (stolen-bikes)", async () => {
    const storage = testEnv.authenticatedContext("owner-a").storage(STORAGE_BUCKET)
    const objectRef = ref(storage, "stolen-bikes/5678-bike.jpg")
    await assertSucceeds(
      uploadBytes(objectRef, jpegBytes(128), { contentType: "image/jpeg" })
    )
  })

  it("permitted authenticated image read succeeds", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const storage = ctx.storage(STORAGE_BUCKET)
      await uploadBytes(ref(storage, "report-images/read-me.jpg"), jpegBytes(64), {
        contentType: "image/jpeg",
      })
    })
    const storage = testEnv.authenticatedContext("reader").storage(STORAGE_BUCKET)
    await assertSucceeds(getBytes(ref(storage, "report-images/read-me.jpg")))
  })

  it("authorized delete is not enforceable — client delete denied", async () => {
    // Paths lack UID ownership; rules intentionally deny all client deletes.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const storage = ctx.storage(STORAGE_BUCKET)
      await uploadBytes(ref(storage, "report-images/no-delete.jpg"), jpegBytes(64), {
        contentType: "image/jpeg",
      })
    })
    const storage = testEnv.authenticatedContext("owner-a").storage(STORAGE_BUCKET)
    await assertFails(deleteObject(ref(storage, "report-images/no-delete.jpg")))
  })
})

describe("Storage — negative", () => {
  it("unauthenticated upload fails", async () => {
    const storage = testEnv.unauthenticatedContext().storage(STORAGE_BUCKET)
    await assertFails(
      uploadBytes(ref(storage, "report-images/unauth.jpg"), jpegBytes(64), {
        contentType: "image/jpeg",
      })
    )
  })

  it("oversized image fails", async () => {
    const storage = testEnv.authenticatedContext("owner-a").storage(STORAGE_BUCKET)
    const oversized = jpegBytes(2 * 1024 * 1024 + 1)
    await assertFails(
      uploadBytes(ref(storage, "report-images/big.jpg"), oversized, {
        contentType: "image/jpeg",
      })
    )
  })

  it("non-image MIME type fails", async () => {
    const storage = testEnv.authenticatedContext("owner-a").storage(STORAGE_BUCKET)
    await assertFails(
      uploadBytes(ref(storage, "report-images/not-image.bin"), jpegBytes(32), {
        contentType: "application/octet-stream",
      })
    )
  })

  it("arbitrary path upload fails", async () => {
    const storage = testEnv.authenticatedContext("owner-a").storage(STORAGE_BUCKET)
    await assertFails(
      uploadBytes(ref(storage, "other-path/secret.jpg"), jpegBytes(32), {
        contentType: "image/jpeg",
      })
    )
  })

  it("overwrite fails where prohibited", async () => {
    const path = "report-images/once-only.jpg"
    const storage = testEnv.authenticatedContext("owner-a").storage(STORAGE_BUCKET)
    await assertSucceeds(
      uploadBytes(ref(storage, path), jpegBytes(32), { contentType: "image/jpeg" })
    )
    await assertFails(
      uploadBytes(ref(storage, path), jpegBytes(48), { contentType: "image/jpeg" })
    )
  })

  it("unauthorized delete fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(STORAGE_BUCKET), "stolen-bikes/locked.jpg"),
        jpegBytes(32),
        { contentType: "image/jpeg" }
      )
    })
    const storage = testEnv.authenticatedContext("stranger").storage(STORAGE_BUCKET)
    await assertFails(deleteObject(ref(storage, "stolen-bikes/locked.jpg")))
  })
})

function defaultNotificationPreferences(overrides = {}) {
  return {
    helperLifecycle: true,
    ownerLifecycle: true,
    stolenNearby: false,
    criticalRoads: false,
    sharedRides: false,
    communityRides: false,
    announcements: false,
    marketing: false,
    ...overrides,
  }
}

function baseSubscription(uid, extras = {}) {
  const now = Date.now()
  return {
    uid,
    installationId: "install-" + uid,
    deviceId: "device-" + uid,
    token: "fcm-token-" + uid + "-abcdefghijklmnopqrstuvwxyz012345",
    platform: "android",
    browser: "chrome",
    locale: "ar",
    enabled: true,
    permissionState: "granted",
    browserSupportState: "supported",
    notificationPreferences: defaultNotificationPreferences(),
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    appVersion: "web",
    ...extras,
  }
}

describe("Firestore notificationSubscriptions — positive", () => {
  it("create own subscription", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(
      setDoc(doc(db, "notificationSubscriptions", "sub-a1"), baseSubscription("rider-a"))
    )
  })

  it("update enabled", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-en"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "notificationSubscriptions", "sub-en"), {
        enabled: false,
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("update preferences", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-pref"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "notificationSubscriptions", "sub-pref"), {
        notificationPreferences: defaultNotificationPreferences({
          announcements: true,
          marketing: false,
        }),
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("update permissionState", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-perm"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "notificationSubscriptions", "sub-perm"), {
        permissionState: "denied",
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("update browserSupportState", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-bss"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "notificationSubscriptions", "sub-bss"), {
        browserSupportState: "missing_vapid_key",
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("update lastSeenAt", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-seen"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(
      updateDoc(doc(db, "notificationSubscriptions", "sub-seen"), {
        lastSeenAt: Date.now() + 1000,
        updatedAt: Date.now() + 1000,
      })
    )
  })

  it("delete own subscription", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-del"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(deleteDoc(doc(db, "notificationSubscriptions", "sub-del")))
  })

  it("multiple devices same uid", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-phone"),
        baseSubscription("rider-a", {
          installationId: "install-phone",
          deviceId: "device-phone",
          token: "fcm-token-phone-abcdefghijklmnopqrstuvwxyz012345",
        })
      )
    )
    await assertSucceeds(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-tablet"),
        baseSubscription("rider-a", {
          installationId: "install-tablet",
          deviceId: "device-tablet",
          token: "fcm-token-tablet-abcdefghijklmnopqrstuvwxyz012345",
        })
      )
    )
  })

  it("get own subscription", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-get"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertSucceeds(getDoc(doc(db, "notificationSubscriptions", "sub-get")))
  })
})

describe("Firestore notificationSubscriptions — negative", () => {
  it("unauthenticated create fails", async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(doc(db, "notificationSubscriptions", "sub-anon"), baseSubscription("rider-a"))
    )
  })

  it("forged uid fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(doc(db, "notificationSubscriptions", "sub-forge"), baseSubscription("rider-b"))
    )
  })

  it("read another subscription fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-other"),
        baseSubscription("rider-b")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(getDoc(doc(db, "notificationSubscriptions", "sub-other")))
  })

  it("list subscriptions fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-list-1"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(getDocs(collection(db, "notificationSubscriptions")))
  })

  it("update another subscription fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-upd-other"),
        baseSubscription("rider-b")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      updateDoc(doc(db, "notificationSubscriptions", "sub-upd-other"), {
        enabled: false,
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("delete another subscription fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-del-other"),
        baseSubscription("rider-b")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(deleteDoc(doc(db, "notificationSubscriptions", "sub-del-other")))
  })

  it("modify uid fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-uid"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      updateDoc(doc(db, "notificationSubscriptions", "sub-uid"), {
        uid: "rider-b",
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("modify installationId fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-inst"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      updateDoc(doc(db, "notificationSubscriptions", "sub-inst"), {
        installationId: "hacked-install",
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("modify createdAt fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationSubscriptions", "sub-created"),
        baseSubscription("rider-a")
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      updateDoc(doc(db, "notificationSubscriptions", "sub-created"), {
        createdAt: Date.now() + 99999,
        updatedAt: Date.now(),
        lastSeenAt: Date.now(),
      })
    )
  })

  it("oversized token fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-big-token"),
        baseSubscription("rider-a", { token: "x".repeat(4097) })
      )
    )
  })

  it("invalid permissionState fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-bad-perm"),
        baseSubscription("rider-a", { permissionState: "maybe" })
      )
    )
  })

  it("invalid browserSupportState fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-bad-bss"),
        baseSubscription("rider-a", { browserSupportState: "magic" })
      )
    )
  })

  it("invalid platform fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-bad-plat"),
        baseSubscription("rider-a", { platform: "blackberry" })
      )
    )
  })

  it("unknown field fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(doc(db, "notificationSubscriptions", "sub-extra"), {
        ...baseSubscription("rider-a"),
        adminFlag: true,
      })
    )
  })

  it("unknown preference fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-bad-pref-key"),
        baseSubscription("rider-a", {
          notificationPreferences: {
            ...defaultNotificationPreferences(),
            spamAllLebanon: true,
          },
        })
      )
    )
  })

  it("invalid preference type fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-bad-pref-type"),
        baseSubscription("rider-a", {
          notificationPreferences: defaultNotificationPreferences({
            helperLifecycle: "yes",
          }),
        })
      )
    )
  })

  it("invalid nested object fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-nested"),
        baseSubscription("rider-a", {
          notificationPreferences: {
            helperLifecycle: true,
            ownerLifecycle: { nested: true },
            stolenNearby: false,
            criticalRoads: false,
            sharedRides: false,
            communityRides: false,
            announcements: false,
            marketing: false,
          },
        })
      )
    )
  })

  it("write token into reports via update fails", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", "r-token"),
        baseReport("owner-a", "device-owner-a")
      )
    })
    const db = testEnv.authenticatedContext("owner-a").firestore()
    await assertFails(
      updateDoc(doc(db, "reports", "r-token"), {
        token: "fcm-should-not-live-on-report",
        resolved: true,
        solvedAt: Date.now(),
      })
    )
  })

  it("empty token fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-empty-token"),
        baseSubscription("rider-a", { token: "" })
      )
    )
  })

  it("missing preference keys fails", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(
        doc(db, "notificationSubscriptions", "sub-partial-pref"),
        baseSubscription("rider-a", {
          notificationPreferences: {
            helperLifecycle: true,
            announcements: false,
          },
        })
      )
    )
  })
})

describe("Firestore notificationEvents — client deny", () => {
  const eventDoc = {
    type: "helper_accepted",
    reportId: "r-deny-1",
    status: "processing",
    createdAt: Date.now(),
  }

  it("authenticated client cannot get notificationEvents document", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationEvents", "evt-get"),
        eventDoc
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(getDoc(doc(db, "notificationEvents", "evt-get")))
  })

  it("authenticated client cannot list notificationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationEvents", "evt-list"),
        eventDoc
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(getDocs(collection(db, "notificationEvents")))
  })

  it("authenticated client cannot create notificationEvents", async () => {
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      setDoc(doc(db, "notificationEvents", "evt-create"), eventDoc)
    )
  })

  it("authenticated client cannot update notificationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationEvents", "evt-upd"),
        eventDoc
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(
      updateDoc(doc(db, "notificationEvents", "evt-upd"), { status: "sent" })
    )
  })

  it("authenticated client cannot delete notificationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationEvents", "evt-del"),
        eventDoc
      )
    })
    const db = testEnv.authenticatedContext("rider-a").firestore()
    await assertFails(deleteDoc(doc(db, "notificationEvents", "evt-del")))
  })

  it("unauthenticated client cannot read or write notificationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "notificationEvents", "evt-anon"),
        eventDoc
      )
    })
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, "notificationEvents", "evt-anon")))
    await assertFails(
      setDoc(doc(db, "notificationEvents", "evt-anon-write"), eventDoc)
    )
    await assertFails(
      updateDoc(doc(db, "notificationEvents", "evt-anon"), { status: "x" })
    )
    await assertFails(deleteDoc(doc(db, "notificationEvents", "evt-anon")))
  })

  it("Admin / withSecurityRulesDisabled may create fixture notificationEvents", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await assertSucceeds(
        setDoc(doc(ctx.firestore(), "notificationEvents", "evt-admin"), eventDoc)
      )
      const snap = await getDoc(
        doc(ctx.firestore(), "notificationEvents", "evt-admin")
      )
      assert.equal(snap.exists(), true)
      assert.equal(snap.data()?.type, "helper_accepted")
    })
  })
})

describe("Firestore report confirmations — Task 052", () => {
  const reportId = "conf-report-1"
  const ownerUid = "owner-uid"
  const riderA = "rider-a"
  const riderB = "rider-b"

  function confirmationPayload(status, now = Date.now()) {
    return {
      status,
      createdAt: now,
      updatedAt: now,
    }
  }

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", reportId),
        baseReport(ownerUid, "device-owner", {
          type: "زحمة",
          reportFamily: "intelligence",
          reportCategory: "traffic",
        })
      )
    })
  })

  it("authenticated rider can create present confirmation for own uid", async () => {
    const db = testEnv.authenticatedContext(riderA).firestore()
    const now = 1_700_000_000_000
    await assertSucceeds(
      setDoc(
        doc(db, "reports", reportId, "confirmations", riderA),
        confirmationPayload("present", now)
      )
    )
    const snap = await getDoc(
      doc(db, "reports", reportId, "confirmations", riderA)
    )
    assert.equal(snap.exists(), true)
    assert.equal(snap.data()?.status, "present")
  })

  it("authenticated rider can create gone confirmation", async () => {
    const db = testEnv.authenticatedContext(riderA).firestore()
    await assertSucceeds(
      setDoc(
        doc(db, "reports", reportId, "confirmations", riderA),
        confirmationPayload("gone")
      )
    )
  })

  it("invalid confirmation status is rejected", async () => {
    const db = testEnv.authenticatedContext(riderA).firestore()
    await assertFails(
      setDoc(doc(db, "reports", reportId, "confirmations", riderA), {
        status: "like",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )
  })

  it("confirmation doc id must equal auth uid", async () => {
    const db = testEnv.authenticatedContext(riderA).firestore()
    await assertFails(
      setDoc(
        doc(db, "reports", reportId, "confirmations", riderB),
        confirmationPayload("present")
      )
    )
  })

  it("user may update own vote", async () => {
    const now = 1_700_000_000_000
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", reportId, "confirmations", riderA),
        confirmationPayload("present", now)
      )
    })
    const db = testEnv.authenticatedContext(riderA).firestore()
    await assertSucceeds(
      updateDoc(doc(db, "reports", reportId, "confirmations", riderA), {
        status: "gone",
        updatedAt: now + 1000,
      })
    )
    const snap = await getDoc(
      doc(db, "reports", reportId, "confirmations", riderA)
    )
    assert.equal(snap.data()?.status, "gone")
    assert.equal(snap.data()?.createdAt, now)
  })

  it("user cannot update another UID vote", async () => {
    const now = 1_700_000_000_000
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", reportId, "confirmations", riderA),
        confirmationPayload("present", now)
      )
    })
    const db = testEnv.authenticatedContext(riderB).firestore()
    await assertFails(
      updateDoc(doc(db, "reports", reportId, "confirmations", riderA), {
        status: "gone",
        updatedAt: now + 1,
      })
    )
  })

  it("report owner cannot create community confirmation", async () => {
    const db = testEnv.authenticatedContext(ownerUid).firestore()
    await assertFails(
      setDoc(
        doc(db, "reports", reportId, "confirmations", ownerUid),
        confirmationPayload("present")
      )
    )
  })

  it("extra sensitive fields on confirmation are rejected", async () => {
    const db = testEnv.authenticatedContext(riderA).firestore()
    await assertFails(
      setDoc(doc(db, "reports", reportId, "confirmations", riderA), {
        status: "present",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deviceId: "device-spy",
        phone: "03123456",
      })
    )
  })

  it("authenticated rider can list confirmations (counts only in UI)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", reportId, "confirmations", riderA),
        confirmationPayload("present")
      )
      await setDoc(
        doc(ctx.firestore(), "reports", reportId, "confirmations", riderB),
        confirmationPayload("gone")
      )
    })
    const db = testEnv.authenticatedContext(riderA).firestore()
    const snap = await assertSucceeds(
      getDocs(collection(db, "reports", reportId, "confirmations"))
    )
    assert.equal(snap.size, 2)
  })

  it("confirmation create does not allow mutating parent report", async () => {
    const db = testEnv.authenticatedContext(riderA).firestore()
    await assertSucceeds(
      setDoc(
        doc(db, "reports", reportId, "confirmations", riderA),
        confirmationPayload("present")
      )
    )
    await assertFails(
      updateDoc(doc(db, "reports", reportId), { expiry: 9999 })
    )
    const parent = await getDoc(doc(db, "reports", reportId))
    assert.equal(parent.data()?.ownerUid, ownerUid)
    assert.notEqual(parent.data()?.expiry, 9999)
  })

  it("unauthenticated cannot write confirmations", async () => {
    const db = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(
        doc(db, "reports", reportId, "confirmations", "anyone"),
        confirmationPayload("present")
      )
    )
  })
})

describe("Firestore confirmation aggregates — Task 056", () => {
  const reportId = "agg-report-1"
  const ownerUid = "owner-agg"
  const riderA = "rider-agg-a"

  beforeEach(async () => {
    await testEnv.clearFirestore()
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "reports", reportId),
        baseReport(ownerUid, "device-owner", {
          type: "زحمة",
          reportFamily: "intelligence",
          reportCategory: "traffic",
          confirmationPresentCount: 2,
          confirmationGoneCount: 4,
          confirmationUpdatedAt: Date.now(),
          likelyGoneSince: Date.now() - 60_000,
        })
      )
    })
  })

  it("client cannot create report with confirmation aggregates", async () => {
    const db = testEnv.authenticatedContext(ownerUid).firestore()
    await assertFails(
      setDoc(doc(db, "reports", "new-with-agg"), {
        ...baseReport(ownerUid, "device-owner", {
          type: "زحمة",
          reportFamily: "intelligence",
          reportCategory: "traffic",
        }),
        confirmationPresentCount: 9,
        confirmationGoneCount: 0,
      })
    )
  })

  it("client cannot update confirmationPresentCount", async () => {
    const db = testEnv.authenticatedContext(ownerUid).firestore()
    await assertFails(
      updateDoc(doc(db, "reports", reportId), {
        confirmationPresentCount: 99,
      })
    )
  })

  it("client cannot clear likelyGoneSince", async () => {
    const db = testEnv.authenticatedContext(ownerUid).firestore()
    await assertFails(
      updateDoc(doc(db, "reports", reportId), {
        likelyGoneSince: deleteField(),
      })
    )
  })

  it("client cannot update confirmationGoneCount via helper path", async () => {
    const db = testEnv.authenticatedContext(riderA).firestore()
    await assertFails(
      updateDoc(doc(db, "reports", reportId), {
        confirmationGoneCount: 0,
        helperComing: true,
      })
    )
  })
})
