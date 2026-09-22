/* The demo uses only an in-memory store. Firebase is never loaded in demo mode. */
export const DEMO_MODE = typeof location !== "undefined" &&
  new URLSearchParams(location.search).get("demo") === "1";

const sdk = DEMO_MODE ? await import("./demo-store.js") : Object.assign({}, ...await Promise.all([
  import("https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js"),
  import("https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js"),
  import("https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js")
]));

export const {
  initializeApp, deleteApp, getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup,
  GoogleAuthProvider, signOut, deleteUser, reauthenticateWithCredential,
  reauthenticateWithPopup, EmailAuthProvider, sendEmailVerification,
  sendPasswordResetEmail, getFirestore, doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, query, orderBy, limit, addDoc, updateDoc, deleteField,
  writeBatch, where, documentId
} = sdk;

export const demo = DEMO_MODE ? sdk : null;
