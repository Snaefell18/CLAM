/* ══════════════════════════════════════════════════════════════════
   CLAM — Closed-Loop Autoimmune Management
   index.html + app.js  ·  Firebase Auth/Firestore  ·  Claude

   Der derzeitige Ablauf:

     Wearable + Tages-Check + Fotos
       → Abweichung gegen die persönliche Baseline (nur RA)
       → gezielte Nachfragen bei erhöhter Einstufung
       → Bericht zur eigenen Weitergabe speichern
       → Laborwerte selbst nachtragen

   Die Rechenlogik steckt vollständig in risk.js, die fachlichen Listen
   in data.js. Diese Datei ist Oberfläche, Datenhaltung und Ablauf.
   ══════════════════════════════════════════════════════════════════ */

/* ─────────────────  1. KONFIGURATION  ─────────────────
   ▸ EINZUTRAGEN: Werte aus der Firebase-Konsole,
     Projekteinstellungen → Meine Apps → Web-App → SDK-Konfiguration.
   Diese Werte sind öffentlich und dürfen im Frontend stehen; der Schutz
   der Daten läuft über die Firestore-Regeln (siehe firestore.rules). */
export const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyADOIB5PV2CVmYXQeCl5V34gptzjUQ0dZY",
  authDomain:        "clam-cd7c5.firebaseapp.com",
  projectId:         "clam-cd7c5",
  storageBucket:     "clam-cd7c5.firebasestorage.app",
  messagingSenderId: "493181047122",
  appId:             "1:493181047122:web:7ffaae5f83384625322a8b"
};

/* Serverless-Proxys für die Claude-API. Der API-Key gehört NIE ins
   Frontend — er steht als Umgebungsvariable ANTHROPIC_API_KEY auf dem
   Server (siehe api/*.js und README). */
const API = {
  assess: "/api/assess",   // Nachfragen und Einordnung bei erhöhtem Risiko
  photo:  "/api/photo",    // Bildauswertung betroffener Körperstellen
  report: "/api/report"    // Bericht für die Praxis
};

/* ─────────────────  2. FIREBASE  ───────────────── */

import { initializeApp } from "./backend.js";
import { DEMO_MODE, demo, sendPasswordResetEmail } from "./backend.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut,
  deleteUser, reauthenticateWithCredential, reauthenticateWithPopup, EmailAuthProvider,
  sendEmailVerification
} from "./backend.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs,
  query, orderBy, limit, addDoc, updateDoc, deleteField, writeBatch, where, documentId
} from "./backend.js";
import {
  assess, assessSeries, lastKeys, shiftKey, dateToKey,
  SIGNALS, SIGNAL_IDS, GATES, LEVELS, deltaText, probPct
} from "./risk.js";
import {
  CONDITIONS, JOINTS, DRUGS, WEARABLES, LABS, CHECKS, STIFF_STEPS,
  VITALS, ICON, LEGAL
} from "./data.js";
import { loadCatalog } from "./catalog.js";
import { initAdmin, checkAdmin, openAdmin } from "./admin.js";
import {
  initDoctor, loadPractice, renderDoctorOnboarding, openDoctorHome,
  resolveCode, CODE_RE
} from "./doctor.js";
import { initSeed } from "./seed.js";

const fb    = initializeApp(FIREBASE_CONFIG);
const auth  = getAuth(fb);

async function apiPost(endpoint, payload){
  if (DEMO_MODE) return demo.demoResponse(endpoint, payload);
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Bitte erneut anmelden.");
  return fetch(endpoint, {
    method:"POST",
    headers:{ "content-type":"application/json", authorization:`Bearer ${token}` },
    body:JSON.stringify(payload)
  });
}

const db    = getFirestore(fb);
const gprov = new GoogleAuthProvider();

/* ─────────────────  3. STATE & HELFER  ───────────────── */

const S = {
  uid:null,
  profile:null,
  day:null,          // der gerade angezeigte Tag
  dayKey:null,
  days:[],           // Fenster der letzten Tage — Grundlage der Baseline
  risk:null,         // Bewertung des angezeigten Tages
  obStep:0,
  draft:{},
  admin:false,    // nur für die Sichtbarkeit des Menüs, verbindlich sind die Regeln
  doctor:false,
  modelVersion:"defaults-v1"
};

/* Wie viele Tage rückwärts geladen werden. Baseline (28) + Lag (2) +
   Puffer für die Verlaufskurve. */
const WINDOW_DAYS = 60;

/* Der Splash bleibt mindestens so lange stehen, dass die Marke sich
   fertig zeichnen kann — sonst blitzt er nur kurz auf. Die längste
   Animation ist der Schriftzug: Start bei 1,02 s, Dauer 0,72 s. */
const BOOT_MIN_MS = 2050;
const bootStart = Date.now();

(document.fonts ? document.fonts.ready : Promise.resolve())
  .then(() => document.getElementById("boot").classList.add("ready"));
setTimeout(() => document.getElementById("boot").classList.add("ready"), 700);

function hideBoot(){
  setTimeout(() => document.getElementById("boot").classList.add("off"),
    Math.max(0, BOOT_MIN_MS - (Date.now() - bootStart)));
}

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const num  = n => Math.round(n).toLocaleString("de-DE");
const dec1 = n => n.toLocaleString("de-DE", { minimumFractionDigits:1, maximumFractionDigits:1 });
const esc  = s => String(s).replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

const todayKey = () => dateToKey(new Date());
const viewingToday = () => S.dayKey === todayKey();
const clock = () => new Date().toTimeString().slice(0,5);

const WD = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];
const MO = ["Januar","Februar","März","April","Mai","Juni","Juli","August",
            "September","Oktober","November","Dezember"];

function dayLabel(key){
  if (key === todayKey()) return "Heute";
  if (key === shiftKey(todayKey(), -1)) return "Gestern";
  const d = new Date(`${key}T12:00:00`);
  return `${WD[d.getDay()].slice(0,2)}. ${d.getDate()}. ${MO[d.getMonth()].slice(0,3)}`;
}
function longDate(key){
  const d = new Date(`${key}T12:00:00`);
  return `${WD[d.getDay()]}, ${d.getDate()}. ${MO[d.getMonth()]} ${d.getFullYear()}`;
}

function screen(id){
  $$(".screen").forEach(s => s.classList.toggle("on", s.id === id));
  window.scrollTo(0,0);
}

let toastT;
function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("on");
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove("on"), 2800);
}

/* Zahl aus einem Eingabefeld. Akzeptiert Komma wie Punkt — auf dem
   iOS-Zahlenblock liegt das Komma. */
