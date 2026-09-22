import { assessSeries, dateToKey, shiftKey } from "./risk.js";

// Synthetic data only. A reload or reset discards all changes; no persistence or network.
const records = new Map();
const listeners = new Set();
const deleted = Symbol("delete");
export const DEMO_PATIENT = "demo-anna";
export const DEMO_PRACTICE = "demo-practice";
const auth = { currentUser:null };
const db = { demo:true };

function user(uid){
  return { uid, email:`${uid}@clam.test`, emailVerified:true, providerData:[],
    getIdToken:async () => { throw new Error("Demo verwendet keine Firebase-Tokens."); } };
}

export function resetDemo(){
  records.clear();
  const today = dateToKey(new Date());
  records.set(`doctors/${DEMO_PRACTICE}`, {
    name:"Rheumatologie am Park", physician:"Dr. Marie Weber · Demo", specialty:"Demo-Praxis",
    code:"CLDE2026", verified:true, mail:"praxis@clam.test", email:"praxis@clam.test"
  });
  records.set("codes/CLDE2026", { doctorUid:DEMO_PRACTICE });
  for (const [uid, name, count, change] of [
    [DEMO_PATIENT, "Anna Becker", 45, 1],
    ["demo-lukas", "Lukas Schneider", 45, 0],
    ["demo-mira", "Mira Hoffmann", 6, 0]
  ]){
    const days = Array.from({ length:count }, (_, i) => {
      const day = { key:shiftKey(today, i-count+1),
        rhr:62 + Math.sin(i)*1.4, hrv:48 + Math.sin(i)*3,
        steps:8200 + Math.sin(i)*700, sleep:7.3 + Math.sin(i)*0.2,
        temp:33.1 + Math.sin(i)*0.04, pain:2, stiff:15, fatigue:2, global:2,
        checkedAt:new Date().toISOString(), vitalsSource:"demo" };
      if (change && i >= count-3){
        const k = (i-(count-4))/3;
        Object.assign(day, { rhr:62+16*k, hrv:48-20*k, steps:8200-4800*k,
          sleep:7.3-1.4*k, temp:33.1+0.6*k, pain:Math.round(2+5*k),
          stiff:Math.round(15+60*k), fatigue:Math.round(2+5*k), global:Math.round(2+5*k) });
      }
      if (i === count-5) day.labs = { crp:4.2, esr:12 };
      return day;
    });
    const series = assessSeries(days, days.map(d => d.key));
    days.forEach((d,i) => {
      const r = series[i];
      d.risk = r.prob == null ? null : { level:r.level, prob:r.prob, raw:r.raw,
        confidence:r.confidence, drivers:r.drivers.slice(0,3).map(x => x.id), modelVersion:"defaults-v1" };
      records.set(`users/${uid}/days/${d.key}`, d);
    });
    const last = series.at(-1);
    records.set(`users/${uid}`, {
      onboarded:true, demo:true, condition:"ra", joints:["hand_l","hand_r","knee_l"],
      drugs:["adalimumab","mtx"], drugEvery:14, nextDose:shiftKey(today,3), wearable:"applewatch",
      consent:true, consentShare:true, doctorUid:DEMO_PRACTICE, shareDoctorUid:DEMO_PRACTICE,
      doctorName:"Rheumatologie am Park", doctorCode:"CLDE2026", linkName:name,
      linkedAt:new Date().toISOString(), practice:{ name:"Rheumatologie am Park", mail:"praxis@clam.test" },
      lastRisk:{ level:last.level, prob:last.prob, confidence:last.confidence,
        drivers:last.drivers.slice(0,3).map(x => x.id), date:today, modelVersion:"defaults-v1" }
    });
  }
}
resetDemo();
auth.currentUser = user(DEMO_PATIENT);

export async function switchDemoRole(role){
  auth.currentUser = user(role === "doctor" ? DEMO_PRACTICE : DEMO_PATIENT);
  await Promise.all([...listeners].map(fn => fn(auth.currentUser)));
}

export const initializeApp = () => ({ demo:true });
export const deleteApp = async () => {};
export const getAuth = () => auth;
export const getFirestore = () => db;
export function onAuthStateChanged(_auth, callback){
  listeners.add(callback);
  queueMicrotask(() => callback(auth.currentUser));
  return () => listeners.delete(callback);
}
export const signOut = async () => { await switchDemoRole("patient"); };
const unavailable = async () => { throw new Error("Im Demo-Modus nicht verfügbar."); };
export const signInWithEmailAndPassword = unavailable;
export const createUserWithEmailAndPassword = unavailable;
export const signInWithPopup = unavailable;
export const deleteUser = unavailable;
export const reauthenticateWithCredential = unavailable;
export const reauthenticateWithPopup = unavailable;
export const sendEmailVerification = unavailable;
export const sendPasswordResetEmail = unavailable;
export class GoogleAuthProvider {}
export const EmailAuthProvider = { credential:() => ({}) };

