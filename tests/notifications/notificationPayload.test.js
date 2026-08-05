/**
 * TRN Task 034D — deep-link + FCM display payload unit tests.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  buildTrnDeepLink,
  createMockNotificationPayload,
  normalizeFcmDisplayPayload,
  parseTrnSearchParams,
} from "../../src/notifications/notificationPayload.ts"

describe("notification payload + deep links", () => {
  it("parses report and notification query params", () => {
    const parsed = parseTrnSearchParams(
      "?report=abc123&notification=helper_accepted&extra=1"
    )
    assert.equal(parsed.reportId, "abc123")
    assert.equal(parsed.notificationType, "helper_accepted")
  })

  it("builds deep link path without inventing values", () => {
    assert.equal(
      buildTrnDeepLink({ reportId: "r1", notificationType: "helper_cancelled" }),
      "/?report=r1&notification=helper_cancelled"
    )
    assert.equal(
      buildTrnDeepLink(
        { reportId: "r1", notificationType: "owner_resolved" },
        "https://app.totimoto.com"
      ),
      "https://app.totimoto.com/?report=r1&notification=owner_resolved"
    )
  })

  it("normalizes FCM-like payload fields for display", () => {
    const display = normalizeFcmDisplayPayload(
      {
        notification: {
          title: "يوجد درّاج قادم لمساعدتك",
          body: "اضغط لمتابعة الطلب على الخريطة",
          icon: "/icon-192.png",
        },
        data: {
          reportId: "rep-9",
          notificationType: "helper_accepted",
          tag: "trn-helper_accepted-rep-9",
        },
      },
      "https://app.totimoto.com"
    )

    assert.equal(display.title, "يوجد درّاج قادم لمساعدتك")
    assert.equal(display.body, "اضغط لمتابعة الطلب على الخريطة")
    assert.equal(display.icon, "/icon-192.png")
    assert.equal(display.tag, "trn-helper_accepted-rep-9")
    assert.equal(display.data.reportId, "rep-9")
    assert.equal(display.data.notificationType, "helper_accepted")
    assert.equal(
      display.data.deepLink,
      "https://app.totimoto.com/?report=rep-9&notification=helper_accepted"
    )
  })

  it("mock payload includes required test fields", () => {
    const mock = createMockNotificationPayload({
      title: "تجربة",
      body: "جسم",
      reportId: "mock-42",
      notificationType: "mock",
      tag: "trn-mock-42",
      icon: "/icon-512.png",
    })
    const display = normalizeFcmDisplayPayload(mock)
    assert.equal(display.title, "تجربة")
    assert.equal(display.body, "جسم")
    assert.equal(display.icon, "/icon-512.png")
    assert.equal(display.tag, "trn-mock-42")
    assert.equal(display.data.reportId, "mock-42")
    assert.equal(display.data.notificationType, "mock")
  })

  it("empty search yields null deep-link parts", () => {
    const parsed = parseTrnSearchParams("")
    assert.equal(parsed.reportId, null)
    assert.equal(parsed.notificationType, null)
  })
})
