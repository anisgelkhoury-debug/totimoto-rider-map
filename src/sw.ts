/// <reference lib="webworker" />
/**
 * TRN unified service worker: Workbox precache + FCM background + notification click.
 * Single worker at scope `/` — do not register a second messaging SW.
 */
import { clientsClaim } from "workbox-core"
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching"
import { NavigationRoute, registerRoute } from "workbox-routing"
import { initializeApp } from "firebase/app"
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw"
import { firebaseConfig } from "./firebaseConfig"
import {
  buildTrnDeepLink,
  isSafeTrnDeepLink,
  normalizeFcmDisplayPayload,
} from "./notifications/notificationPayload"

declare let self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}

void self.skipWaiting()
clientsClaim()

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/__/, /\/[^/?]+\.[^/]+$/],
  })
)

const firebaseApp = initializeApp(firebaseConfig)
const messaging = getMessaging(firebaseApp)

async function showTrnNotification(payload: unknown): Promise<void> {
  const display = normalizeFcmDisplayPayload(payload, self.location.origin)
  await self.registration.showNotification(display.title, {
    body: display.body,
    icon: display.icon,
    badge: display.badge,
    tag: display.tag,
    data: display.data,
  })
}

onBackgroundMessage(messaging, async (payload) => {
  await showTrnNotification(payload)
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()

  const raw = (event.notification.data || {}) as {
    reportId?: string
    notificationType?: string
    deepLink?: string
  }

  const deepLinkCandidate =
    (typeof raw.deepLink === "string" && raw.deepLink) ||
    buildTrnDeepLink(
      {
        reportId: raw.reportId,
        notificationType: raw.notificationType,
      },
      self.location.origin
    )

  const deepLink = isSafeTrnDeepLink(deepLinkCandidate, self.location.origin)
    ? deepLinkCandidate
    : buildTrnDeepLink(
        {
          reportId: raw.reportId,
          notificationType: raw.notificationType,
        },
        self.location.origin
      )

  const absoluteUrl = deepLink.startsWith("http")
    ? deepLink
    : `${self.location.origin}${deepLink.startsWith("/") ? "" : "/"}${deepLink}`

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })

      for (const client of allClients) {
        if (!client.url.startsWith(self.location.origin)) continue
        if ("focus" in client) {
          await client.focus()
          client.postMessage({
            type: "TRN_NOTIFICATION_CLICK",
            reportId: raw.reportId || "",
            notificationType: raw.notificationType || "",
            deepLink: absoluteUrl,
          })
          return
        }
      }

      await self.clients.openWindow(absoluteUrl)
    })()
  )
})

/**
 * Local mock only: page posts TRN_MOCK_BACKGROUND_NOTIFICATION on localhost.
 * Never used for production Cloud Messaging sends.
 */
self.addEventListener("message", (event) => {
  const data = event.data
  if (!data || data.type !== "TRN_MOCK_BACKGROUND_NOTIFICATION") return

  const host = self.location.hostname
  const localHost =
    host === "localhost" || host === "127.0.0.1" || host === "[::1]"
  if (!localHost) return

  event.waitUntil(showTrnNotification(data.payload))
})