function numOf(v){
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/* ─────────────────  4. TEXTE ZUR RISIKOSTUFE  ─────────────────
   An einer Stelle gebündelt, damit Ton und Wortwahl konsistent bleiben.
   Wichtig: nie diagnostisch formulieren. "Deine Werte weichen ab" statt
   "Du hast einen Schub". */
const LEVEL_TEXT = {
  low:      { t:"Niedrig",  s:"Deine Werte liegen im Bereich deines Normalen." },
  elevated: { t:"Erhöht",   s:"Mehrere Werte weichen von deiner Baseline ab." },
  high:     { t:"Hoch",     s:"Deutliche Abweichung über mehrere Kennzahlen." },
  building: { t:"Baseline", s:"Die App lernt gerade deine Normalwerte." },
  unsupported:{ t:"Nicht bewertet", s:"Für diese Erkrankung ist die Einstufung nicht geprüft." },
  nodata:   { t:"Keine Daten", s:"Für diesen Tag liegen noch keine Werte vor." }
};

/* Der Adminbereich bekommt Datenbank, Anmeldung und die Bausteine der
   Oberfläche gereicht, statt sie sich selbst zu besorgen — so gibt es
   weiterhin nur ein Sheet-System und einen Toast. */
/* Der Testpatienten-Generator braucht die Konfiguration, weil er eine
   zweite Firebase-Instanz aufmacht — sonst würde das Anlegen den Admin
   aus seinem eigenen Konto werfen. */
initSeed({
  db, auth, config: FIREBASE_CONFIG,
  ui:{ openSheet:(...a) => openSheet(...a), closeSheet:() => closeSheet(), toast:m => toast(m) }
});

initDoctor({
  db, auth,
  ui:{
    openSheet:(...a) => openSheet(...a),
    closeSheet:() => closeSheet(),
    toast:m => toast(m),
    screen:id => screen(id)
  },
  onSignOut: () => signOut(auth).then(closeSheet)
});

initAdmin({
  db, auth,
  ui:{ openSheet:(...a) => openSheet(...a), closeSheet:() => closeSheet(), toast:m => toast(m) },
  /* Nach einer Katalogänderung muss der Startbildschirm neu rechnen:
     geänderte Gewichte oder Schwellen verschieben das Risiko sofort. */
  onSaved: catalog => { S.modelVersion = catalog.version; recompute(); renderHome(); }
});

/* ─────────────────  5. AUTH  ───────────────── */

/* Die Rollenwahl liegt lokal, damit der Login-Screen sie beim nächsten
   Start noch weiß. Verbindlich ist sie nur beim ERSTEN Anmelden: danach
   entscheidet allein, welches Dokument existiert. */
const ROLE_KEY = "clam-role";
let loginRole = (() => {
  try { return localStorage.getItem(ROLE_KEY) === "doctor" ? "doctor" : "patient"; }
  catch { return "patient"; }
})();

$$("#li-role button").forEach(b => {
  b.classList.toggle("on", b.dataset.role === loginRole);
  b.onclick = () => {
    loginRole = b.dataset.role;
    try { localStorage.setItem(ROLE_KEY, loginRole); } catch {}
    $$("#li-role button").forEach(x => x.classList.toggle("on", x === b));
  };
});

let signupMode = false;

$("#li-toggle").onclick = () => {
  signupMode = !signupMode;
  $("#li-go").textContent     = signupMode ? "Konto erstellen" : "Anmelden";
  $("#li-toggle").textContent = signupMode ? "Schon ein Konto? Anmelden" : "Noch kein Konto? Registrieren";
  $("#li-pass").autocomplete  = signupMode ? "new-password" : "current-password";
  $("#li-err").textContent    = "";
};

const AUTH_ERR = {
  "auth/invalid-email":         "Diese E-Mail-Adresse ist ungültig.",
  "auth/invalid-credential":    "E-Mail oder Passwort stimmen nicht.",
  "auth/wrong-password":        "E-Mail oder Passwort stimmen nicht.",
  "auth/user-not-found":        "Zu dieser E-Mail gibt es kein Konto.",
  "auth/email-already-in-use":  "Für diese E-Mail gibt es bereits ein Konto.",
  "auth/weak-password":         "Das Passwort braucht mindestens 6 Zeichen.",
  "auth/popup-closed-by-user":  "Anmeldung abgebrochen.",
  "auth/network-request-failed":"Keine Verbindung. Prüfe dein Netz."
};

async function doAuth(fn){
  $("#li-err").textContent = "";
  $("#li-go").disabled = true;
  try { await fn(); }
  catch(e){ $("#li-err").textContent = AUTH_ERR[e.code] || "Das hat nicht geklappt. Bitte noch einmal versuchen."; }
  finally { $("#li-go").disabled = false; }
}

$("#li-go").onclick = () => {
  const mail = $("#li-mail").value.trim(), pass = $("#li-pass").value;
  if (!mail || !pass){ $("#li-err").textContent = "Bitte E-Mail und Passwort eingeben."; return; }
  doAuth(async () => {
    if (signupMode){
      const credentials = await createUserWithEmailAndPassword(auth, mail, pass);
      await sendEmailVerification(credentials.user);
    } else await signInWithEmailAndPassword(auth, mail, pass);
  });
};
$("#li-google").onclick = () => doAuth(() => signInWithPopup(auth, gprov));
$("#li-reset").onclick = () => doAuth(async () => {
  const email = $("#li-mail").value.trim();
  if (!email) { $("#li-err").textContent = "Bitte zuerst deine E-Mail-Adresse eingeben."; return; }
  await sendPasswordResetEmail(auth, email);
  $("#li-err").textContent = "Falls ein Konto besteht, erhältst du einen Link zum Zurücksetzen.";
});

onAuthStateChanged(auth, async user => {
  closeSheet();
  try {
  if (!user){
    S.uid = null; S.profile = null; S.days = [];
    $("#install").classList.remove("on");
    screen("s-login");
    hideBoot();
    return;
  }
  S.uid = user.uid;

  /* Katalog zuerst: Erkrankungen, Signale und Gewichte müssen stehen,
     bevor irgendetwas gerechnet oder gezeichnet wird. Schlägt das fehl,
     laufen die Vorgaben aus dem Code weiter. */
  const catalog = await loadCatalog(db);
  if (!catalog.ok){
    $("#li-err").textContent = "Die Berechnungsgrundlage ist nicht verfügbar. Bitte später erneut laden.";
    screen("s-login");
    hideBoot();
    return;
  }
  S.modelVersion = catalog.meta?.version || "defaults-v1";

  /* ── Weiche Praxis / Patient ──
     Nicht die Auswahl auf dem Login entscheidet, sondern welches
     Dokument es gibt: wer einmal als Praxis angelegt ist, landet auch
     dann in der Praxisansicht, wenn der Schalter auf Patient stand.
     Die Auswahl zählt nur, wenn es noch gar kein Konto gibt. */
  const [dsnap, snap] = await Promise.all([
    getDoc(doc(db, "doctors", user.uid)),
    getDoc(doc(db, "users",   user.uid))
  ]);

  const isDoctor = dsnap.exists() ||
    (!snap.exists() && loginRole === "doctor");

  if (isDoctor){
    S.doctor = true;
    await loadPractice(db, user.uid);
    if (dsnap.exists()) await openDoctorHome();
    else { renderDoctorOnboarding(); screen("s-doc-ob"); }
    hideBoot();
    return;
  }

  S.doctor = false;
  S.admin = await checkAdmin();

  if (snap.exists() && snap.data().onboarded){
    S.profile = snap.data();
    if (S.profile.ingestToken){
      // Alte Schlüssel standen im von der Praxis lesbaren Profil. Sie sind
      // serverseitig nicht mehr gültig und werden beim nächsten Login entfernt.
      delete S.profile.ingestToken;
      try {
        const shareDoctorUid = S.profile.doctorUid || null;
        await updateDoc(doc(db, "users", user.uid), {
          ingestToken:deleteField(), shareDoctorUid
        });
        S.profile.shareDoctorUid = shareDoctorUid;
      }
      catch (error){ console.warn("Legacy token removal pending", error); }
    } else if (S.profile.doctorUid && S.profile.shareDoctorUid !== S.profile.doctorUid){
      await updateDoc(doc(db, "users", user.uid), {
        shareDoctorUid:S.profile.doctorUid
      });
      S.profile.shareDoctorUid = S.profile.doctorUid;
    }
    await loadWindow();
    await openDay(todayKey());
    screen("s-home");
    setTimeout(maybeShowInstall, 2600);
  } else {
    /* Regionen zur voreingestellten Diagnose gleich mitgeben. Sonst
       stünde der Schritt leer da, sobald jemand die Vorauswahl einfach
       bestätigt, statt sie anzutippen. */
    S.draft = {
      condition:"ra",
      joints:[...(CONDITIONS.find(c => c.id === "ra")?.joints || [])],
      drugs:[], drugEvery:14, nextDose:"",
      wearable:"applewatch", practice:{ name:"", mail:"", phone:"" },
      consent:false, consentShare:false
    };
    S.obStep = 0;
    renderOb();
    screen("s-ob");
  }
  hideBoot();
  } catch {
    S.profile = null; S.days = []; S.risk = null;
    $("#li-err").textContent = "Deine Daten konnten nicht geladen werden. Bitte erneut laden oder die Demo öffnen.";
    screen("s-login");
    hideBoot();
  }
});

/* ─────────────────  6. DATEN  ─────────────────

   Firestore-Modell
   ────────────────
   users/{uid}                     Profil
   users/{uid}/days/{YYYY-MM-DD}   ein Tag: Vitalwerte, Tages-Check,
                                   Fotos, Laborwerte, gespeicherte
                                   Risikobewertung
   users/{uid}/reports/{id}        erzeugte Praxisberichte
   users/{uid}/photos/{id}         ein Foto als Base64

   Die Bilder liegen bewusst NICHT in Firebase Storage: das verlangt den
   Blaze-Plan. Firestore genügt hier — ein Dokument fasst 1 MiB, und die
   App drückt jedes Bild vorher unter ein festes Budget (siehe
   compress). Ein Bild je Dokument, damit das Tagesdokument klein und
   schnell ladbar bleibt.

   Der Tag ist die Einheit, in der alles zusammenläuft — deshalb ein
   Dokument pro Tag statt getrennter Sammlungen je Datenart. */

async function saveProfile(updateRisk = false){
  // Do not overwrite a newer import summary with an old copy from login.
  const { lastRisk:oldSummary, ...profile } = S.profile;
  if (updateRisk && profile.doctorUid){
    const key = todayKey();
    const r = assess(S.days, key, assess(S.days, shiftKey(key,-1)));
    const supported = profile.condition === "ra";
    profile.lastRisk = {
      modelVersion:S.modelVersion, level:supported ? r.level : "unsupported",
      prob:supported ? r.prob : null, confidence:supported ? r.confidence : null,
      drivers:supported ? r.drivers.slice(0,3).map(d => d.id) : [],
      date:key, at:new Date().toISOString()
    };
  }
  await setDoc(doc(db, "users", S.uid), profile, { merge:true });
}

/* Lädt das Fenster, aus dem Baseline und Verlaufskurve gerechnet werden.
   Ein einziger Lesevorgang über die Sammlung — die Tagesdokumente sind
   klein, das ist günstiger als 60 Einzelabfragen. */
async function loadWindow(){
  const from = shiftKey(todayKey(), -WINDOW_DAYS);
  const snap = await getDocs(query(collection(db, "users", S.uid, "days"),
    where(documentId(), ">=", from)));
  const out = [];
  snap.forEach(d => { if (d.id >= from) out.push({ key:d.id, ...d.data() }); });
  S.days = out.sort((a,b) => a.key.localeCompare(b.key));
}

/* Setzt den angezeigten Tag und bewertet ihn neu. */
async function openDay(key){
  S.dayKey = key;
  S.day = S.days.find(d => d.key === key) || { key };
  recompute();
  renderHome();
}

/* Bewertung des angezeigten Tages, mit dem Vortag als Kontext für die
   Beharrlichkeitsregel. */
function recompute(){
  const prevKey = shiftKey(S.dayKey, -1);
  const prev = assess(S.days, prevKey);
  S.risk = assess(S.days, S.dayKey, prev);
  if (S.profile?.condition !== "ra")
    S.risk = { ...S.risk, level:"unsupported", prob:null, drivers:[] };
}

/* Schreibt den angezeigten Tag zurück — inklusive einer Momentaufnahme
   der Bewertung. Die wird gespeichert, damit der Verlauf später nicht
   von einer inzwischen veränderten Baseline umgeschrieben wird: was am
   Dienstag als "erhöht" angezeigt wurde, muss im Rückblick "erhöht"
   bleiben, sonst ist der Verlauf für die Praxis wertlos. */
async function saveDay(){
  // Der neue Tag muss Teil der Bewertungsgrundlage sein, bevor assess liest.
  const i = S.days.findIndex(d => d.key === S.dayKey);
  if (i >= 0) S.days[i] = S.day; else S.days.push(S.day);
  S.days.sort((a,b) => a.key.localeCompare(b.key));
  recompute();
  S.day.risk = S.risk.prob == null ? null : {
    modelVersion:S.modelVersion,
    level:      S.risk.level,
    prob:       Math.round(S.risk.prob * 1000) / 1000,
    raw:        Math.round(S.risk.raw  * 1000) / 1000,
    confidence: Math.round(S.risk.confidence * 100) / 100,
    drivers:    S.risk.drivers.slice(0,3).map(d => d.id)
  };
  S.day.updatedAt = new Date().toISOString();

  // Im Fenster halten, damit die nächste Berechnung den neuen Wert sieht
  const batch = writeBatch(db);
  batch.set(doc(db, "users", S.uid, "days", S.dayKey), S.day, { merge:true });
  /* Tageswert und Praxisübersicht gehören zusammen. Ein Batch verhindert,
     dass die Praxisliste nach einem Teilausfall einen alten Wert anzeigt. */
  if (S.profile?.doctorUid && viewingToday())
    batch.set(doc(db, "users", S.uid), { lastRisk:riskSummary() }, { merge:true });
  await batch.commit();
}

function riskSummary(){
  /* Die Stufe wird IMMER mitgeschrieben, auch ohne interne Kennzahl.
     Für die Praxis ist "Baseline im Aufbau" etwas anderes als "trägt
     nichts ein" — ohne die Stufe sähen beide gleich aus. */
  return {
    modelVersion:S.modelVersion,
    level:      S.risk?.level || "nodata",
    prob:       S.risk?.prob == null ? null : Math.round(S.risk.prob * 1000) / 1000,
    confidence: S.risk?.confidence == null ? null : Math.round(S.risk.confidence * 100) / 100,
    drivers:    (S.risk?.drivers || []).slice(0,3).map(d => d.id),
    date:       S.dayKey,
    at:         new Date().toISOString()
  };
}

async function pushRiskSummary(){
  await setDoc(doc(db, "users", S.uid), { lastRisk:riskSummary() }, { merge:true });
}

/* Werte in den angezeigten Tag schreiben und speichern. */
async function patchDay(patch){
  const previous = structuredClone(S.day);
  const existed = S.days.some(d => d.key === S.dayKey);
  Object.assign(S.day, patch);
  try { await saveDay(); }
  catch {
    S.day = previous;
    S.days = S.days.filter(d => d.key !== S.dayKey);
    if (existed) S.days.push(previous);
    S.days.sort((a,b) => a.key.localeCompare(b.key));
    recompute();
    toast("Speichern fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.");
    return false;
  }
  renderHome();
  return true;
}

/* ─────────────────  7. ONBOARDING  ─────────────────
   Sieben Schritte. Jeder liefert genau eine Entscheidung — lange
   Formulare schrecken bei einer Gesundheits-App besonders ab. */

const OB = [
  {
    eyebrow:"Schritt 1", title:"Deine Erkrankung",
    sub:"Danach richtet sich, welche Beschwerden die App täglich abfragt.",
    body: () => `<div class="tiles">${CONDITIONS.map(c =>
      tileHTML(c.id, c.n, c.s, "", S.draft.condition === c.id)).join("")}</div>
      ${S.draft.condition === "other" ? `
      <div class="field" style="margin-top:16px">
        <label for="ob-other">Bezeichnung</label>
        <input id="ob-other" type="text" placeholder="z. B. Sjögren-Syndrom"
               value="${esc(S.draft.conditionName || "")}">
      </div>` : ""}`,
    bind: () => {
      bindTiles(el => {
        S.draft.condition = el.dataset.id;
        // Betroffene Regionen an die Diagnose anpassen, solange der
        // Nutzer noch nichts eigenes gewählt hat
        if (!S.draft.jointsTouched)
          S.draft.joints = [...(CONDITIONS.find(c => c.id === el.dataset.id)?.joints || [])];
        renderOb();
      });
      const o = $("#ob-other");
      if (o) o.oninput = () => S.draft.conditionName = o.value;
    },
    valid: () => !!S.draft.condition
  },
  {
    eyebrow:"Schritt 2", title:"Betroffene Regionen",
    sub:"Wo machen sich Beschwerden bei dir am ehesten bemerkbar?",
    body: () => {
      const groups = [...new Set(JOINTS.map(j => j.g))];
      return groups.map(g => `
        <p class="group-label">${esc(g)}</p>
        <div class="chips">${JOINTS.filter(j => j.g === g).map(j =>
          `<button class="chip${S.draft.joints.includes(j.id) ? " sel" : ""}"
             data-id="${j.id}">${esc(j.n)}</button>`).join("")}</div>`).join("");
    },
    bind: () => $$(".chip").forEach(c => c.onclick = () => {
      const id = c.dataset.id;
      S.draft.jointsTouched = true;
      S.draft.joints = S.draft.joints.includes(id)
        ? S.draft.joints.filter(x => x !== id)
        : [...S.draft.joints, id];
      c.classList.toggle("sel");
    }),
    valid: () => true   // darf leer bleiben — nicht jede Erkrankung ist gelenkbezogen
  },
  {
    eyebrow:"Schritt 3", title:"Deine Medikamente",
    sub:"Wichtig für den Zusammenhang zwischen Einnahme und Verlauf.",
    body: () => {
      const groups = [...new Set(DRUGS.map(d => d.g))];
      return groups.map(g => `
        <p class="group-label">${esc(g)}</p>
        <div class="chips">${DRUGS.filter(d => d.g === g).map(d =>
          `<button class="chip${S.draft.drugs.includes(d.id) ? " sel" : ""}"
             data-id="${d.id}">${esc(d.n)}</button>`).join("")}</div>`).join("");
    },
    bind: () => $$(".chip").forEach(c => c.onclick = () => {
      const id = c.dataset.id;
      S.draft.drugs = S.draft.drugs.includes(id)
        ? S.draft.drugs.filter(x => x !== id)
        : [...S.draft.drugs, id];
      // Intervall vom zuerst gewählten Präparat übernehmen
      const first = DRUGS.find(d => d.id === S.draft.drugs[0]);
      if (first) S.draft.drugEvery = first.every;
      c.classList.toggle("sel");
    }),
    valid: () => true
  },
  {
    eyebrow:"Schritt 4", title:"Nächste Gabe",
    sub:"Damit die App weiß, wo im Behandlungszyklus du gerade stehst.",
    body: () => `
      <div class="field">
        <label for="ob-dose">Nächste Einnahme oder Injektion</label>
        <input id="ob-dose" type="date" value="${esc(S.draft.nextDose || "")}">
      </div>
      <div class="field">
        <label for="ob-every">Abstand in Tagen</label>
        <input id="ob-every" type="number" inputmode="numeric" min="1" max="365"
               value="${S.draft.drugEvery || 14}">
      </div>
      <p class="hint">Gegen Ende eines Intervalls lässt die Wirkung häufig nach.
         Fällt ein Risikoanstieg genau dorthin, ist das ein Hinweis, den die
         Praxis kennen sollte — etwa für eine Spiegelbestimmung.</p>`,
    bind: () => {
      $("#ob-dose").onchange  = e => S.draft.nextDose  = e.target.value;
      $("#ob-every").oninput  = e => S.draft.drugEvery = numOf(e.target.value) || 14;
    },
    valid: () => true
  },
  {
    eyebrow:"Schritt 5", title:"Dein Wearable",
    sub:"Welche Werte kann die App passiv von dir bekommen?",
    body: () => `<div class="tiles">${WEARABLES.map(w =>
      tileHTML(w.id, w.n, w.s, "", S.draft.wearable === w.id)).join("")}</div>
      <p class="hint">Apple Watch und Fitbit liefern die Werte über Apple Health
         beziehungsweise die Hersteller-App. Wie du sie automatisch an CLAM
         überträgst, steht später in den Einstellungen. Von Hand geht es immer.</p>`,
    bind: () => bindTiles(el => { S.draft.wearable = el.dataset.id; renderOb(); }),
    valid: () => !!S.draft.wearable
  },
  {
    eyebrow:"Schritt 6", title:"Deine Praxis",
    sub:"An diese Adresse geht eine Meldung — aber nur, wenn du sie bestätigst.",
    body: () => `
      <div class="field">
        <label for="ob-pname">Praxis oder behandelnde Person</label>
        <input id="ob-pname" type="text" placeholder="z. B. Rheumatologie Dr. Meier"
               value="${esc(S.draft.practice.name || "")}">
      </div>
      <div class="field">
        <label for="ob-pmail">E-Mail der Praxis</label>
        <input id="ob-pmail" type="email" placeholder="praxis@beispiel.de"
               value="${esc(S.draft.practice.mail || "")}">
      </div>
      <div class="field">
        <label for="ob-pphone">Telefon (optional)</label>
        <input id="ob-pphone" type="text" inputmode="tel" placeholder="030 123456"
               value="${esc(S.draft.practice.phone || "")}">
      </div>
      <p class="hint">Du kannst das auch überspringen und später eintragen.
         Ohne Praxisdaten erzeugt die App den Bericht trotzdem — du gibst ihn
         dann selbst weiter.</p>`,
    bind: () => {
      $("#ob-pname").oninput  = e => S.draft.practice.name  = e.target.value;
      $("#ob-pmail").oninput  = e => S.draft.practice.mail  = e.target.value;
      $("#ob-pphone").oninput = e => S.draft.practice.phone = e.target.value;
    },
    valid: () => true
  },
  {
    eyebrow:"Schritt 7", title:"Einwilligung",
    sub:"CLAM verarbeitet Gesundheitsdaten. Dafür brauchen wir dein Ja.",
    body: () => `
      <button class="consent${S.draft.consent ? " sel" : ""}" id="c-1">
        <span class="check">${ICON.check}</span>
        <span class="tx">Ich willige ein, dass CLAM meine Gesundheitsdaten
          — Beschwerden, Wearable-Werte, Fotos und Laborwerte — verarbeitet,
          um Veränderungen gegenüber meinen persönlichen Ausgangswerten zu erkennen (Art. 9 Abs. 2
          lit. a DSGVO). Ich kann die Einwilligung jederzeit widerrufen.</span>
      </button>
      <button class="consent${S.draft.consentShare ? " sel" : ""}" id="c-2">
        <span class="check">${ICON.check}</span>
        <span class="tx">Ich bin damit einverstanden, dass Fotos und Kennzahlen
          zur Auswertung an die Claude-API von Anthropic übermittelt werden
          (optional; jederzeit in den Einstellungen änderbar).</span>
      </button>
      <div class="disclaimer">
        ${ICON.info}
        <p>CLAM befindet sich in Entwicklung. Die Einstufung ist nicht klinisch
           validiert und stellt keine Diagnose. Bei akuten Beschwerden wende dich
           direkt an deine Praxis oder an medizinische Notfallhilfe.</p>
      </div>
      <p class="hint" style="margin-top:14px">
        <a href="#" id="ob-legal-p">Datenschutz</a> ·
        <a href="#" id="ob-legal-t">Nutzungsbedingungen</a></p>`,
    bind: () => {
      $("#c-1").onclick = () => { S.draft.consent = !S.draft.consent; renderOb(); };
      $("#c-2").onclick = () => { S.draft.consentShare = !S.draft.consentShare; renderOb(); };
      $("#ob-legal-p").onclick = e => { e.preventDefault(); openLegal("privacy"); };
      $("#ob-legal-t").onclick = e => { e.preventDefault(); openLegal("terms"); };
    },
    valid: () => S.draft.consent
  }
];

function tileHTML(id, ttl, sub, val, sel){
  return `<button class="tile${sel ? " sel" : ""}" data-id="${id}">
    <span class="t-txt"><span class="t-ttl">${esc(ttl)}</span>
    ${sub ? `<span class="t-sub">${esc(sub)}</span>` : ""}</span>
    ${val ? `<span class="t-val">${esc(val)}</span>` : ""}
    <span class="check">${ICON.check}</span></button>`;
}
function bindTiles(fn){
  $$(".tile").forEach(el => el.onclick = () => fn(el));
}

function renderOb(){
  const step = OB[S.obStep];
  $("#ob-steps").innerHTML = OB.map((_, i) =>
    `<i class="${i <= S.obStep ? "done" : ""}"></i>`).join("");
  $("#ob-eyebrow").textContent = step.eyebrow;
  $("#ob-title").textContent   = step.title;
  $("#ob-sub").textContent     = step.sub;
  $("#ob-body").innerHTML      = step.body();
  step.bind?.();
  $("#ob-next").textContent = S.obStep === OB.length - 1 ? "Los geht's" : "Weiter";
  $("#ob-next").disabled    = !step.valid();
  $("#ob-back").style.visibility = S.obStep ? "visible" : "hidden";
}

$("#ob-back").onclick = () => { if (S.obStep){ S.obStep--; renderOb(); } };
$("#ob-next").onclick = async () => {
  if (!OB[S.obStep].valid()) return;
  if (S.obStep < OB.length - 1){ S.obStep++; renderOb(); return; }

  $("#ob-next").disabled = true;
  S.profile = {
    ...S.draft,
    onboarded:true,
    createdAt:new Date().toISOString(),
    // Zeitpunkt der Einwilligung festhalten — bei Gesundheitsdaten muss
    // nachweisbar sein, wann und worin eingewilligt wurde
    consentAt:new Date().toISOString(),
    aiConsentAt:S.draft.consentShare ? new Date().toISOString() : null
  };
  delete S.profile.jointsTouched;
  try {
    await saveProfile();
    await loadWindow();
    await openDay(todayKey());
    screen("s-home");
    setTimeout(() => openCheckin(), 700);
  } catch {
    $("#ob-next").disabled = false;
    toast("Speichern fehlgeschlagen. Prüfe deine Verbindung.");
  }
};

/* ─────────────────  8. HOME  ───────────────── */

$("#h-settings").onclick = openSettings;
$("#h-history").onclick  = openHistory;
$("#h-date").onclick     = openDayPicker;
$("#a-checkin").onclick  = openCheckin;
$("#a-vitals").onclick   = openVitals;
$("#a-photo").onclick    = openPhoto;

/* Ring-Geometrie. r wird auch im SVG als Attribut gesetzt. */
const RING_R = 84;
const RING_C = 2 * Math.PI * RING_R;

function renderHome(){
  const r = S.risk;
  const lvl = r?.level || "nodata";
  const conf = LEVELS[lvl];

  $("#h-date").innerHTML = `${esc(dayLabel(S.dayKey))} ${ICON.down}`;
  $("#h-date").classList.toggle("past", !viewingToday());

  /* Ring: der Bogen füllt sich proportional zur internen Kennzahl.
     Ohne Wert bleibt nur die Spur stehen. */
  const p = r?.prob ?? 0;
  const off = RING_C * (1 - p);

  const txt = LEVEL_TEXT[lvl];
  const mid = lvl === "building"
    ? `<span class="cap">Baseline</span>
       <span class="lvl" style="font-size:26px;color:${conf.color}">${r.baselineDays}/${GATES.minBaselineDays}</span>
       <span class="pct">Tage erfasst</span>`
    : lvl === "unsupported"
    ? `<span class="cap">Veränderung</span>
       <span class="lvl" style="font-size:23px;color:${conf.color}">Nicht bewertet</span>`
    : lvl === "nodata"
    ? `<span class="cap">Veränderung</span>
       <span class="lvl" style="font-size:24px;color:${conf.color}">Keine Daten</span>`
    : `<span class="cap">Veränderung</span>
       <span class="lvl" style="color:${conf.color}">${txt.t}</span>
       <span class="pct">gegenüber deiner Baseline</span>`;

  let html = `
    <div class="ring-wrap">
      <div class="ring">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="glowring" cx="100" cy="100" r="${RING_R}" stroke="${conf.ring}"
            stroke-dasharray="${RING_C}" stroke-dashoffset="${off}"/>
          <circle class="trace" cx="100" cy="100" r="${RING_R}"/>
          <circle class="arc" cx="100" cy="100" r="${RING_R}" stroke="${conf.ring}"
            stroke-dasharray="${RING_C}" stroke-dashoffset="${off}"/>
        </svg>
        <div class="mid">${mid}</div>
      </div>
    </div>
    <p class="hero-note">${heroNote(r)}</p>`;


  if (r && r.prob != null){
    html += `<p class="hint" style="text-align:center">Grundlage: ${r.baselineDays} Vergleichstage.</p>`;
  }

  /* Handlungsaufforderung. Der eigentliche Zweck der App: aus einem
     Messwert eine Handlung machen. */
  html += ctaHTML(r);
  if (S.day?.followUp?.urgent){
    html += `<div class="flag"><span class="dot"></span><span class="tx">
      <b>Bitte sofort ärztlich abklären</b>${esc(S.day.followUp.urgent)}</span></div>`;
  }
  if (S.profile?.condition !== "ra"){
    html += `<div class="disclaimer">${ICON.info}<p>Für diese Erkrankung ist die
      Einstufung nicht geprüft. Besonders neurologische, Darm- und Hautsymptome
      fließen nicht vollständig ein. Verlasse dich bei einer Verschlechterung
      nicht auf „Niedrig“, sondern kontaktiere deine behandelnde Praxis.</p></div>`;
  }

  /* Signalkarten. Nur, was das gewählte Wearable liefern kann plus die
     Patienteneingaben — sonst stünden dauerhaft leere Karten da. */
  const tiles = sigTiles(r);
  html += `<div class="sig-list">${tiles.html}</div>`;
  if (tiles.missing) html += `<p class="sig-hint">${
    tiles.missing === 1 ? "Eine Kennzahl fehlt noch" : `${tiles.missing} Kennzahlen fehlen noch`
  } — tippe die Karte an, um sie einzutragen.</p>`;

  html += `
    <div class="disclaimer">
      ${ICON.info}
      <p>Hinweis, keine Diagnose. Die Berechnung beruht auf deinen persönlichen
         Verlaufsdaten und auf Hypothesen aus der Forschung — es gibt keine
         validierten Grenzwerte. Ein niedriges Risiko schließt einen Schub
         nicht aus.</p>
    </div>`;

  $("#h-hero").innerHTML = html;

  /* Bewertung antippbar: öffnet die Aufschlüsselung. */
  const ring = $(".ring", $("#h-hero"));
  if (ring && r && r.prob != null) ring.onclick = openRiskDetail;

  $$(".sig-item", $("#h-hero")).forEach(el => el.onclick = () => {
    const id = el.dataset.id;
    if (SIGNALS[id]?.src === "pro") openCheckin(); else openVitals();
  });
  const cta = $(".cta", $("#h-hero"));
  if (cta) cta.onclick = () => {
    if (cta.dataset.act === "followup") openFollowUp();
    else if (cta.dataset.act === "report") openReport();
    else openCheckin();
  };

  /* Beschriftung der Hauptaktion: erst nach dem Tages-Check ist der Tag
     wirklich erfasst. */
  const done = CHECKS.some(c => Number.isFinite(S.day?.[c.id]));
  $("#a-checkin-t").textContent = done ? "Tages-Check anpassen" : "Tages-Check";
}

/* Ein Satz, der die Zahl in Sprache übersetzt. */
function heroNote(r){
  if (!r) return "";
  if (r.level === "building"){
    const n = r.needed;
    return `Noch <b>${n} ${n === 1 ? "Tag" : "Tage"}</b>, dann kennt CLAM dein
            Normal gut genug für eine Risikoeinschätzung. Trage weiter täglich
            deine Werte ein.`;
  }
  if (r.level === "nodata")
    return `Für ${dayLabel(S.dayKey).toLowerCase()} liegen noch keine Werte vor.
            Trag deinen Tages-Check ein.`;

  const top = r.drivers.slice(0,2);
  if (!top.length) return `Alle erfassten Werte liegen im Bereich deiner
    persönlichen Baseline der letzten ${GATES.baselineDays} Tage.`;

  const list = top.map(d => `<b>${esc(SIGNALS[d.id].label)} ${deltaText(d.id, d)}</b>`);
  const joined = list.length === 2 ? `${list[0]} und ${list[1]}` : list[0];
  return r.level === "high"
    ? `${joined} gegenüber deiner Baseline. So eine Kombination hattest du
       zuletzt selten — das gehört abgeklärt.`
    : `${joined} gegenüber deiner Baseline. Behalte das im Auge.`;
}

/* Die Handlungsaufforderung hängt davon ab, wie weit der Loop schon
   gelaufen ist: erst nachfragen, dann melden. */
function ctaHTML(r){
  if (!r || r.prob == null || r.level === "low") return "";

  const asked = !!S.day?.followUp;
  const saved = S.day?.reportSaved || S.day?.reported;

  if (saved) return `
    <div class="flag" style="margin-top:20px">
      <span class="dot"></span>
      <span class="tx"><b>Bericht gespeichert</b>
        Bitte gib ihn selbst an deine Praxis weiter. CLAM hat ihn nicht versendet.</span>
    </div>`;

  if (!asked) return `
    <button class="cta ${r.level}" data-act="followup">
      <span class="ic">${ICON.alert}</span>
      <span class="tx"><b>Ein paar gezielte Fragen</b>
        <span>Einige Fragen zu deinen Symptomen helfen dir, die Beobachtungen
              für ein Gespräch mit deiner Praxis zu dokumentieren.</span></span>
      ${ICON.chev}
    </button>`;

  return `
    <button class="cta ${r.level}" data-act="report">
      <span class="ic">${ICON.send}</span>
      <span class="tx"><b>Bericht für die Praxis erstellen</b>
        <span>Du kannst ihn speichern und anschließend selbst weitergeben.</span></span>
      ${ICON.chev}
    </button>`;
}

/* Eine Karte je Kennzahl, rein typografisch: links der Name, rechts der
   Messwert und darunter die Abweichung zur Baseline.

   Bewusst ohne Symbole. Ein Piktogramm neben jedem Namen erklärt nichts,
   was der Name nicht schon sagt, und neun bunte Kacheln nebeneinander
   nehmen den Werten die Ruhe. Ohne sie steht links eine saubere
   Namensspalte und rechts eine Zahlenspalte — die Lesart eines Befunds.

   Bewusst kein "eintragen" unter jeder leeren Karte: neunmal dieselbe
   Aufforderung liest sich wie ein Mängelprotokoll. Ein einzelner Hinweis
   unter den Karten sagt, wie viele fehlen und was zu tun ist.

   Und bewusst untereinander statt in einem 3-Spalten-Raster: ein Gitter
   wird ungleich hoch, sobald ein Name umbricht ("Morgensteifigkeit") und
   der daneben nicht ("HRV") — CSS Grid streckt die ganze Reihe auf die
   höchste Zelle, darunter bleibt bei den kurzen Namen Luft. */
function sigTiles(r){
  const wear = WEARABLES.find(w => w.id === S.profile?.wearable);
  const cond = CONDITIONS.find(c => c.id === S.profile?.condition);
  const ids = [
    ...(wear?.signals || []),
    ...(cond?.pro || []).filter(id => SIGNALS[id])
  ];

  let missing = 0;
  const html = ids.map(id => {
    const S_ = SIGNALS[id];
    const v = S.day?.[id];
    const s = r?.signals?.[id];

    /* Fehlt ein Wert, steht dort nur ein Strich. */
    if (!Number.isFinite(v)){
      missing++;
      return `
        <div class="sig-item miss" data-id="${id}">
          <span class="nm">${esc(S_.label)}</span>
          <span class="rd"><b class="val none">—</b></span>
        </div>`;
    }

    const shown = id === "steps" ? num(v)
                : id === "temp"  ? v.toFixed(2).replace(".", ",")
                : id === "sleep" ? dec1(v)
                : Math.round(v);
    const unit = S_.unit && !S_.unit.startsWith("/") && id !== "steps"
      ? ` <em>${esc(S_.unit)}</em>` : "";
    const hot = s?.active;
    /* Ohne Baseline gibt es noch keine Abweichung. Dann steht nur der
       Wert da, kein Strich — der sähe aus wie eine Messung von null. */
    return `
      <div class="sig-item${hot ? " hot" : ""}" data-id="${id}">
        <span class="nm">${esc(S_.label)}</span>
        <span class="rd">
          <b class="val">${shown}${unit}</b>
          ${s ? `<span class="dl${hot ? " up" : ""}">${deltaText(id, s)}</span>` : ""}
        </span>
      </div>`;
  }).join("");

  return { html, missing };
}

/* ─────────────────  9. SHEET-SYSTEM  ───────────────── */

function openSheet(title, body, foot = ""){
  $("#sheet-title").textContent = title;
  $("#sheet-body").innerHTML = body;
  $("#sheet-foot").innerHTML = foot;
  $("#sheet-wrap").classList.add("on");
  $("#sheet-body").scrollTop = 0;
}
function closeSheet(){ $("#sheet-wrap").classList.remove("on"); }
$("#scrim").onclick  = closeSheet;
$("#sheet-x").onclick = closeSheet;

/* ─────────────────  10. TAGES-CHECK  ─────────────────
   Nur die Fragen, die zur Diagnose passen. Vorbelegt mit dem, was für
   heute schon eingetragen ist — Korrigieren muss so leicht sein wie
   Eintragen, sonst werden falsche Werte nicht mehr angefasst. */

function openCheckin(){
  const cond = CONDITIONS.find(c => c.id === S.profile.condition) || CONDITIONS[0];
  const list = CHECKS.filter(c => cond.pro.includes(c.id));
  const d = { ...S.day };

  const body = list.map(c => {
    if (c.kind === "scale"){
      const v = d[c.id];
      return `
        <div class="scale" data-kind="scale" data-id="${c.id}">
          <div class="scale-head">
            <b>${esc(c.n)}</b>
            <span class="v ${Number.isFinite(v) ? "" : "none"}">${Number.isFinite(v) ? v : "—"}</span>
          </div>
          <div class="scale-nums">${Array.from({length:11}, (_, i) =>
            `<button data-v="${i}" class="${v === i ? "on" : ""}">${i}</button>`).join("")}</div>
          <div class="scale-ends"><span>0 · ${esc(c.lo)}</span><span>10 · ${esc(c.hi)}</span></div>
        </div>`;
    }
    if (c.kind === "minutes"){
      const v = d[c.id];
      return `
        <div class="scale" data-kind="stiff" data-id="${c.id}">
          <div class="scale-head"><b>${esc(c.n)}</b></div>
          <p class="hint" style="margin:0 2px 10px">${esc(c.hint)}</p>
          <div class="chips">${STIFF_STEPS.map(s =>
            `<button class="chip${v === s.v ? " sel" : ""}" data-v="${s.v}">${esc(s.n)}</button>`).join("")}</div>
        </div>`;
    }
    // count
    return `
      <div class="scale" data-kind="count" data-id="${c.id}">
        <div class="scale-head"><b>${esc(c.n)}</b></div>
        <p class="hint" style="margin:0 2px 10px">${esc(c.hint)}</p>
        <input type="number" inputmode="numeric" min="0" max="60" id="cnt-${c.id}"
               value="${Number.isFinite(d[c.id]) ? d[c.id] : ""}" placeholder="Anzahl">
      </div>`;
  }).join("") + medicationBlock(d);

  openSheet(`Tages-Check · ${dayLabel(S.dayKey)}`, body,
    `<button class="btn btn-primary" id="ck-save">Speichern</button>`);

  /* Skalen */
  $$('[data-kind="scale"]', $("#sheet-body")).forEach(box => {
    $$("button", box).forEach(b => b.onclick = () => {
      const v = Number(b.dataset.v);
      d[box.dataset.id] = v;
      $$("button", box).forEach(x => x.classList.toggle("on", x === b));
      const out = $(".v", box);
      out.textContent = v; out.classList.remove("none");
    });
  });
  /* Morgensteifigkeit */
  $$('[data-kind="stiff"]', $("#sheet-body")).forEach(box => {
    $$(".chip", box).forEach(b => b.onclick = () => {
      d[box.dataset.id] = Number(b.dataset.v);
      $$(".chip", box).forEach(x => x.classList.toggle("sel", x === b));
    });
  });
  /* Zähler */
  $$('[data-kind="count"]', $("#sheet-body")).forEach(box => {
    $("input", box).oninput = e => d[box.dataset.id] = numOf(e.target.value);
  });
  /* Medikament */
  $$("[data-med]", $("#sheet-body")).forEach(b => b.onclick = () => {
    const v = b.dataset.med;
    d.medTaken = v;
    // "vergessen" zählt als ausgelassene Dosis und geht in den Score ein
    d.missedDoses = v === "missed" ? 1 : 0;
    $$("[data-med]").forEach(x => x.classList.toggle("on", x === b));
  });

  $("#ck-save").onclick = async () => {
    $("#ck-save").disabled = true;
    const patch = { checkedAt: new Date().toISOString() };
    for (const c of list) if (Number.isFinite(d[c.id])) patch[c.id] = d[c.id];
    if (d.medTaken) { patch.medTaken = d.medTaken; patch.missedDoses = d.missedDoses || 0; }
    if (!await patchDay(patch)){
      $("#ck-save").disabled = false;
      return;
    }
    closeSheet();
    toast("Tages-Check gespeichert.");
    // Ist das Risiko dadurch gestiegen, direkt weiterführen — der Loop
    // soll nicht daran scheitern, dass der Nutzer die Kachel übersieht.
    if (S.risk.prob != null && S.risk.level !== "low" && !S.day.followUp)
      setTimeout(openFollowUp, 900);
  };
}

function medicationBlock(d){
  if (!S.profile.drugs?.length) return "";
  const names = S.profile.drugs.map(id => DRUGS.find(x => x.id === id)?.n).filter(Boolean);
  return `
    <div class="scale">
      <div class="scale-head"><b>Medikament genommen</b></div>
      <p class="hint" style="margin:0 2px 10px">${esc(names.join(", "))}</p>
      <div class="yesno">
        <button data-med="yes"  class="${d.medTaken === "yes"  ? "on" : ""}">Ja</button>
        <button data-med="na"   class="${d.medTaken === "na"   ? "on" : ""}">Heute nicht fällig</button>
        <button data-med="missed" class="${d.medTaken === "missed" ? "on" : ""}">Vergessen</button>
      </div>
    </div>`;
}

/* ─────────────────  11. VITALWERTE  ─────────────────
   Von Hand. Der automatische Weg (Apple Kurzbefehle) steht in den
   Einstellungen — hier wäre er nur im Weg. */

function openVitals(){
  const wear = WEARABLES.find(w => w.id === S.profile.wearable);
  const ids = wear?.signals?.length ? wear.signals : VITALS.map(v => v.id);
  const list = VITALS.filter(v => ids.includes(v.id));
  const d = {};

  const body = `
    <p class="hint" style="margin:0 2px 16px">Werte von ${esc(dayLabel(S.dayKey).toLowerCase())}.
       Ruhepuls, HRV und Temperatur misst deine Uhr meist nachts — nimm die
       Tageswerte aus der Health- oder Hersteller-App.</p>
    ${list.map(v => `
      <div class="field">
        <label for="vt-${v.id}">${esc(v.n)}${v.unit ? ` <span style="color:var(--ink-3)">· ${esc(v.unit)}</span>` : ""}</label>
        <input id="vt-${v.id}" type="number" inputmode="decimal" step="${v.step}"
               min="${v.min}" max="${v.max}" placeholder="${esc(v.ph)}"
               value="${Number.isFinite(S.day?.[v.id]) ? S.day[v.id] : ""}">
      </div>`).join("")}
    <div class="shot-guide">
      ${ICON.info}
      <div>Einmal eingerichtet, füllt sich das von allein: In den Einstellungen
        findest du unter <b>Automatische Übernahme</b> die Anleitung für einen
        Apple-Kurzbefehl, der die Werte jeden Morgen überträgt.</div>
    </div>`;

  openSheet(`Vitaldaten · ${dayLabel(S.dayKey)}`, body,
    `<button class="btn btn-primary" id="vt-save">Speichern</button>`);

  list.forEach(v => $(`#vt-${v.id}`).oninput = e => d[v.id] = numOf(e.target.value));

  $("#vt-save").onclick = async () => {
    $("#vt-save").disabled = true;
    const patch = {};
    for (const v of list){
      const val = d[v.id];
      if (val == null) continue;
      // Tippfehler abfangen: ein Ruhepuls von 620 ist keine Messung
      if (val < v.min || val > v.max){
        toast(`${v.n}: ${dec1(val)} liegt außerhalb des plausiblen Bereichs.`);
        $("#vt-save").disabled = false;
        return;
      }
      patch[v.id] = val;
    }
    if (!Object.keys(patch).length){ closeSheet(); return; }
    patch.vitalsSource = "manual";
    if (!await patchDay(patch)){
      $("#vt-save").disabled = false;
      return;
    }
    closeSheet();
    toast("Vitaldaten gespeichert.");
  };
}

/* ─────────────────  12. FOTO  ─────────────────
   Standardisiert heißt: gleicher Abstand, gleiches Licht, gleiche
   Haltung. Ohne das sind zwei Bilder nicht vergleichbar, und genau die
   Vergleichbarkeit ist der Zweck. Deshalb steht die Anleitung über der
   Kamera, nicht in einem Hilfetext. */

let photoData = null, photoMime = "image/jpeg";

function openPhoto(){
  if (DEMO_MODE){
    openSheet("Fotodokumentation", `<p class="sub">Im Echtbetrieb können Aufnahmen als
      Verlauf dokumentiert und nach Einwilligung beschrieben werden.</p>
      <p class="note">Die Jury-Demo verwendet ausschließlich synthetische Daten.
      Kamera, Upload und Live-KI sind hier nicht angebunden.</p>`);
    return;
  }
  if (!S.profile.consentShare){
    openSheet("Foto dokumentieren", `<p class="note">Die Bildauswertung benötigt deine
      Einwilligung zur KI-Auswertung. Du kannst sie in den Einstellungen aktivieren.</p>`);
    return;
  }
  photoData = null;
  const cond = CONDITIONS.find(c => c.id === S.profile.condition);
  const regions = (S.profile.joints || []).map(id => JOINTS.find(j => j.id === id)).filter(Boolean);
  const prev = lastPhoto();

  const body = `
    <div class="field">
      <label for="ph-region">Körperstelle</label>
      <select id="ph-region">
        ${regions.length
          ? regions.map(j => `<option value="${j.id}">${esc(j.n)}</option>`).join("")
          : JOINTS.map(j => `<option value="${j.id}">${esc(j.n)}</option>`).join("")}
      </select>
    </div>

    <button class="shot" id="ph-shot">
      <div class="drop" id="ph-drop">
        ${ICON.cam}
        <b>Foto aufnehmen</b>
        <small>Kamera öffnen oder Bild aus der Galerie wählen</small>
      </div>
      <img class="preview" id="ph-prev" alt="" hidden>
      <span class="swap" id="ph-swap" hidden>${ICON.cam} Anderes Bild</span>
    </button>
    <input type="file" id="ph-file" accept="image/*" capture="environment" hidden>

    <div class="shot-guide">
      ${ICON.info}
      <div><b>Damit die Bilder vergleichbar sind:</b> Tageslicht, heller
        neutraler Hintergrund, Hand flach und entspannt, Abstand rund 30 cm,
        immer von oben. ${prev ? "Halte dich an die Aufnahme von " + esc(dayLabel(prev.key)) + "." : "Merk dir die Haltung für das nächste Mal."}</div>
    </div>

    ${prev ? `
      <p class="group-label" style="margin-top:22px">Letzte Aufnahme</p>
      <div class="hist-item">
        <img class="res-thumb" id="ph-last" alt="" style="width:44px;height:44px;background:var(--blue-100)">
        <span class="tx"><b>${esc(JOINTS.find(j => j.id === prev.region)?.n || prev.region)}</b>
          <span>${esc(longDate(prev.key))}</span></span>
      </div>` : ""}

    <div id="ph-out"></div>`;

  openSheet("Foto dokumentieren", body,
    `<button class="btn btn-primary" id="ph-go" disabled>Auswerten</button>`);

  /* Vorschaubild der letzten Aufnahme nachladen. Bewusst ohne await —
     das Sheet soll sofort bedienbar sein. */
  if (prev) loadPhotoImage(prev.id).then(src => {
    const el = $("#ph-last");
    if (el && src) el.src = src;
  });

  $("#ph-shot").onclick = () => $("#ph-file").click();
  $("#ph-file").onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const { data, mime, url } = await compress(f);
    photoData = data; photoMime = mime;
    $("#ph-prev").src = url;
    $("#ph-prev").hidden = false;
    $("#ph-drop").hidden = true;
    $("#ph-swap").hidden = false;
    $("#ph-shot").classList.add("has");
    $("#ph-go").disabled = false;
  };
  $("#ph-go").onclick = analyzePhoto;
}