function ref(parent, parts, isDocument){
  const path = [parent?.path, ...parts].filter(Boolean).join("/");
  const segments = path.split("/");
  if ((segments.length % 2 === 0) !== isDocument) throw new Error(`Ungültiger Datenpfad: ${path}`);
  return { path, id:segments.at(-1) };
}
export const collection = (parent, ...parts) => ref(parent, parts, false);
export const doc = (parent, ...parts) => ref(parent,
  parts.length ? parts : [crypto.randomUUID()], true);
export const documentId = () => "__id__";
export const where = (field, op, value) => ({ type:"where", field, op, value });
export const orderBy = (field, direction = "asc") => ({ type:"order", field, direction });
export const limit = count => ({ type:"limit", count });
export const query = (reference, ...clauses) => ({ ...reference, clauses });
export const deleteField = () => deleted;
function snapshot(reference, value){
  return { id:reference.id, ref:reference, exists:() => value !== undefined,
    data:() => value === undefined ? undefined : structuredClone(value) };
}
export const getDoc = async reference => snapshot(reference, records.get(reference.path));
export async function getDocs(reference){
  let rows = [...records].filter(([key]) => key.startsWith(reference.path + "/") &&
    key.split("/").length === reference.path.split("/").length+1)
    .map(([path, data]) => ({ path, id:path.split("/").at(-1), data }));
  const field = (row, key) => key === "__id__" ? row.id : row.data[key];
  for (const c of reference.clauses || []){
    if (c.type === "where") rows = rows.filter(row => {
      const v = field(row,c.field);
      if (c.op === "==") return v === c.value;
      if (c.op === ">=") return v >= c.value;
      if (c.op === "<=") return v <= c.value;
      throw new Error(`Demo-Abfrage nicht unterstützt: ${c.op}`);
    });
    if (c.type === "order") rows.sort((a,b) => {
      const x = field(a,c.field), y = field(b,c.field);
      return (x < y ? -1 : x > y ? 1 : 0) * (c.direction === "desc" ? -1 : 1);
    });
    if (c.type === "limit") rows = rows.slice(0,c.count);
  }
  const docs = rows.map(row => snapshot(row,row.data));
  return { docs, size:docs.length, empty:!docs.length, forEach:fn => docs.forEach(fn) };
}
function write(target, reference, data, options){
  const next = options?.merge ? structuredClone(target.get(reference.path) || {}) : {};
  for (const [key,value] of Object.entries(data)){
    if (value === deleted) delete next[key]; else next[key] = structuredClone(value);
  }
  target.set(reference.path,next);
}
export const setDoc = async (r,d,o) => write(records,r,d,o);
export const updateDoc = async (r,d) => {
  if (!records.has(r.path)) throw new Error("Dokument nicht vorhanden.");
  write(records,r,d,{ merge:true });
};
export const deleteDoc = async r => records.delete(r.path);
export const addDoc = async (r,d) => { const next = doc(r); await setDoc(next,d); return next; };
export function writeBatch(){
  const operations = [];
  return {
    set:(...args) => operations.push(target => write(target,...args)),
    delete:r => operations.push(target => target.delete(r.path)),
    commit:async () => {
      const next = new Map(records);
      operations.forEach(op => op(next));
      records.clear(); next.forEach((v,k) => records.set(k,v));
    }
  };
}

export async function demoResponse(endpoint, payload){
  // Prepared examples are always labelled. They never pretend to be a live AI result.
  if (endpoint === "/api/assess") return Response.json({
    intro:"Demo-Beispielfragen zu den gezeigten Veränderungen.", urgent:"",
    questions:[
      { text:"Hattest du zuletzt Fieber oder andere Infektzeichen?", why:"Zusätzliche Beobachtungen helfen deiner Praxis bei der Einordnung.", alarm:"yes", flag:"infekt" },
      { text:"Sind deine Gelenke stärker geschwollen als sonst?", why:"Dokumentiere sichtbare Veränderungen.", alarm:"yes", flag:"schwellung" },
      { text:"Fallen dir gewohnte Tätigkeiten schwerer?", why:"Beschreibe, was sich im Alltag verändert hat.", alarm:"yes", flag:"funktion" }
    ]
  });
  if (endpoint === "/api/report") return Response.json({ summary:[
    "CLAM · Demo-Verlaufsbericht · ausschließlich synthetische Daten",
    `Datum: ${payload.date}`, `Erkrankung: ${payload.condition}`,
    `Medikation: ${(payload.drugs || []).map(d => d.name).join(", ")}`,
    "", "Beobachtete Veränderungen:",
    ...(payload.drivers || []).map(d => `• ${d.signal}: ${d.baseline} → ${d.current} (${d.delta})`),
    "", "Patientenangaben:",
    ...(payload.followUp || []).map(a => `• ${a.q} ${a.a === "yes" ? "Ja" : a.a === "no" ? "Nein" : "Unklar"}`),
    payload.followUpNote || "", "",
    "Vorbereitete Demo-Ausgabe, keine Live-KI-Auswertung. Die Einstufung ist nicht klinisch validiert.",
    "Nur gespeichert. Kein Versand und keine Kenntnisnahme durch eine Praxis."
  ].filter(x => x !== undefined).join("\n") });
  return Response.json({ message:"Diese Funktion benötigt im Echtbetrieb einen angebundenen Dienst." }, { status:503 });
}
