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
 * Returns the current user, or signs in anonymously once if none exists.
 * Does not sign in again when a persisted anonymous session is already restored.
 */
export function ensureAnonymousAuth(): Promise<User> {
  if (auth.currentUser) {
    return Promise.resolve(auth.currentUser)
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