/* Metadaten der letzten Aufnahme. Das Bild selbst liegt in einem
   eigenen Dokument und wird erst geholt, wenn es angezeigt wird —
   sonst zöge jeder Seitenaufbau alle Fotos mit. */
function lastPhoto(){
  for (let i = S.days.length - 1; i >= 0; i--){
    const ph = S.days[i].photos;
    if (ph?.length) return { ...ph[ph.length - 1], key:S.days[i].key };
  }
  return null;
}

async function loadPhotoImage(id){
  try {
    const snap = await getDoc(doc(db, "users", S.uid, "photos", id));
    if (!snap.exists()) return null;
    const d = snap.data();
    return `data:${d.mime || "image/jpeg"};base64,${d.data}`;
  } catch { return null; }
}

/* Bild verkleinern, bis es sicher in ein Firestore-Dokument passt.

   Ein Dokument fasst 1 MiB. Base64 bläht die Bytes um ein Drittel auf,
   deshalb ist das Budget bewusst niedrig angesetzt — lieber ein etwas
   weicheres Bild als ein Speichern, das beim Arzttermin scheitert.

   Erst wird die Qualität gesenkt, dann die Kantenlänge: Kompression
   kostet weniger Erkennbarkeit als Auflösung, und für die Beurteilung
   einer Schwellung zählt die Kantenschärfe mehr als die Politur. */
