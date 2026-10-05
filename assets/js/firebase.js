import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-storage.js";

// Replace these values with the web app config from your Firebase project settings.
const firebaseConfig = {
  apiKey: "AIzaSyAz7tsVDT3bfpTIeBE2sbDLXeeMlW5pz2c",
  authDomain: "vcktec.firebaseapp.com",
  projectId: "vcktec",
  storageBucket: "vcktec.firebasestorage.app",
  messagingSenderId: "686633550497",
  appId: "1:686633550497:web:4c75be2ad2eae8f10826e0"
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0 && !value.includes("YOUR_")
);

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const storage = app ? getStorage(app) : null;
