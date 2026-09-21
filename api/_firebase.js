import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

let app;

export function firebaseApp(){
  if (app) return app;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("firebase_not_configured");
  const credentials = JSON.parse(raw);
  if (typeof credentials.private_key === "string")
    credentials.private_key = credentials.private_key.replace(/\\n/g, "\n");
  app = getApps().find(a => a.name === "clam-api") ||
    initializeApp({ credential: cert(credentials) }, "clam-api");
  return app;
}

export const adminAuth = () => getAuth(firebaseApp());
export const adminDb = () => getFirestore(firebaseApp());
