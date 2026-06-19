import { initializeApp } from "firebase/app"
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

export const db = getFirestore(app)
export const storage = getStorage(app)