const PHOTO_BUDGET = 420 * 1024;   // Base64-Zeichen, ~0,4 MiB

function compress(file){
  const steps = [
    { max:1280, q:0.80 },
    { max:1280, q:0.65 },
    { max:1024, q:0.62 },
    { max: 900, q:0.55 },
    { max: 720, q:0.50 }
  ];
  return new Promise((res, rej) => {
    const img = new Image();
    img.onerror = () => rej(new Error("Bild konnte nicht gelesen werden."));
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      let out = null;
      for (const st of steps){
        const scale = Math.min(1, st.max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width  = Math.round(img.width  * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext("2d");
        // Weißer Grund: PNG mit Transparenz würde sonst schwarz werden
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/jpeg", st.q);
        out = { data:url.split(",")[1], mime:"image/jpeg", url };
        if (out.data.length <= PHOTO_BUDGET) break;
      }
      res(out);
    };
    img.src = URL.createObjectURL(file);
  });
}

async function analyzePhoto(){
  const region = $("#ph-region").value;
  const regionName = JOINTS.find(j => j.id === region)?.n || region;
  $("#ph-go").disabled = true;
  $("#ph-out").innerHTML = `<div class="analyzing"><span class="spin"></span>
    Bild wird ausgewertet …</div>`;

  const prev = lastPhoto();
  try {
    const res = await apiPost(API.photo, {
        image: photoData, mime: photoMime,
        region: regionName,
        condition: CONDITIONS.find(c => c.id === S.profile.condition)?.n,
        // Der Vorbefund gibt Claude einen Vergleichspunkt. Ohne ihn wäre
        // jede Auswertung ein Einzelbild ohne Verlauf.
        previous: prev ? { date: prev.key, findings: prev.findings || null } : null
      });
    const d = await res.json();
    if (!res.ok) throw new Error(d.message || "Auswertung fehlgeschlagen");
    showPhotoResult(d, region, regionName);
  } catch(e){
    $("#ph-out").innerHTML = `<p class="note" style="color:var(--bad)">
      ${esc(e.message || "Die Auswertung hat nicht geklappt.")}</p>`;
    $("#ph-go").disabled = false;
  }
}

function showPhotoResult(d, region, regionName){
  $("#ph-out").innerHTML = `
    <div style="margin-top:16px">
      <div class="res-head">
        <img class="res-thumb" src="data:${photoMime};base64,${photoData}" alt="">
        <span class="tx"><b>${esc(regionName)}</b>
          <span>Sichtbefund · ${esc(d.confidence || "mittel")}e Sicherheit</span></span>
      </div>
      <div class="glass res-list">
        ${(d.findings || []).map(f => `
          <div class="res-row"><span>${esc(f.feature)}</span>
            <b>${esc(f.value)}</b></div>`).join("")}
        ${d.change ? `<div class="res-row"><span>Vergleich zur letzten Aufnahme</span>
          <b>${esc(d.change)}</b></div>` : ""}
      </div>
      <p class="note">${esc(d.note || "")}</p>
      <div class="disclaimer">
        ${ICON.info}
        <p>Beschreibung des Sichtbaren, keine Beurteilung. Ob dahinter eine
           entzündliche Aktivität steckt, kann nur eine ärztliche Untersuchung
           klären.</p>
      </div>
    </div>`;

  $("#sheet-foot").innerHTML = `<button class="btn btn-primary" id="ph-save">Zum Tag speichern</button>`;
  $("#ph-save").onclick = async () => {
    $("#ph-save").disabled = true;
    try {
      /* Bild in ein eigenes Dokument, nur die Metadaten an den Tag.
         Getrennt, weil das Tagesdokument bei jedem Start geladen wird —
         mit eingebetteten Bildern wäre das nach ein paar Wochen zäh. */
      const id = crypto.randomUUID();
      await setDoc(doc(db, "users", S.uid, "photos", id), {
        data: photoData, mime: photoMime,
        dayKey: S.dayKey, region, at: new Date().toISOString()
      });

      const photos = [...(S.day.photos || []), {
        id, region, at: clock(),
        findings: d.findings || [], change: d.change || null,
        note: d.note || "", confidence: d.confidence || null
      }];
      if (!await patchDay({ photos })){
        try { await deleteDoc(doc(db, "users", S.uid, "photos", id)); }
        catch { /* beim nächsten Kontolöschen bleibt das Bild auffindbar */ }
        $("#ph-save").disabled = false;
        return;
      }
      closeSheet();
      toast("Foto gespeichert.");
    } catch(e){
      $("#ph-save").disabled = false;
      /* Der häufigste Fall ist ein zu großes Dokument. Das sagt die
         Meldung, statt pauschal auf die Verbindung zu zeigen. */
      toast(String(e?.message || "").includes("longer than")
        ? "Das Bild ist zu groß zum Speichern. Bitte erneut aufnehmen."
        : "Speichern fehlgeschlagen. Prüfe deine Verbindung.");
    }
  };
}

/* ─────────────────  13. RISIKO-AUFSCHLÜSSELUNG  ─────────────────
   Eine Zahl ohne Begründung erzeugt bei einer chronischen Erkrankung
   nur Angst. Deshalb ist jederzeit einsehbar, welches Signal wie viel
   beigetragen hat — und woran die App das misst. */

function openRiskDetail(){
  const r = S.risk;
  if (!r || r.prob == null) return;

  const drivers = r.drivers;
  const quiet = SIGNAL_IDS
    .filter(id => r.signals[id] && !r.signals[id].active)
    .map(id => r.signals[id]);

  const body = `
    <div class="glass card" style="margin-bottom:18px">
      <p class="eyebrow">Bewertung ${esc(dayLabel(S.dayKey))}</p>
      <h2 style="color:${LEVELS[r.level].color};margin-top:6px">
        ${LEVEL_TEXT[r.level].t}</h2>
      <p class="sub">${LEVEL_TEXT[r.level].s}</p>
    </div>

    ${drivers.length ? `
      <p class="group-label">Was den Wert treibt</p>
      <div class="glass drv">
        ${drivers.map(d => `
          <div class="drv-item">
            <span class="tx">
              <b>${esc(SIGNALS[d.id].label)}</b>
              <span>Baseline ${fmtVal(d.id, d.baseline)} · aktuell ${fmtVal(d.id, d.value)}</span>
              <span class="drv-bar"><span style="width:${Math.round(d.share * 100)}%"></span></span>
            </span>
            <span class="val">${deltaText(d.id, d)}</span>
          </div>`).join("")}
      </div>` : `
      <div class="glass card"><p class="sub">Kein Signal weicht deutlich von
        deiner Baseline ab.</p></div>`}

    ${quiet.length ? `
      <p class="group-label">Unauffällig</p>
      <div class="glass drv">
        ${quiet.map(d => `
          <div class="drv-item">
            <span class="tx"><b>${esc(SIGNALS[d.id].label)}</b>
              <span>Baseline ${fmtVal(d.id, d.baseline)} · aktuell ${fmtVal(d.id, d.value)}</span></span>
            <span class="val" style="color:var(--good)">${deltaText(d.id, d)}</span>
          </div>`).join("")}
      </div>` : ""}

    <p class="group-label">Wie CLAM rechnet</p>
    <div class="glass card">
      <p class="sub" style="font-size:14px">
        Grundlage ist deine eigene Baseline: Median und Streuung deiner Werte
        über ${GATES.baselineDays} Tage, endend ${GATES.baselineLag} Tage vor
        dem bewerteten Tag. Der Versatz verhindert, dass ein beginnender Schub
        seine eigene Vergleichsgrundlage anhebt und sich dadurch versteckt.</p>
      <p class="sub" style="font-size:14px;margin-top:10px">
        Ein Signal zählt erst, wenn es zugleich statistisch auffällig <em>und</em>
        absolut relevant ist — ein halber Schlag mehr Ruhepuls bleibt außen vor,
        auch wenn deine Werte sonst extrem gleichmäßig sind.</p>
      <p class="sub" style="font-size:14px;margin-top:10px">
        Diese Bewertung nutzt ${Object.keys(r.signals).length} Kennzahlen und ${r.baselineDays} Vergleichstage. Die Stufen sind nicht klinisch validiert.</p>
    </div>

    <div class="disclaimer">
      ${ICON.info}
      <p>Die Gewichte beruhen auf Beobachtungsstudien zu Wearables bei
         entzündlich-rheumatischen Erkrankungen. Die Richtung der Signale ist
         belegt, die genauen Grenzwerte sind Hypothesen. Validierte Cut-offs
         gibt es bislang nicht.</p>
    </div>`;

  openSheet("Aufschlüsselung", body,
    r.level !== "low" && !S.day.followUp
      ? `<button class="btn btn-primary" id="rd-next">Gezielte Fragen beantworten</button>`
      : "");
  const b = $("#rd-next");
  if (b) b.onclick = () => { closeSheet(); setTimeout(openFollowUp, 260); };
}

function fmtVal(id, v){
  if (!Number.isFinite(v)) return "—";
  const S_ = SIGNALS[id];
  if (id === "steps") return num(v);
  if (id === "temp")  return `${v.toFixed(2).replace(".", ",")} ${S_.unit}`;
  if (id === "sleep") return `${dec1(v)} ${S_.unit}`;
  return `${Math.round(v)}${S_.unit.startsWith("/") ? S_.unit : " " + S_.unit}`;
}

/* ─────────────────  14. GEZIELTE NACHFRAGEN  ─────────────────
   Der Schritt, der aus einem Messwert einen Verdacht macht. Die Fragen
   kommen von Claude und richten sich nach dem, was den Score treibt:
   bei erhöhtem Ruhepuls ist die Infektfrage wichtig, bei Morgensteifig-
   keit die nach der Verteilung der Gelenke. */

async function openFollowUp(){
  openSheet("Gezielte Fragen", `<div class="analyzing"><span class="spin"></span>
    Fragen werden zusammengestellt …</div>`);

  let data;
  try {
    if (!S.profile.consentShare) throw new Error("ai_consent_disabled");
    const res = await apiPost(API.assess, assessPayload());
    data = await res.json();
    if (!res.ok) throw new Error(data.message || "Anfrage fehlgeschlagen");
  } catch(e){
    // Fällt der Dienst aus, darf der Loop nicht stehen bleiben: die
    // wichtigsten Fragen sind auch ohne Modell bekannt.
    data = fallbackQuestions();
  }

  const answers = {};
  const body = `
    <p class="sub" style="margin-bottom:18px">${esc(data.intro ||
      "Ein paar Fragen, damit die Einschätzung genauer wird.")}</p>
    ${data.urgent ? `<div class="flag"><span class="dot"></span><span class="tx">
      <b>Bitte sofort ärztlich abklären</b>${esc(data.urgent)}</span></div>` : ""}
    ${(data.questions || []).map((q, i) => `
      <div class="qitem" data-i="${i}">
        <b>${esc(q.text)}</b>
        ${q.why ? `<p class="why">${esc(q.why)}</p>` : ""}
        <div class="yesno">
          <button data-v="yes">Ja</button>
          <button data-v="no">Nein</button>
          <button data-v="unsure">Weiß nicht</button>
        </div>
      </div>`).join("")}
    <div class="field" style="margin-top:18px">
      <label for="fu-note">Möchtest du etwas ergänzen? (optional)</label>
      <textarea id="fu-note" rows="3" placeholder="z. B. seit Montag auch das linke Knie"></textarea>
    </div>`;

  openSheet("Gezielte Fragen", body,
    `<button class="btn btn-primary" id="fu-save" disabled>Auswerten</button>`);

  const qs = data.questions || [];
  $$(".qitem", $("#sheet-body")).forEach(box => {
    const i = Number(box.dataset.i);
    $$("button", box).forEach(b => b.onclick = () => {
      answers[i] = b.dataset.v;
      $$("button", box).forEach(x => x.classList.toggle("on", x === b));
      $("#fu-save").disabled = Object.keys(answers).length < qs.length;
    });
  });

  $("#fu-save").onclick = async () => {
    $("#fu-save").disabled = true;
    const followUp = {
      at: new Date().toISOString(),
      answers: qs.map((q, i) => ({
        q: q.text, a: answers[i], flag: q.flag || null,
        // Eine Frage ist "auffällig beantwortet", wenn die Antwort der
        // Richtung entspricht, die im Modell als bedenklich markiert war
        hit: q.alarm ? answers[i] === q.alarm : answers[i] === "yes"
      })),
      note: $("#fu-note").value.trim() || null,
      urgent: data.urgent || null
    };
    if (!await patchDay({ followUp })){
      $("#fu-save").disabled = false;
      return;
    }
    closeSheet();

    const hits = followUp.answers.filter(a => a.hit).length;
    toast("Antworten gespeichert. Sie ersetzen keine ärztliche Einordnung.");
    // Direkt weiter zum Bericht, wenn es etwas zu melden gibt
    if (hits >= 1) setTimeout(openReport, 800);
  };
}

/* Was das Modell braucht, um sinnvolle Fragen zu stellen. Bewusst
   knapp: nur Kennzahlen und Abweichungen, keine Klarnamen, keine
   E-Mail-Adresse, kein Geburtsdatum. */
function assessPayload(){
  const r = S.risk;
  return {
    condition: CONDITIONS.find(c => c.id === S.profile.condition)?.n || "Autoimmunerkrankung",
    conditionName: S.profile.conditionName || null,
    level: r.level,
    prob: probPct(r.prob),
    drivers: r.drivers.map(d => ({
      signal: SIGNALS[d.id].label,
      delta: deltaText(d.id, d),
      baseline: fmtVal(d.id, d.baseline),
      current: fmtVal(d.id, d.value)
    })),
    drugs: (S.profile.drugs || []).map(id => DRUGS.find(x => x.id === id)?.n).filter(Boolean),
    daysToNextDose: daysToNextDose(),
    missedDose: S.day.medTaken === "missed",
    joints: (S.profile.joints || []).map(id => JOINTS.find(j => j.id === id)?.n).filter(Boolean)
  };
}

/* Ohne Modellantwort: die Fragen, die bei jedem Verdacht auf einen Schub
   ohnehin gestellt werden — und die zugleich das Wichtigste ausschließen,
   nämlich einen Infekt als Ursache der veränderten Vitalwerte. */
function fallbackQuestions(){
  return {
    intro:"Ein paar Fragen, damit die Einschätzung genauer wird.",
    questions:[
      { text:"Hattest du in den letzten Tagen Fieber, Halsschmerzen oder andere Infektzeichen?",
        why:"Ein Infekt hebt Ruhepuls und Temperatur ähnlich an wie ein Schub — das muss zuerst abgegrenzt werden.",
        alarm:"yes", flag:"infekt" },
      { text:"Sind mehrere Gelenke gleichzeitig betroffen?",
        why:"Ein Befall mehrerer Gelenke spricht eher für entzündliche Aktivität als für eine Überlastung.",
        alarm:"yes", flag:"polyartikulär" },
      { text:"Sind Gelenke sichtbar geschwollen oder überwärmt?",
        why:"Schwellung und Überwärmung sind klassische Entzündungszeichen.",
        alarm:"yes", flag:"schwellung" },
      { text:"Schränken die Beschwerden dich im Alltag stärker ein als sonst?",
        why:"Die Alltagsfunktion ist das, woran die Praxis den Handlungsbedarf bemisst.",
        alarm:"yes", flag:"funktion" }
    ]
  };
}

function daysToNextDose(){
  if (!S.profile.nextDose) return null;
  const diff = Math.round(
    (new Date(`${S.profile.nextDose}T12:00:00`) - new Date(`${S.dayKey}T12:00:00`)) / 86400000);
  return diff;
}

/* ─────────────────  15. PRAXIS-MELDUNG  ─────────────────
   Der Punkt, an dem der Loop die App verlässt. Zwei Regeln:
   1. Nichts geht ohne ausdrückliche Bestätigung raus.
   2. Der Bericht muss so aussehen, dass eine Praxis in 30 Sekunden
      erfassen kann, worum es geht — sonst wird er nicht gelesen. */

async function openReport(){
  openSheet("Meldung an die Praxis", `<div class="analyzing"><span class="spin"></span>
    Bericht wird erstellt …</div>`);

  let data;
  try {
    if (!S.profile.consentShare) throw new Error("ai_consent_disabled");
    const res = await apiPost(API.report, reportPayload());
    data = await res.json();
    if (!res.ok) throw new Error(data.message || "Bericht fehlgeschlagen");
  } catch(e){
    data = { summary: fallbackReport() };
  }

  const practice = S.profile.practice || {};
  const body = `
    <div class="flag">
      <span class="dot"></span>
      <span class="tx"><b>Bitte selbst weitergeben</b>
        CLAM speichert den Bericht. Du kannst den Text kopieren und an deine Praxis übermitteln.</span>
    </div>

    <p class="group-label">Bericht</p>
    <div class="report">${esc(data.summary || "")}</div>

    <p class="group-label">Empfängerin</p>
    <div class="glass card">
      ${practice.name || practice.mail ? `
        <p class="sub"><b style="color:var(--ink)">${esc(practice.name || "Praxis")}</b><br>
          ${esc(practice.mail || "keine E-Mail hinterlegt")}
          ${practice.phone ? `<br>${esc(practice.phone)}` : ""}</p>`
      : `<p class="sub">Du hast noch keine Praxis hinterlegt. Der Bericht wird
           gespeichert, damit du ihn selbst weitergeben kannst — als Text zum
           Kopieren oder ausgedruckt zum Termin.</p>`}
    </div>`;

  openSheet("Meldung an die Praxis", body, `
    <button class="btn btn-primary" id="rp-send">
      Bericht speichern</button>
    <button class="btn btn-glass btn-sm" id="rp-copy">Text kopieren</button>`);

  $("#rp-copy").onclick = async () => {
    try { await navigator.clipboard.writeText(data.summary || ""); toast("In die Zwischenablage kopiert."); }
    catch { toast("Kopieren nicht möglich."); }
  };

  $("#rp-send").onclick = async () => {
    $("#rp-send").disabled = true;
    try {
      const rec = {
        at: new Date().toISOString(),
        dayKey: S.dayKey,
        level: S.risk.level,
        summary: data.summary,
        practice: { name: practice.name || null, mail: practice.mail || null },
        status: "stored"
      };
      const marker = { at: rec.at, level: rec.level };
      const batch = writeBatch(db);
      batch.set(doc(collection(db, "users", S.uid, "reports")), rec);
      batch.set(doc(db, "users", S.uid, "days", S.dayKey), { reportSaved:marker }, { merge:true });
      await batch.commit();
      S.day.reportSaved = marker;
      renderHome();
      closeSheet();
      toast("Bericht gespeichert. Bitte selbst an die Praxis weitergeben.");
    } catch {
      $("#rp-send").disabled = false;
      toast("Speichern fehlgeschlagen. Bitte erneut versuchen.");
    }
  };
}

/* Der Bericht bekommt den Verlauf, nicht nur den Tag: eine Praxis kann
   mit "seit vier Tagen steigend" viel mehr anfangen als mit einem
   einzelnen Messwert. */
function reportPayload(){
  const keys = lastKeys(S.dayKey, 14);
  const series = assessSeries(S.days, keys);
  const r = S.risk;

  return {
    condition: CONDITIONS.find(c => c.id === S.profile.condition)?.n || "Autoimmunerkrankung",
    conditionName: S.profile.conditionName || null,
    date: S.dayKey,
    level: r.level,
    prob: probPct(r.prob),
    confidence: Math.round(r.confidence * 100),
    baselineDays: r.baselineDays,
    drivers: r.drivers.map(d => ({
      signal: SIGNALS[d.id].label,
      baseline: fmtVal(d.id, d.baseline),
      current: fmtVal(d.id, d.value),
      delta: deltaText(d.id, d),
      share: Math.round(d.share * 100)
    })),
    trend: series.filter(s => s.prob != null)
      .map(s => ({ date:s.key, prob:probPct(s.prob), level:s.level })),
    followUp: S.day.followUp?.answers || [],
    followUpNote: S.day.followUp?.note || null,
    photos: (S.day.photos || []).map(p => ({
      region: JOINTS.find(j => j.id === p.region)?.n || p.region,
      findings: p.findings, change: p.change
    })),
    drugs: (S.profile.drugs || []).map(id => {
      const d = DRUGS.find(x => x.id === id);
      return d ? { name:d.n } : null;
    }).filter(Boolean),
    daysToNextDose: daysToNextDose(),
    labs: recentLabs(),
    joints: (S.profile.joints || []).map(id => JOINTS.find(j => j.id === id)?.n).filter(Boolean)
  };
}

/* Die zuletzt eingetragenen Laborwerte, je Parameter der neueste. */
function recentLabs(){
  const out = {};
  for (let i = S.days.length - 1; i >= 0; i--){
    const l = S.days[i].labs;
    if (!l) continue;
    for (const [k, v] of Object.entries(l))
      if (out[k] === undefined && Number.isFinite(v))
        out[k] = { value:v, date:S.days[i].key, unit:LABS.find(x => x.id === k)?.unit || "" };
  }
  return out;
}

/* Reiner Textbericht ohne Modell. Enthält dieselben Fakten — nur
   nüchterner formuliert. */
function fallbackReport(){
  const r = S.risk;
  const L = [];
  L.push(`Automatisch erzeugte Verlaufsmeldung aus der CLAM-App`);
  L.push(`Datum: ${longDate(S.dayKey)}`);
  L.push(`Erkrankung: ${CONDITIONS.find(c => c.id === S.profile.condition)?.n || "—"}`);
  L.push("");
  L.push(`Auffälligkeit gegenüber der Baseline: ${LEVEL_TEXT[r.level].t}`);
  L.push(`Grundlage: ${r.baselineDays} Vergleichstage; die Stufe ist nicht klinisch validiert.`);
  L.push("");
  L.push("Abweichungen gegenüber der persönlichen Baseline:");
  for (const d of r.drivers)
    L.push(`· ${SIGNALS[d.id].label}: ${fmtVal(d.id, d.baseline)} → ${fmtVal(d.id, d.value)} (${deltaText(d.id, d)})`);
  if (!r.drivers.length) L.push("· keine");

  if (S.day.followUp?.answers?.length){
    L.push("");
    L.push("Gezielte Nachfragen:");
    for (const a of S.day.followUp.answers)
      L.push(`· ${a.q} — ${a.a === "yes" ? "Ja" : a.a === "no" ? "Nein" : "Weiß nicht"}`);
    if (S.day.followUp.note) L.push(`· Ergänzung: ${S.day.followUp.note}`);
  }

  const dn = daysToNextDose();
  if (dn != null){
    L.push("");
    L.push(dn >= 0 ? `Nächste Gabe in ${dn} Tagen.` : `Letzte Gabe vor ${-dn} Tagen.`);
  }

  L.push("");
  L.push("Diese Meldung ist ein Hinweis auf eine Veränderung gegenüber den");
  L.push("individuellen Ausgangswerten, keine Diagnose. Erzeugt von CLAM,");
  L.push("Die Medizinprodukte-Einordnung ist noch nicht abgeschlossen.");
  return L.join("\n");
}

/* ─────────────────  16. VERLAUF  ─────────────────
   Die Kurve ist das, was Patient und Praxis gemeinsam anschauen. Sie
   zeigt die gespeicherten Bewertungen — nicht neu gerechnete: sonst
   würde eine später gewachsene Baseline die Vergangenheit umschreiben. */

/* Bewertungen für die Rückschau.

   Die gespeicherte Momentaufnahme hat Vorrang: sie ist das, was an dem
   Tag tatsächlich angezeigt wurde, und darf sich rückwirkend nicht
   ändern. Fehlt sie, wird nachgerechnet — sonst bliebe die Kurve leer,
   wo Daten sehr wohl vorliegen: Tage, die der Apple-Kurzbefehl still
   befüllt hat, kommen nie durch saveDay() und tragen deshalb keine
   Momentaufnahme. */
function historyPoints(n){
  const keys = lastKeys(todayKey(), n);
  const computed = assessSeries(S.days, keys);
  return keys.map((k, i) => {
    const d = S.days.find(x => x.key === k);
    if (S.profile?.condition !== "ra")
      return { key:k, prob:null, level:"unsupported", drivers:[], day:d };
    if (d?.risk?.prob != null)
      return { key:k, prob:d.risk.prob, level:d.risk.level,
               drivers:d.risk.drivers || [], day:d };
    const c = computed[i];
    return { key:k, prob:c.prob, level:c.prob == null ? null : c.level,
             drivers:c.drivers.map(x => x.id), day:d };
  });
}

function openHistory(){
  const pts = historyPoints(30);
  const withData = pts.filter(p => p.prob != null);
  const body = `
    <div class="seg" id="hist-seg">
      <button class="on" data-v="risk">Risiko</button>
      <button data-v="labs">Laborwerte</button>
      <button data-v="reports">Meldungen</button>
    </div>
    <div id="hist-out">${riskHistory(pts, withData)}</div>`;

  openSheet("Verlauf", body);

  $$("#hist-seg button").forEach(b => b.onclick = async () => {
    $$("#hist-seg button").forEach(x => x.classList.toggle("on", x === b));
    if (b.dataset.v === "risk") $("#hist-out").innerHTML = riskHistory(pts, withData);
    else if (b.dataset.v === "labs") $("#hist-out").innerHTML = labHistory();
    else {
      const markup = await reportHistory();
      if (!b.isConnected || !b.classList.contains("on")) return;
      $("#hist-out").innerHTML = markup;
    }
    bindHistItems();
  });
  bindHistItems();
}

function bindHistItems(){
  $$("[data-report]", $("#sheet-body")).forEach(el => el.onclick = () => {
    const record = reportCache.get(el.dataset.report);
    if (!record) return;
    openSheet("Gespeicherter Bericht", `<p class="note">Nur gespeichert – bitte selbst an
      deine Praxis weitergeben.</p><div class="report">${esc(record.summary || "")}</div>`, `
      <button class="btn btn-primary" id="saved-copy">Text kopieren</button>
      <button class="btn btn-glass" id="saved-download">Als Text herunterladen</button>
      <button class="btn btn-ghost" id="saved-back">Zurück zum Verlauf</button>`);
    $("#saved-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(record.summary || ""); toast("Bericht kopiert."); }
      catch { toast("Kopieren nicht möglich. Du kannst den Bericht herunterladen."); }
    };
    $("#saved-download").onclick = () => {
      const url = URL.createObjectURL(new Blob([record.summary || ""], { type:"text/plain;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url;
      a.download = `clam-bericht-${record.dayKey}.txt`; a.click();
      setTimeout(() => URL.revokeObjectURL(url),1000);
    };
    $("#saved-back").onclick = openHistory;
  });
  $$(".hist-item[data-key]", $("#sheet-body")).forEach(el => el.onclick = async () => {
    closeSheet();
    await openDay(el.dataset.key);
  });
}

function riskHistory(pts, withData){
  if (S.profile?.condition !== "ra")
    return `<p class="empty">Für diese Erkrankung gibt es noch keine geprüfte
      Verlaufseinstufung. Deine Einträge und Laborwerte bleiben erhalten.</p>`;
  if (withData.length < 2) return `<p class="empty">Noch zu wenig Verlauf.
    Sobald mehrere Tage bewertet sind, siehst du hier die Kurve.</p>`;

  /* Kurve. x über 30 Tage, y = interne Kennzahl. Lücken bleiben
     Lücken — eine durchgezogene Linie über nicht erfasste Tage würde
     Daten vortäuschen, die es nicht gibt. */
  const W = 320, H = 150, pad = 6;
  const x = i => pad + (i / (pts.length - 1)) * (W - 2*pad);
  const y = p => H - pad - p * (H - 2*pad);

  /* Segmente aus zusammenhängenden Tagen */
  const segs = [];
  let cur = [];
  pts.forEach((p, i) => {
    if (p.prob == null){ if (cur.length > 1) segs.push(cur); cur = []; return; }
    cur.push([x(i), y(p.prob)]);
  });
  if (cur.length > 1) segs.push(cur);

  const path = segs.map(s => "M" + s.map(([a,b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L")).join(" ");
  const dots = pts.map((p, i) => p.prob == null ? "" :
    `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(p.prob).toFixed(1)}" r="3.4"
       fill="${LEVELS[p.level]?.color || "#8A94A6"}"/>`).join("");

  const list = [...withData].reverse().slice(0, 14);

  return `
    <div class="chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <rect class="band-hi" x="0" y="${y(1)}" width="${W}" height="${y(GATES.high) - y(1)}"/>
        <rect class="band-el" x="0" y="${y(GATES.high)}" width="${W}" height="${y(GATES.elevated) - y(GATES.high)}"/>
        <line class="grid-l" x1="0" y1="${y(GATES.high)}" x2="${W}" y2="${y(GATES.high)}"/>
        <line class="grid-l" x1="0" y1="${y(GATES.elevated)}" x2="${W}" y2="${y(GATES.elevated)}"/>
        <path class="line" d="${path}"/>
        ${dots}
      </svg>
    </div>
    <div class="chart-legend"><span>vor 30 Tagen</span><span>heute</span></div>

    <p class="group-label">Tage im Detail</p>
    ${list.map(p => `
      <button class="hist-item" data-key="${p.key}">
        <span class="dot" style="background:${LEVELS[p.level]?.color}"></span>
        <span class="tx"><b>${esc(dayLabel(p.key))}</b>
          <span>${esc(driverSummary(p.drivers))}</span></span>
        <span class="val" style="color:${LEVELS[p.level]?.color}">${LEVEL_TEXT[p.level]?.t || "—"}</span>
      </button>`).join("")}`;
}

/* Höchstens drei Treiber. Gespeicherte Momentaufnahmen halten ohnehin
   nur drei fest; frisch gerechnete Tage hätten sonst neun und die Zeile
   liefe über drei Zeilen um. */
function driverSummary(ids){
  if (!ids?.length) return "Alle Werte im Normbereich";
  const names = ids.map(id => SIGNALS[id]?.label).filter(Boolean);
  const head = names.slice(0,3).join(", ");
  return names.length > 3 ? `${head} +${names.length - 3}` : head;
}

function labHistory(){
  const rows = [];
  for (let i = S.days.length - 1; i >= 0; i--){
    const l = S.days[i].labs;
    if (!l) continue;
    for (const [k, v] of Object.entries(l)){
      const def = LABS.find(x => x.id === k);
      if (!def || !Number.isFinite(v)) continue;
      rows.push({ key:S.days[i].key, n:def.n, v, unit:def.unit });
    }
  }
  if (!rows.length) return `<p class="empty">Noch keine Laborwerte eingetragen.
    Nach einer Blutabnahme kannst du CRP, Wirkstoffspiegel und weitere Werte
    hier nachtragen — sie schließen den Kreis zwischen App und Praxis.</p>`;

  return rows.slice(0, 30).map(r => `
    <div class="hist-item">
      <span class="dot" style="background:var(--blue-500)"></span>
      <span class="tx"><b>${esc(r.n)}</b><span>${esc(longDate(r.key))}</span></span>
      <span class="val">${dec1(r.v)} ${esc(r.unit)}</span>
    </div>`).join("");
}

const reportCache = new Map();
async function reportHistory(){
  let snap;
  try {
    snap = await getDocs(query(collection(db, "users", S.uid, "reports"),
      orderBy("at", "desc"), limit(20)));
  } catch { return `<p class="empty">Meldungen konnten nicht geladen werden.</p>`; }

  const rows = [];
  snap.forEach(d => rows.push({ id:d.id, ...d.data() }));
  reportCache.clear();
  rows.forEach(r => reportCache.set(r.id,r));
  if (!rows.length) return `<p class="empty">Noch keine Meldung an die Praxis.
    Wenn dein Risiko steigt und die Nachfragen den Verdacht stützen, kannst du
    von hier aus einen Bericht erzeugen.</p>`;

  return rows.map(r => `
    <button class="hist-item" data-report="${esc(r.id)}">
      <span class="dot" style="background:${LEVELS[r.level]?.color || "#8A94A6"}"></span>
      <span class="tx"><b>${esc(longDate(r.dayKey))}</b>
        <span>${esc(r.practice?.name || "Praxisbericht")} · nur gespeichert, bitte selbst weitergeben</span></span>
      <span class="val">${LEVEL_TEXT[r.level]?.t || "—"}</span>
    </button>`).join("");
}

/* ─────────────────  17. TAGESWECHSEL  ───────────────── */

function openDayPicker(){
  const pts = historyPoints(14).reverse();
  const body = pts.map(p => {
    const d = p.day;
    const has = d && (CHECKS.some(c => Number.isFinite(d[c.id])) ||
                      SIGNAL_IDS.some(id => Number.isFinite(d[id])));
    return `
      <button class="hist-item" data-key="${p.key}"${p.key === S.dayKey ? ' style="border-color:var(--blue-600)"' : ""}>
        <span class="dot" style="background:${p.level ? LEVELS[p.level].color : "rgba(140,170,220,.35)"}"></span>
        <span class="tx"><b>${esc(dayLabel(p.key))}</b>
          <span>${has ? esc(driverSummary(p.drivers)) : "keine Einträge"}</span></span>
        ${p.prob != null
          ? `<span class="val" style="color:${LEVELS[p.level].color}">${LEVEL_TEXT[p.level]?.t || "—"}</span>`
          : ""}
      </button>`;
  }).join("");

  openSheet("Tag wählen", body);
  $$(".hist-item[data-key]", $("#sheet-body")).forEach(el => el.onclick = async () => {
    closeSheet();
    await openDay(el.dataset.key);
  });
}

/* ─────────────────  18. LABORWERTE  ─────────────────
   Der Rückweg im Loop: was die Praxis gemessen hat, kommt hier zurück
   in die App und steht beim nächsten Bericht als Kontext bereit. */

function openLabs(){
  const d = {};
  const cur = S.day.labs || {};
  const tdm = (S.profile.drugs || []).some(id => DRUGS.find(x => x.id === id)?.tdm);

  const body = `
    <p class="hint" style="margin:0 2px 18px">Werte aus deiner Praxis. Sie gehen
       nicht in die Risikoberechnung ein — sie sind das Ergebnis der Abklärung
       und stehen beim nächsten Bericht als Vergleich bereit.</p>
    ${LABS.filter(l => tdm || !["level","ada"].includes(l.id)).map(l => `
      <div class="field">
        <label for="lb-${l.id}">${esc(l.n)} <span style="color:var(--ink-3)">· ${esc(l.unit)}</span></label>
        <input id="lb-${l.id}" type="number" inputmode="decimal" step="${l.step}"
               placeholder="${esc(l.hint)}"
               value="${Number.isFinite(cur[l.id]) ? cur[l.id] : ""}">
      </div>`).join("")}
    <div class="field">
      <label for="lb-date">Abnahmedatum</label>
      <input id="lb-date" type="date" value="${esc(S.dayKey)}" max="${todayKey()}">
    </div>`;

  openSheet("Laborwerte eintragen", body,
    `<button class="btn btn-primary" id="lb-save">Speichern</button>`);

  LABS.forEach(l => {
    const el = $(`#lb-${l.id}`);
    if (el) el.oninput = e => d[l.id] = numOf(e.target.value);
  });

  $("#lb-save").onclick = async () => {
    $("#lb-save").disabled = true;
    const labs = { ...cur };
    for (const [k, v] of Object.entries(d)) if (v != null) labs[k] = v;
    if (!Object.keys(labs).length){ closeSheet(); return; }

    /* Laborwerte gehören an den Abnahmetag, nicht an heute. */
    const key = $("#lb-date").value || S.dayKey;
    if (key === S.dayKey){
      if (!await patchDay({ labs })){
        $("#lb-save").disabled = false;
        return;
      }
    } else {
      const target = S.days.find(x => x.key === key) || { key };
      const next = { ...target, labs:{ ...(target.labs || {}), ...labs } };
      try { await setDoc(doc(db, "users", S.uid, "days", key), next, { merge:true }); }
      catch {
        $("#lb-save").disabled = false;
        toast("Speichern fehlgeschlagen. Bitte erneut versuchen.");
        return;
      }
      S.days = S.days.filter(x => x.key !== key);
      S.days.push(next);
      S.days.sort((a,b) => a.key.localeCompare(b.key));
    }
    closeSheet();
    toast("Laborwerte gespeichert.");
  };
}

/* ─────────────────  19. EINSTELLUNGEN  ───────────────── */

function openSettings(){
  const cond = CONDITIONS.find(c => c.id === S.profile.condition);
  const wear = WEARABLES.find(w => w.id === S.profile.wearable);
  const drugs = (S.profile.drugs || []).map(id => DRUGS.find(x => x.id === id)?.n).filter(Boolean);

  const body = `
    <div class="settings-grp">
      <p class="eyebrow">Behandlung</p>
      <button class="set-row" data-act="condition">
        <span class="tx"><b>Erkrankung</b><span>${esc(S.profile.conditionName || cond?.n || "—")}</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="joints">
        <span class="tx"><b>Betroffene Regionen</b>
          <span>${S.profile.joints?.length ? esc(S.profile.joints.length + " ausgewählt") : "keine"}</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="drugs">
        <span class="tx"><b>Medikamente</b><span>${drugs.length ? esc(drugs.join(", ")) : "keine"}</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="dose">
        <span class="tx"><b>Nächste Gabe</b>
          <span>${S.profile.nextDose ? esc(longDate(S.profile.nextDose)) : "nicht gesetzt"}</span></span>
        ${ICON.chev}
      </button>
    </div>

    <div class="settings-grp">
      <p class="eyebrow">Daten</p>
      <button class="set-row" data-act="wearable">
        <span class="tx"><b>Wearable</b><span>${esc(wear?.n || "—")}</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="ingest">
        <span class="tx"><b>Automatische Übernahme</b>
          <span>Werte per Apple-Kurzbefehl übertragen</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="labs">
        <span class="tx"><b>Laborwerte eintragen</b>
          <span>CRP, Wirkstoffspiegel, Antikörper</span></span>
        ${ICON.chev}
      </button>
    </div>

    <div class="settings-grp">
      <p class="eyebrow">Praxis</p>
      <button class="set-row" data-act="link">
        <span class="tx"><b>Praxis verknüpfen</b>
          <span>${S.profile.doctorCode
            ? esc(`${S.profile.doctorName || "Praxis"} · ${S.profile.doctorCode}`)
            : "Code aus deiner Praxis eintragen"}</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="practice">
        <span class="tx"><b>Praxisdaten für den Bericht</b>
          <span>${esc(S.profile.practice?.name || "nicht hinterlegt")}</span></span>
        ${ICON.chev}
      </button>
    </div>

    ${S.admin ? `
      <div class="settings-grp">
        <p class="eyebrow">Verwaltung</p>
        <button class="set-row" data-act="admin">
          <span class="tx"><b>Adminbereich</b>
            <span>Erkrankungen, Signale, Gewichte, Schwellen</span></span>
          ${ICON.chev}
        </button>
      </div>` : ""}

    <div class="settings-grp">
      <p class="eyebrow">Konto</p>
      <button class="set-row" data-act="ai-consent">
        <span class="tx"><b>KI-Auswertung</b>
          <span>${S.profile.consentShare ? "Aktiv – Gesundheitsdaten werden für Auswertungen übermittelt" :
            "Deaktiviert – nur lokale Auswertung und Berichte ohne KI"}</span></span>${ICON.chev}
      </button>
      ${!auth.currentUser?.emailVerified ? `<button class="set-row" data-act="verify">
        <span class="tx"><b>E-Mail bestätigen</b>
          <span>Für geschützte Verwaltungsfunktionen erforderlich</span></span>${ICON.chev}
      </button>` : ""}
      <button class="set-row" data-act="export">
        <span class="tx"><b>Daten exportieren</b><span>Alles als JSON-Datei</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="logout">
        <span class="tx"><b>Abmelden</b></span>${ICON.chev}
      </button>
      <button class="set-row" data-act="delete">
        <span class="tx"><b style="color:var(--bad)">Konto löschen</b>
          <span>Alle Daten unwiderruflich entfernen</span></span>
        ${ICON.chev}
      </button>
    </div>

    <div class="settings-grp">
      <p class="eyebrow">Rechtliches</p>
      <button class="set-row" data-act="privacy">
        <span class="tx"><b>Datenschutz</b></span>${ICON.chev}
      </button>
      <button class="set-row" data-act="terms">
        <span class="tx"><b>Nutzungsbedingungen</b></span>${ICON.chev}
      </button>
    </div>

    <p class="hint" style="text-align:center;margin-top:8px">
      CLAM · Entwicklungsstand · keine Diagnose</p>`;

  openSheet("Einstellungen", body);

  $$(".set-row", $("#sheet-body")).forEach(el => el.onclick = () => {
    const a = el.dataset.act;
    if (a === "link")     return openLink();
    if (a === "admin")    return openAdmin();
    if (a === "privacy" || a === "terms") return openLegal(a);
    if (a === "labs")     return openLabs();
    if (a === "ingest")   return openIngest();
    if (a === "export")   return exportData();
    if (a === "verify")   return sendEmailVerification(auth.currentUser)
      .then(() => toast("Bestätigungslink per E-Mail versendet."))
      .catch(() => toast("Link konnte nicht versendet werden."));
    if (a === "ai-consent"){
      const oldConsent = S.profile.consentShare;
      const oldConsentAt = S.profile.aiConsentAt;
      S.profile.consentShare = !S.profile.consentShare;
      S.profile.aiConsentAt = S.profile.consentShare ? new Date().toISOString() : null;
      return saveProfile().then(() => {
        toast(S.profile.consentShare ? "KI-Auswertung aktiviert." : "KI-Auswertung deaktiviert.");
        openSettings();
      }).catch(() => {
        S.profile.consentShare = oldConsent;
        S.profile.aiConsentAt = oldConsentAt;
        toast("Änderung konnte nicht gespeichert werden.");
      });
    }
    if (a === "logout")   return signOut(auth).then(closeSheet);
    if (a === "delete")   return openDelete();
    return openEdit(a);
  });
}

/* Einzelne Profilfelder nachträglich ändern. Die Formulare sind die
   gleichen wie im Onboarding — nur ohne Schrittzähler. */
function openEdit(what){
  let body = "";

  if (what === "condition"){
    body = `<div class="tiles">${CONDITIONS.map(c =>
      tileHTML(c.id, c.n, c.s, "", S.profile.condition === c.id)).join("")}</div>`;
  }
  if (what === "joints"){
    const groups = [...new Set(JOINTS.map(j => j.g))];
    body = groups.map(g => `
      <p class="group-label">${esc(g)}</p>
      <div class="chips">${JOINTS.filter(j => j.g === g).map(j =>
        `<button class="chip${S.profile.joints?.includes(j.id) ? " sel" : ""}"
           data-id="${j.id}">${esc(j.n)}</button>`).join("")}</div>`).join("");
  }
  if (what === "drugs"){
    const groups = [...new Set(DRUGS.map(d => d.g))];
    body = groups.map(g => `
      <p class="group-label">${esc(g)}</p>
      <div class="chips">${DRUGS.filter(d => d.g === g).map(d =>
        `<button class="chip${S.profile.drugs?.includes(d.id) ? " sel" : ""}"
           data-id="${d.id}">${esc(d.n)}</button>`).join("")}</div>`).join("");
  }
  if (what === "dose"){
    body = `
      <div class="field">
        <label for="ed-dose">Nächste Einnahme oder Injektion</label>
        <input id="ed-dose" type="date" value="${esc(S.profile.nextDose || "")}">
      </div>
      <div class="field">
        <label for="ed-every">Abstand in Tagen</label>
        <input id="ed-every" type="number" inputmode="numeric" min="1" max="365"
               value="${S.profile.drugEvery || 14}">
      </div>`;
  }
  if (what === "wearable"){
    body = `<div class="tiles">${WEARABLES.map(w =>
      tileHTML(w.id, w.n, w.s, "", S.profile.wearable === w.id)).join("")}</div>`;
  }
  if (what === "practice"){
    const p = S.profile.practice || {};
    body = `
      <div class="field"><label for="ed-pname">Praxis oder behandelnde Person</label>
        <input id="ed-pname" type="text" value="${esc(p.name || "")}"></div>
      <div class="field"><label for="ed-pmail">E-Mail</label>
        <input id="ed-pmail" type="email" value="${esc(p.mail || "")}"></div>
      <div class="field"><label for="ed-pphone">Telefon</label>
        <input id="ed-pphone" type="text" inputmode="tel" value="${esc(p.phone || "")}"></div>`;
  }

  const titles = { condition:"Erkrankung", joints:"Betroffene Regionen", drugs:"Medikamente",
                   dose:"Nächste Gabe", wearable:"Wearable", practice:"Praxisdaten" };
  openSheet(titles[what] || "Ändern", body,
    `<button class="btn btn-primary" id="ed-save">Speichern</button>`);

  /* Auswahl live mitführen */
  const pick = { condition:S.profile.condition, wearable:S.profile.wearable };
  const multi = { joints:[...(S.profile.joints || [])], drugs:[...(S.profile.drugs || [])] };

  bindTiles(el => {
    const key = what === "condition" ? "condition" : "wearable";
    pick[key] = el.dataset.id;
    $$(".tile").forEach(x => x.classList.toggle("sel", x === el));
  });
  $$(".chip", $("#sheet-body")).forEach(c => c.onclick = () => {
    const arr = multi[what];
    const id = c.dataset.id;
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i,1); else arr.push(id);
    c.classList.toggle("sel");
  });

  $("#ed-save").onclick = async () => {
    $("#ed-save").disabled = true;
    const previous = structuredClone(S.profile);
    if (what === "condition"){
      S.profile.condition = pick.condition;
      S.profile.conditionName = null;
      S.profile.joints = [...(CONDITIONS.find(c => c.id === pick.condition)?.joints || [])];
    }
    if (what === "wearable")  S.profile.wearable  = pick.wearable;
    if (what === "joints")    S.profile.joints    = multi.joints;
    if (what === "drugs")     S.profile.drugs     = multi.drugs;
    if (what === "dose"){
      S.profile.nextDose  = $("#ed-dose").value || null;
      S.profile.drugEvery = numOf($("#ed-every").value) || 14;
    }
    if (what === "practice"){
      S.profile.practice = {
        name:  $("#ed-pname").value.trim(),
        mail:  $("#ed-pmail").value.trim(),
        phone: $("#ed-pphone").value.trim()
      };
    }
    try { await saveProfile(what === "condition"); recompute(); renderHome(); closeSheet(); toast("Gespeichert."); }
    catch { S.profile = previous; recompute(); $("#ed-save").disabled = false; toast("Speichern fehlgeschlagen."); }
  };
}

/* ─────────────────  VERKNÜPFUNG MIT DER PRAXIS  ─────────────────
   Die Richtung ist bewusst so: den Zugriff erteilt der Patient, indem er
   den Code einträgt, und er kann ihn jederzeit wieder lösen. Eine Praxis
   kann sich niemandem selbst zuordnen. Genauso steht es in den
   Firestore-Regeln; das hier ist die bequeme Fassung davon. */

function openLink(){
  const linked = !!S.profile.doctorUid;

  if (linked){
    return openSheetLinked();
  }

  openSheet("Praxis verknüpfen", `
    <p class="sub" style="margin-bottom:18px">Deine Praxis hat einen Code nach
       dem Muster <b>CLAB1234</b>. Trägst du ihn hier ein, kann sie deinen
       Verlauf und dein aktuelles Risiko sehen.</p>

    <div class="field">
      <label for="lk-code">Praxiscode</label>
      <input id="lk-code" type="text" inputmode="text" autocapitalize="characters"
             maxlength="8" placeholder="CLAB1234"
             style="text-transform:uppercase;letter-spacing:.10em;font-weight:700">
    </div>
    <div id="lk-out"></div>

    <div class="disclaimer">
      ${ICON.info}
      <p>Die Praxis sieht danach deine Kennzahlen, deinen Verlauf, deine
         Tages-Checks und die Befunde deiner Fotos — nicht die Fotos selbst.
         Du kannst die Verknüpfung jederzeit wieder lösen, dann endet der
         Zugriff sofort.</p>
    </div>`, `
    <button class="btn btn-primary" id="lk-check" disabled>Code prüfen</button>`);

  const input = $("#lk-code");
  input.oninput = () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    $("#lk-check").disabled = !CODE_RE.test(input.value);
  };

  $("#lk-check").onclick = async () => {
    $("#lk-check").disabled = true;
    $("#lk-out").innerHTML = `<div class="analyzing"><span class="spin"></span>
      Code wird geprüft …</div>`;
    const r = await resolveCode(db, input.value);
    if (!r.ok){
      $("#lk-out").innerHTML = `<p class="note" style="color:var(--bad)">${
        r.reason === "unknown" ? "Diesen Code gibt es nicht. Bitte in der Praxis nachfragen."
        : r.reason === "unverified" ? "Diese Praxis wurde noch nicht geprüft und kann noch nicht verknüpft werden."
        : r.reason === "offline" ? "Keine Verbindung. Bitte später erneut versuchen."
        : "Das Muster stimmt nicht — erwartet werden zwei Buchstaben und vier Ziffern."}</p>`;
      $("#lk-check").disabled = false;
      return;
    }
    confirmLink(r);
  };
}

/* Bestätigung mit Namen: wer verknüpft, soll sehen, WEN er da freischaltet.
   Der Name für die Praxisliste wird hier gleich miterfasst — dort steht
   sonst nur eine Kennung, mit der niemand etwas anfangen kann. */
function confirmLink(r){
  $("#lk-out").innerHTML = `
    <div class="glass card" style="margin-top:16px">
      <p class="eyebrow">Gefundene Praxis</p>
      <h3 style="margin-top:6px">${esc(r.practice.name || "Praxis")}</h3>
      <p class="sub">${esc([r.practice.physician, r.practice.specialty]
        .filter(Boolean).join(" · "))}</p>
      <p class="sub" style="margin-top:4px">${esc([r.practice.street,
        [r.practice.zip, r.practice.city].filter(Boolean).join(" ")]
        .filter(Boolean).join(", "))}</p>
    </div>
    <div class="field" style="margin-top:16px">
      <label for="lk-name">Dein Name für die Praxisliste</label>
      <input id="lk-name" type="text" placeholder="Vor- und Nachname"
             value="${esc(S.profile.linkName || "")}">
      <p class="hint">Damit dich die Praxis in ihrer Übersicht zuordnen kann.</p>
    </div>`;

  $("#sheet-foot").innerHTML = `
    <button class="btn btn-primary" id="lk-go">Verknüpfung bestätigen</button>
    <button class="btn btn-ghost" id="lk-cancel">Abbrechen</button>`;
  $("#lk-cancel").onclick = openLink;
  $("#lk-go").onclick = async () => {
    const name = $("#lk-name").value.trim();
    if (!name) return toast("Bitte einen Namen eintragen.");
    $("#lk-go").disabled = true;
    const previous = structuredClone(S.profile);
    try {
      Object.assign(S.profile, {
        doctorUid:  r.uid,
        shareDoctorUid:r.uid,
        doctorCode: r.code,
        doctorName: r.practice.name || null,
        linkName:   name,
        linkedAt:   new Date().toISOString()
      });
      await saveProfile(true);
      closeSheet();
      toast("Praxis verknüpft.");
    } catch {
      S.profile = previous;
      $("#lk-go").disabled = false;
      toast("Verknüpfen fehlgeschlagen.");
    }
  };
}

function openSheetLinked(){
  openSheet("Praxis verknüpft", `
    <div class="glass card">
      <p class="eyebrow">Verknüpft mit</p>
      <h3 style="margin-top:6px">${esc(S.profile.doctorName || "Praxis")}</h3>
      <p class="sub">Code ${esc(S.profile.doctorCode)}${S.profile.linkedAt
        ? ` · seit ${esc(longDate(S.profile.linkedAt.slice(0,10)))}` : ""}</p>
      <p class="sub" style="margin-top:10px">Angezeigt wirst du dort als
        <b>${esc(S.profile.linkName || "—")}</b>.</p>
    </div>
    <div class="disclaimer">
      ${ICON.info}
      <p>Die Praxis sieht deine Kennzahlen, deinen Verlauf, deine Tages-Checks
         und die Befunde deiner Fotos — nicht die Fotos selbst. Löst du die
         Verknüpfung, endet der Zugriff sofort.</p>
    </div>`, `
    <button class="btn btn-glass btn-sm" id="lk-off" style="color:var(--bad)">
      Verknüpfung lösen</button>`);

  $("#lk-off").onclick = async () => {
    $("#lk-off").disabled = true;
    try {
      /* lastRisk mit weg: die Zusammenfassung existierte nur, damit die
         Praxis sie sieht. Ohne Verknüpfung hat sie dort nichts verloren. */
      await setDoc(doc(db, "users", S.uid), {
        doctorUid:null, shareDoctorUid:null, doctorCode:null, doctorName:null, linkedAt:null, lastRisk:null
      }, { merge:true });
      Object.assign(S.profile, {
        doctorUid:null, shareDoctorUid:null, doctorCode:null, doctorName:null, linkedAt:null, lastRisk:null
      });
      closeSheet();
      toast("Verknüpfung gelöst.");
    } catch {
      $("#lk-off").disabled = false;
      toast("Das hat nicht geklappt.");
    }
  };
}

/* Anleitung für die automatische Übernahme. Ein PWA kommt nicht an
   HealthKit heran — der Weg führt über einen Kurzbefehl, der die Werte
   morgens an den Ingest-Endpunkt schickt. */
async function tokenHash(token){
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2,"0")).join("");
}

async function openIngest(){
  if (DEMO_MODE){
    openSheet("Automatische Übernahme", `<p class="sub">Im Echtbetrieb lassen sich
      Messwerte über einen persönlichen Import-Schlüssel übertragen.</p>
      <p class="note">Die Demo enthält bereits synthetische Wearable-Werte.
      Es wird kein Schlüssel für einen externen Datenimport erzeugt.</p>`);
    return;
  }
  let token;
  try {
    const snap = await getDoc(doc(db, "users", S.uid, "private", "ingest"));
    token = snap.data()?.token || null;
  } catch { return toast("Schlüssel konnte nicht geladen werden."); }
  const origin = location.origin;

  openSheet("Automatische Übernahme", `
    <p class="sub" style="margin-bottom:18px">Eine Web-App kann Apple Health
       nicht direkt auslesen. Mit einem Kurzbefehl geht es trotzdem
       automatisch — einmal einrichten, danach läuft es jeden Morgen von
       selbst.</p>

    <p class="group-label">1 · Persönlichen Schlüssel erzeugen</p>
    <div class="glass card">
      ${token
        ? `<p class="sub" style="font-size:13px;word-break:break-all;
             font-family:ui-monospace,monospace">${esc(token)}</p>
           <button class="btn btn-glass btn-sm" id="ig-copy" style="margin-top:12px">Schlüssel kopieren</button>
           <button class="btn btn-glass btn-sm" id="ig-new" style="margin-top:12px">Schlüssel erneuern</button>`
        : `<p class="sub">Noch kein Schlüssel erzeugt.</p>
           <button class="btn btn-primary btn-sm" id="ig-new" style="margin-top:12px">Schlüssel erzeugen</button>`}
      <p class="hint">Der Schlüssel ist wie ein Passwort — gib ihn nicht weiter.
         Du kannst ihn jederzeit neu erzeugen, der alte wird dann ungültig.</p>
    </div>

    <p class="group-label">2 · Kurzbefehl anlegen</p>
    <div class="glass card">
      <p class="sub" style="font-size:14px">In der App <b>Kurzbefehle</b> auf dem
        iPhone einen neuen Automationsablauf erstellen:</p>
      <p class="sub" style="font-size:14px;margin-top:10px">
        · Auslöser: <b>Tageszeit</b>, z. B. 8:00 Uhr<br>
        · Aktion <b>Gesundheitsdaten abrufen</b> für Ruhepuls, HRV, Schritte,
          Schlafdauer und Handgelenktemperatur<br>
        · Aktion <b>Inhalte von URL abrufen</b>:</p>
      <p class="sub" style="font-size:13px;margin-top:10px;word-break:break-all;
         font-family:ui-monospace,monospace">POST ${esc(origin)}/api/ingest</p>
      <p class="sub" style="font-size:14px;margin-top:10px">
        Anfragetext als JSON mit den Feldern <b>token</b>, <b>date</b>,
        <b>rhr</b>, <b>hrv</b>, <b>steps</b>, <b>sleep</b> und <b>temp</b>.</p>
    </div>

    <p class="group-label">3 · Fertig</p>
    <div class="glass card">
      <p class="sub" style="font-size:14px">Ab dann füllt sich der Tages-Check
        von allein mit den passiven Werten. Du trägst nur noch ein, wie es dir
        geht — das kann die Uhr nicht messen.</p>
    </div>

    <p class="hint">Die vollständige Anleitung mit Beispiel-JSON steht in der
       README des Projekts.</p>`);

  const nb = $("#ig-new");
  if (nb) nb.onclick = async () => {
    nb.disabled = true;
    try {
      const next = crypto.randomUUID().replace(/-/g, "");
      const hash = await tokenHash(next);
      const batch = writeBatch(db);
      batch.set(doc(db, "ingestTokens", hash), { uid:S.uid, createdAt:new Date().toISOString() });
      batch.set(doc(db, "users", S.uid, "private", "ingest"), { token:next, hash });
      if (token) batch.delete(doc(db, "ingestTokens", await tokenHash(token)));
      await batch.commit();
      await openIngest();
      toast(token ? "Schlüssel erneuert. Kurzbefehl bitte anpassen." : "Schlüssel erzeugt.");
    } catch {
      nb.disabled = false;
      toast("Schlüssel konnte nicht gespeichert werden.");
    }
  };
  const cb = $("#ig-copy");
  if (cb) cb.onclick = async () => {
    try { await navigator.clipboard.writeText(token); toast("Kopiert."); }
    catch { toast("Kopieren nicht möglich."); }
  };
}

function openLegal(which){
  if (DEMO_MODE){
    openSheet("Hinweise zur Demo", `<p class="sub">Diese Präsentation verwendet erfundene
      Profile und Messwerte. Eingaben werden nur im Arbeitsspeicher dieses Tabs gehalten
      und beim Neuladen verworfen. Es gibt keine Übertragung an Firebase oder KI-Dienste.</p>
      <p class="note">Bitte keine echten Gesundheitsdaten eingeben. Die Demo zeigt den
      Entwicklungsstand; klinische Validierung und die Rechts- und Datenschutzgrundlage
      für einen produktiven Einsatz stehen noch aus.</p>`);
    return;
  }
  openSheet(which === "privacy" ? "Datenschutz" : "Nutzungsbedingungen",
    `<div class="legal">${LEGAL[which]}</div>`);
}

/* Export. Bei Gesundheitsdaten ein Recht, kein Extra — Art. 20 DSGVO. */
async function exportData(){
  toast("Export wird vorbereitet …");
  try {
    const tokenSnap = await getDoc(doc(db, "users", S.uid, "private", "ingest"));
    const snap = await getDocs(collection(db, "users", S.uid, "days"));
    const days = [];
    snap.forEach(d => days.push({ key:d.id, ...d.data() }));

    const rsnap = await getDocs(collection(db, "users", S.uid, "reports"));
    const reports = [];
    rsnap.forEach(d => reports.push({ id:d.id, ...d.data() }));

    /* Die Fotos gehören dazu — Datenübertragbarkeit meint alle Daten,
       nicht nur die handlichen. Die Datei wird dadurch groß. */
    const psnap = await getDocs(collection(db, "users", S.uid, "photos"));
    const photos = [];
    psnap.forEach(d => photos.push({ id:d.id, ...d.data() }));

    const blob = new Blob([JSON.stringify({
      exportedAt: new Date().toISOString(),
      profile: S.profile, days, reports, photos,
      importKey:tokenSnap.data()?.token || null
    }, null, 2)], { type:"application/json" });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `clam-export-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Export heruntergeladen.");
  } catch { toast("Export fehlgeschlagen."); }
}

function openDelete(){
  if (DEMO_MODE){
    toast("Mit „Neustart“ oben setzt du alle Demo-Eingaben zurück.");
    return;
  }
  openSheet("Konto löschen", `
    <div class="glass card">
      <h3>Das lässt sich nicht rückgängig machen</h3>
      <p class="sub" style="margin-top:8px">Gelöscht werden dein Profil, alle
        Tageseinträge, alle Fotos, alle Laborwerte und alle Berichte. Danach ist
        nichts davon wiederherstellbar.</p>
      <p class="sub" style="margin-top:10px">Willst du deine Daten behalten,
        <b>exportiere sie vorher</b> — der Export steht in den Einstellungen.</p>
    </div>`, `
    <button class="btn btn-glass btn-sm" id="dl-export">Erst exportieren</button>
    <button class="btn" id="dl-go" style="background:var(--bad);color:#fff">
      Endgültig löschen</button>`);

  $("#dl-export").onclick = exportData;
  $("#dl-go").onclick = async () => {
    $("#dl-go").disabled = true;
    try {
      /* Erst die Unterdaten, dann das Profil, zuletzt das Konto: bricht
         es dazwischen ab, bleibt kein Konto ohne zugehörige Daten übrig,
         sondern nur Daten ohne Konto — und die kann der Nutzer nach
         erneutem Login wieder löschen. */
      for (const sub of ["days", "reports", "photos"]){
        const snap = await getDocs(collection(db, "users", S.uid, sub));
        await Promise.all(snap.docs.map(d =>
          deleteDoc(doc(db, "users", S.uid, sub, d.id))));
      }
      const privateSnap = await getDoc(doc(db, "users", S.uid, "private", "ingest"));
      if (privateSnap.exists()){
        if (privateSnap.data().hash)
          await deleteDoc(doc(db, "ingestTokens", privateSnap.data().hash));
        await deleteDoc(privateSnap.ref);
      }
      await deleteDoc(doc(db, "users", S.uid));
      await deleteUser(auth.currentUser);
      closeSheet();
      toast("Konto gelöscht.");
    } catch(e){
      /* Firebase verlangt für das Löschen eine frische Anmeldung. */
      if (e.code === "auth/requires-recent-login"){
        try {
          const u = auth.currentUser;
          const google = u.providerData.some(p => p.providerId === "google.com");
          if (google) await reauthenticateWithPopup(u, gprov);
          else {
            const pw = prompt("Zur Sicherheit bitte dein Passwort bestätigen:");
            if (!pw) { $("#dl-go").disabled = false; return; }
            await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, pw));
          }
          await deleteUser(auth.currentUser);
          closeSheet();
          toast("Konto gelöscht.");
          return;
        } catch { /* fällt unten durch */ }
      }
      $("#dl-go").disabled = false;
      toast("Löschen fehlgeschlagen. Bitte neu anmelden und erneut versuchen.");
    }
  };
}

/* ─────────────────  20. INSTALLATIONS-HINWEIS  ─────────────────
   Als installierte App bekommt CLAM einen eigenen Startbildschirm und
   behält den Splash — im Browser-Tab geht beides verloren. */

let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault();
  deferredPrompt = e;
});

const INSTALL_KEY = "clam-install-dismissed";

function maybeShowInstall(){
  if (DEMO_MODE) return;
  const standalone = window.matchMedia("(display-mode: standalone)").matches ||
                     window.navigator.standalone;
  if (standalone) return;
  try { if (localStorage.getItem(INSTALL_KEY)) return; } catch {}

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!deferredPrompt && !ios) return;

  $("#install-t").textContent = "CLAM installieren";
  $("#install-s").textContent = ios
    ? "Teilen-Symbol antippen, dann „Zum Home-Bildschirm“."
    : "Als App auf dem Startbildschirm.";
  $("#install-go").hidden = !deferredPrompt;
  $("#install").classList.add("on");
}

$("#install-go").onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $("#install").classList.remove("on");
};
$("#install-x").onclick = () => {
  try { localStorage.setItem(INSTALL_KEY, "1"); } catch {}
  $("#install").classList.remove("on");
};

if (DEMO_MODE){
  const { mountDemo } = await import("./demo-ui.js");
  mountDemo({ demo, openSheet, closeSheet, openHistory, openCheckin, openReport });
}
