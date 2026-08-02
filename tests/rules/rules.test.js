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
