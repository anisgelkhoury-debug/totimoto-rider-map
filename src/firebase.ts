import { initializeApp, type FirebaseApp } from "firebase/app"
import { getAuth, signInAnonymously, type User } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getMessaging, isSupported, type Messaging } from "firebase/messaging"
import { getStorage } from "firebase/storage"
import { firebaseConfig } from "./firebaseConfig"

const app: FirebaseApp = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

let messagingInstance: Messaging | null = null
let messagingInitPromise: Promise<Messaging | null> | null = null

/**
 * Lazily initializes Firebase Messaging only when the browser supports it.
 * Never throws for unsupported environments; returns null instead.
 */
export async function getFirebaseMessagingIfSupported(): Promise<Messaging | null> {
  if (messagingInstance) return messagingInstance
  if (messagingInitPromise) return messagingInitPromise

  messagingInitPromise = (async () => {
    try {
      if (typeof window === "undefined") return null
      const supported = await isSupported()
      if (!supported) return null
      messagingInstance = getMessaging(app)
      return messagingInstance
    } catch {
      return null
    }
  })()

  return messagingInitPromise
}

/** Dedupes concurrent anonymous sign-in (e.g. React StrictMode remounts). */
let anonymousSignInInFlight: Promise<User> | null = null

/**
 * Waits for Auth restoration, then returns the current user, or signs in
 * anonymously once if none exists. Does not create a second anonymous account
 * when a persisted session is already restored.
 */
export async function ensureAnonymousAuth(): Promise<User> {
  await auth.authStateReady()

  if (auth.currentUser) {
    return auth.currentUser
  }

  if (!anonymousSignInInFlight) {
    anonymousSignInInFlight = signInAnonymously(auth)
      .then((credential) => credential.user)
      .catch((error) => {
        anonymousSignInInFlight = null
        throw error
      })
  }

  return anonymousSignInInFlight
}

/**
 * Resolves a non-empty Firebase Auth UID for ownership writes.
 * Reuses ensureAnonymousAuth (no duplicate sign-in). Never returns empty/null UID.
 */
export async function requireAuthUid(): Promise<string> {
  const user = await ensureAnonymousAuth()
  const uid = user?.uid?.trim()
  if (!uid) {
    throw new Error("Authenticated UID is unavailable")
  }
  return uid
}
