import { initializeApp } from "firebase/app"
import { getAuth, signInAnonymously, type User } from "firebase/auth"
import { getFirestore } from "firebase/firestore"
import { getStorage } from "firebase/storage"

const firebaseConfig = {
  apiKey:  "AIzaSyCSYb0Jt5dtptjkbznprdpYBnwivaH8RZ4",
  authDomain: "totimoto-rider-network.firebaseapp.com",
  projectId: "totimoto-rider-network",
  storageBucket: "totimoto-rider-network.firebasestorage.app",
  messagingSenderId: "1080405576408",
  appId: "1:1080405576408:web:94ea65fda3c4a662bba5ad",
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

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
