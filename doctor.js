/* ══════════════════════════════════════════════════════════════════
   CLAM — Praxisansicht

   Eigenständiger Teil der App für die behandelnde Praxis. Der
   Patiententeil bleibt davon unberührt: eigener Screen, eigenes Modul,
   eigene Firestore-Sammlungen. Wer sich als Praxis anmeldet, sieht den
   Patiententeil nie und umgekehrt.

   ───────────────────────────────────────────────────────────────────
   VERKNÜPFUNG
   ───────────────────────────────────────────────────────────────────
   Die Praxis bekommt beim ersten Anmelden einen Code nach dem Muster
   CLyyxxxx (zwei Buchstaben, vier Ziffern). Den gibt sie ihren
   Patienten; die tragen ihn in ihren Einstellungen ein.

   Die Richtung ist wichtig: den Zugriff erteilt der PATIENT, indem er
   den Code einträgt, und er kann ihn jederzeit wieder lösen. Die Praxis
   kann sich niemandem selbst zuordnen. Genau so steht es auch in den
   Firestore-Regeln — die Oberfläche hier ist nur die bequeme Fassung
   davon.

   ───────────────────────────────────────────────────────────────────
   WAS DIE PRAXIS SIEHT
   ───────────────────────────────────────────────────────────────────
   Die Liste liest nur die Nutzerdokumente der verknüpften Patienten.
   Darin steht eine Kurzfassung des letzten Risikos, die der Patient bei
   jedem Speichern mitschreibt — damit kostet die Übersicht eine Abfrage
   statt einen Verlauf je Patient. Erst beim Aufklappen eines Patienten
   werden dessen Tage geladen.
   ══════════════════════════════════════════════════════════════════ */

import {
  doc, getDoc, setDoc, collection, getDocs, query, where, documentId, sendEmailVerification, DEMO_MODE
} from "./backend.js";

import { CONDITIONS, DRUGS, JOINTS, LABS, ICON } from "./data.js";
import { SIGNALS, LEVELS, GATES, assess, assessSeries, lastKeys, dateToKey, shiftKey, deltaText } from "./risk.js";


let ctx = null;          // { db, auth, ui }
let practice = null;     // das eigene Praxisdokument
let patients = [];       // verknüpfte Patienten, Kurzfassung
let patientsError = "";

export function initDoctor(c){ ctx = c; }
export const getPractice = () => practice;

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

const LEVEL_TEXT = {
  low:"Niedrig", elevated:"Erhöht", high:"Hoch",
  building:"Baseline läuft", nodata:"Keine Daten", unsupported:"Nicht bewertet"
};

/* ─────────────────  1. CODE  ─────────────────
   CL + zwei Buchstaben + vier Ziffern. I und O sind absichtlich nicht
   dabei: am Telefon vorgelesen sind sie von 1 und 0 nicht zu
   unterscheiden, und dieser Code wird vorgelesen. */

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const CODE_RE = /^CL[A-HJ-NP-Z]{2}\d{4}$/;

export function makeCode(){
  const l = () => LETTERS[Math.floor(Math.random() * LETTERS.length)];
  const d = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `CL${l()}${l()}${d}`;
}

/* Erzeugt einen Code, der noch nicht vergeben ist. Bei rund 5,8 Mio
   Möglichkeiten ist eine Kollision unwahrscheinlich, aber "unwahr-
   scheinlich" ist kein Verlass, wenn daran ein Praxiszugang hängt. */
async function reserveCode(db, uid){
  for (let i = 0; i < 12; i++){
    const code = makeCode();
    const ref = doc(db, "codes", code);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;
    await setDoc(ref, { doctorUid: uid, createdAt: new Date().toISOString() });
    return code;
  }
  throw new Error("Es konnte kein freier Code erzeugt werden.");
}

/* Löst einen Code zur Praxis auf. Wird vom Patiententeil benutzt. */
export async function resolveCode(db, code){
  const clean = String(code || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!CODE_RE.test(clean)) return { ok:false, reason:"format" };
  try {
    const snap = await getDoc(doc(db, "codes", clean));
    if (!snap.exists()) return { ok:false, reason:"unknown" };
    const uid = snap.data().doctorUid;
    const d = await getDoc(doc(db, "doctors", uid));
    if (!d.exists()) return { ok:false, reason:"unknown" };
    if (d.data().verified !== true) return { ok:false, reason:"unverified" };
    return { ok:true, code:clean, uid, practice:d.data() };
  } catch { return { ok:false, reason:"offline" }; }
}

/* ─────────────────  2. PRAXIS LADEN  ───────────────── */

export async function loadPractice(db, uid){
  try {
    const snap = await getDoc(doc(db, "doctors", uid));
    practice = snap.exists() ? snap.data() : null;
    return practice;
  } catch { practice = null; return null; }
}

/* ─────────────────  3. ONBOARDING  ─────────────────
   Ein Schritt, kein Assistent. Eine Praxis trägt ihre Stammdaten einmal
   ein; das über sieben Bildschirme zu verteilen wäre reine Zeremonie. */

const FIELDS = [
  { k:"name",      l:"Name der Praxis",        req:true,  ph:"Rheumatologie Dr. Meier" },
  { k:"physician", l:"Behandelnde Person",     req:true,  ph:"Dr. med. Anna Meier" },
  { k:"specialty", l:"Fachrichtung",           ph:"Rheumatologie" },
  { k:"street",    l:"Straße und Hausnummer",  ph:"Beispielweg 1" },
  { k:"zip",       l:"PLZ",                    ph:"10115" },
  { k:"city",      l:"Ort",                    ph:"Berlin" },
  { k:"phone",     l:"Telefon",                ph:"030 123456" },
  { k:"mail",      l:"E-Mail",       req:true,  ph:"praxis@beispiel.de" }
];

export function renderDoctorOnboarding(){
  const draft = {};
  $("#doc-ob-body").innerHTML = FIELDS.map(f => `
    <div class="field">
      <label for="do-${f.k}">${esc(f.l)}${f.req ? " *" : ""}</label>
      <input id="do-${f.k}" type="${f.k === "mail" ? "email" : "text"}"
             placeholder="${esc(f.ph)}">
    </div>`).join("") + `
    <div class="disclaimer">
      ${ICON.info}
      <p>Nach dem Speichern erhältst du einen Code, den du deinen Patientinnen
         und Patienten gibst. Erst wenn sie ihn in ihrer App eintragen, siehst
         du deren Verlauf — den Zugriff erteilen sie, nicht du, und sie können
         ihn jederzeit wieder lösen.</p>
    </div>`;

  FIELDS.forEach(f => $(`#do-${f.k}`).oninput = e => draft[f.k] = e.target.value.trim());

  $("#doc-ob-save").onclick = async () => {
    for (const f of FIELDS){
      if (f.req && !draft[f.k]) return ctx.ui.toast(`${f.l} wird gebraucht.`);
    }
    $("#doc-ob-save").disabled = true;
    try {
      const uid = ctx.auth.currentUser.uid;
      const code = await reserveCode(ctx.db, uid);
      practice = {
        ...draft, code, uid,
        verified:false,
        email: ctx.auth.currentUser.email || null,
        createdAt: new Date().toISOString()
      };
      await setDoc(doc(ctx.db, "doctors", uid), practice);
      await openDoctorHome();
      ctx.ui.toast("Praxis angelegt.");
    } catch (e){
      $("#doc-ob-save").disabled = false;
      ctx.ui.toast(e.message || "Speichern fehlgeschlagen.");
    }
  };
}

/* ─────────────────  4. STARTBILDSCHIRM  ───────────────── */

export async function openDoctorHome(){
  ctx.ui.screen("s-doc");
  await loadPatients();
  renderDoctorHome();
}

async function loadPatients(){
  patients = [];
  patientsError = "";
  if (practice?.verified !== true || !ctx.auth.currentUser?.emailVerified) return false;
  try {
    const snap = await getDocs(query(
      collection(ctx.db, "users"),
      where("shareDoctorUid", "==", ctx.auth.currentUser.uid)));
    snap.forEach(d => patients.push({ uid:d.id, ...d.data() }));
  } catch (e){
    patientsError = "Patientendaten konnten nicht geladen werden. Bitte Verbindung und Praxisfreigabe prüfen.";
    return false;
  }
  /* Dringendstes zuerst: wer ein hohes Risiko trägt, gehört nach oben.
     Innerhalb einer Stufe die höhere interne Kennzahl zuerst. */
  const rank = { high:0, elevated:1, low:2, building:3, nodata:4 };
  patients.sort((a, b) => {
    const ra = a.condition === "ra" ? (rank[a.lastRisk?.level] ?? 5) : 5;
    const rb = b.condition === "ra" ? (rank[b.lastRisk?.level] ?? 5) : 5;
    if (ra !== rb) return ra - rb;
    return (b.lastRisk?.prob ?? 0) - (a.lastRisk?.prob ?? 0);
  });
  return true;
}

function renderDoctorHome(){
  const alerts = patients.filter(p => p.condition === "ra" &&
    ["high","elevated"].includes(p.lastRisk?.level)).length;

  $("#doc-head").innerHTML = `
    <div class="head-l">
      <span class="date" style="pointer-events:none">${esc(practice?.specialty || "Praxis")}</span>
      <h2 style="margin:2px 0 0">${esc(practice?.name || "Praxis")}</h2>
    </div>
    <div class="head-r">
      <button class="icon-btn" id="doc-refresh" aria-label="Aktualisieren">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6M3 22v-6h6"/>
          <path d="M3.5 9a9 9 0 0 1 14.9-3.4L21 8M20.5 15a9 9 0 0 1-14.9 3.4L3 16"/></svg>
      </button>
      <button class="icon-btn" id="doc-settings" aria-label="Einstellungen">
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
             stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/>
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.1a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>
      </button>
    </div>`;

  /* Der Code steht ganz oben und ist mit einem Griff kopiert — er wird
     im Sprechzimmer weitergegeben, nicht gesucht. */
  const body = `
    ${patientsError ? `<div class="flag"><span class="tx"><b>Laden fehlgeschlagen</b>${esc(patientsError)}</span></div>` : ""}
    ${!ctx.auth.currentUser?.emailVerified ? `<div class="flag"><span class="tx"><b>E-Mail noch nicht bestätigt</b>
      Bitte bestätige deine Adresse und klicke anschließend auf Aktualisieren.</span></div>
      <button class="btn btn-glass btn-sm" id="doc-verify">Bestätigungslink senden</button>` : ""}
    ${practice?.verified !== true ? `<div class="flag"><span class="dot"></span>
      <span class="tx"><b>Praxisprüfung ausstehend</b>
      Der Praxiszugang wird erst nach einer Identitätsprüfung freigeschaltet.</span></div>` : ""}
    <button class="code-card" id="doc-code">
      <span class="tx">
        <span class="eyebrow">Praxiscode</span>
        <b>${esc(practice?.code || "—")}</b>
      </span>
      <span class="cp">${ICON.check} Kopieren</span>
    </button>

    <div class="doc-stats">
      <div class="stat"><span class="eyebrow">Patienten</span><b>${patients.length}</b></div>
      <div class="stat"><span class="eyebrow">Auffällig</span>
        <b style="color:${alerts ? "var(--lvl-high)" : "var(--lvl-low)"}">${alerts}</b></div>
    </div>

    ${patients.length ? `
      <p class="group-label" style="margin-top:24px">Verknüpfte Patienten</p>
      ${patients.map(p => patientRow(p)).join("")}
    ` : patientsError ? "" : `
      <div class="glass card" style="margin-top:24px">
        <h3>Noch keine Patienten verknüpft</h3>
        <p class="sub" style="margin-top:8px">Gib deinen Code
          <b>${esc(practice?.code || "")}</b> an eine Patientin oder einen
          Patienten weiter. Sobald der Code in deren App unter Einstellungen →
          Praxis eingetragen ist, erscheint der Verlauf hier.</p>
      </div>`}

    <div class="disclaimer">
      ${ICON.info}
      <p>Die Werte stammen aus einer Patienten-App, die Abweichungen von
         individuellen Ausgangswerten misst. Keine Diagnose; die Stufen sind nicht klinisch validiert.</p>
    </div>`;

  $("#doc-body").innerHTML = body;

  $("#doc-refresh").onclick = async () => {
    try {
      await ctx.auth.currentUser?.reload?.();
      if (!DEMO_MODE) await ctx.auth.currentUser?.getIdToken(true);
      await loadPractice(ctx.db,ctx.auth.currentUser.uid);
      const ok = await loadPatients(); renderDoctorHome();
      ctx.ui.toast(ok ? "Aktualisiert." : "Zugriff oder Verbindung bitte prüfen.");
    } catch { ctx.ui.toast("Aktualisieren fehlgeschlagen."); }
  };
  const verify = $("#doc-verify");
  if (verify) verify.onclick = () => sendEmailVerification(ctx.auth.currentUser)
    .then(() => ctx.ui.toast("Bestätigungslink versendet."))
    .catch(() => ctx.ui.toast("Link konnte nicht versendet werden."));
  $("#doc-settings").onclick = openDoctorSettings;
  $("#doc-code").onclick = async () => {
    try { await navigator.clipboard.writeText(practice.code); ctx.ui.toast("Code kopiert."); }
    catch { ctx.ui.toast(practice.code); }
  };
  $$(".pat-row").forEach(el => el.onclick = () => openPatient(el.dataset.uid));
}

/* Die Liste zeigt die Stufe, weil der interne Index keine klinisch
   validierte Wahrscheinlichkeit ist. */
function patientRow(p){
  const r = p.lastRisk;
  const lvl = p.condition === "ra" ? (r?.level || "nodata") : "unsupported";
  const cond = CONDITIONS.find(c => c.id === p.condition)?.n || p.conditionName || "—";
  const drivers = (r?.drivers || []).map(id => SIGNALS[id]?.label).filter(Boolean).slice(0,2).join(", ");
  return `
    <button class="pat-row" data-uid="${esc(p.uid)}">
      <span class="dot" style="background:${LEVELS[lvl]?.color || "#7C879B"}"></span>
      <span class="tx">
        <b>${esc(p.linkName || p.uid.slice(0,6))}</b>
        <span>${esc(cond)}${drivers ? ` · ${esc(drivers)}` : ""}</span>
        ${r?.date ? `<span class="ago">Stand ${esc(fmtDate(r.date))}</span>` : ""}
      </span>
      <span class="val" style="color:${LEVELS[lvl]?.color || "#7C879B"}">
        ${esc(LEVEL_TEXT[lvl] || "—")}
      </span>
    </button>`;
}

const MO = ["Jan","Feb","Mär","Apr","Mai","Jun","Jul","Aug","Sep","Okt","Nov","Dez"];
function fmtDate(key){
  const d = new Date(`${key}T12:00:00`);
  if (isNaN(d)) return key;
  const today = dateToKey(new Date());
  if (key === today) return "heute";
  return `${d.getDate()}. ${MO[d.getMonth()]}`;
}

/* ─────────────────  5. PATIENT IM DETAIL  ─────────────────
   Erst hier werden die Tage geladen. Die Übersicht soll auch bei
   dreißig Patienten in einem Rutsch stehen. */

async function openPatient(uid){
  const p = patients.find(x => x.uid === uid);
  if (!p) return;

  ctx.ui.openSheet(p.linkName || "Patient", `<div class="analyzing"><span class="spin"></span>
    Verlauf wird geladen …</div>`);

  let days = [];
  try {
    const snap = await getDocs(query(collection(ctx.db, "users", uid, "days"),
      where(documentId(), ">=", shiftKey(dateToKey(new Date()),-90))));
    snap.forEach(d => days.push({ key:d.id, ...d.data() }));
    days.sort((a,b) => a.key.localeCompare(b.key));
  } catch {
    return ctx.ui.openSheet(p.linkName || "Patient", `
      <p class="empty">Der Verlauf konnte nicht geladen werden. Möglicherweise
        wurde die Verknüpfung gelöst.</p>`);
  }

  const today = dateToKey(new Date());
  const assessed = assess(days, today, assess(days, shift(today, -1)));
  const r = p.condition === "ra" ? assessed :
    { ...assessed, level:"unsupported", prob:null, drivers:[] };
  const series = assessSeries(days, lastKeys(today, 30));
  const last = days[days.length - 1];

  const cond = CONDITIONS.find(c => c.id === p.condition)?.n || p.conditionName || "—";
  const meds = (p.drugs || []).map(id => DRUGS.find(d => d.id === id)).filter(Boolean);
  const joints = (p.joints || []).map(id => JOINTS.find(j => j.id === id)?.n).filter(Boolean);

  ctx.ui.openSheet(p.linkName || "Patient", `
    <div class="glass card" style="margin-bottom:16px">
      <p class="eyebrow">Veränderung gegenüber der Baseline</p>
      <h2 style="color:${LEVELS[r.level]?.color};margin-top:6px">
        ${LEVEL_TEXT[r.level]}</h2>
      <p class="sub">${esc(cond)}${joints.length ? ` · ${esc(joints.slice(0,3).join(", "))}` : ""}</p>
      ${p.condition !== "ra" ? `<p class="note">Diese Erkrankung ist für die Einstufung
        nicht geprüft. Erkrankungsspezifische Symptome werden nicht vollständig berücksichtigt.</p>` : ""}
      ${r.prob != null ? `<p class="sub" style="margin-top:6px;font-size:13.5px">
        Grundlage: ${r.baselineDays} Vergleichstage. Die Stufe ist nicht klinisch validiert.</p>` : ""}
    </div>

    ${p.condition === "ra" ? sparkline(series) : ""}

    ${r.drivers?.length ? `
      <p class="group-label">Abweichungen von der Baseline</p>
      <div class="glass drv">
        ${r.drivers.map(d => `
          <div class="drv-item">
            <span class="tx"><b>${esc(SIGNALS[d.id].label)}</b>
              <span>Baseline ${fmt(d.id, d.baseline)} · aktuell ${fmt(d.id, d.value)}</span></span>
            <span class="val">${deltaText(d.id, d)}</span>
          </div>`).join("")}
      </div>` : `
      <div class="glass card"><p class="sub">${r.prob == null
        ? "Für diesen Tag ist keine Einstufung verfügbar." : "Keine auffälligen Abweichungen in den erfassten Kennzahlen."}</p></div>`}

    ${meds.length ? `
      <p class="group-label">Medikation</p>
      <div class="glass drv">
        ${meds.map(m => `
          <div class="drv-item">
            <span class="tx"><b>${esc(m.n)}</b>
              <span>${esc(m.g)}</span></span>
          </div>`).join("")}
      </div>` : ""}

    ${followUpBlock(last)}
    ${labBlock(days)}
    ${photoBlock(days)}

    <div class="disclaimer">
      ${ICON.info}
      <p>Patientenangaben und Wearable-Werte, keine erhobenen Befunde. Die
         Einstufung beruht auf nicht validierten Schwellenwerten.</p>
    </div>`);
}

const shift = shiftKey;

function fmt(id, v){
  if (!Number.isFinite(v)) return "—";
  const S = SIGNALS[id];
  if (id === "steps") return Math.round(v).toLocaleString("de-DE");
  if (id === "temp")  return `${v.toFixed(2).replace(".", ",")} ${S.unit}`;
  if (id === "sleep") return `${v.toFixed(1).replace(".", ",")} ${S.unit}`;
  return `${Math.round(v)}${S.unit.startsWith("/") ? S.unit : " " + S.unit}`;
}

/* Verlaufskurve. Lücken bleiben Lücken — eine durchgezogene Linie über
   nicht erfasste Tage würde Daten vortäuschen, die es nicht gibt. */
function sparkline(series){
  const pts = series.map(s => s.prob);
  if (pts.filter(p => p != null).length < 2) return "";
  const W = 320, H = 110, pad = 6;
  const x = i => pad + (i / (pts.length - 1)) * (W - 2*pad);
  const y = p => H - pad - p * (H - 2*pad);

  const segs = []; let cur = [];
  pts.forEach((p, i) => {
    if (p == null){ if (cur.length > 1) segs.push(cur); cur = []; return; }
    cur.push([x(i), y(p)]);
  });
  if (cur.length > 1) segs.push(cur);
  const path = segs.map(s => "M" + s.map(([a,b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join("L")).join(" ");
  const dots = series.map((s, i) => s.prob == null ? "" :
    `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(s.prob).toFixed(1)}" r="3"
       fill="${LEVELS[s.level]?.color || "#7C879B"}"/>`).join("");

  return `
    <p class="group-label">Risiko der letzten 30 Tage</p>
    <div class="chart" style="height:130px">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <rect class="band-hi" x="0" y="${y(1)}" width="${W}" height="${y(GATES.high)-y(1)}"/>
        <rect class="band-el" x="0" y="${y(GATES.high)}" width="${W}" height="${y(GATES.elevated)-y(GATES.high)}"/>
        <path class="line" d="${path}"/>${dots}
      </svg>
    </div>
    <div class="chart-legend"><span>vor 30 Tagen</span><span>heute</span></div>`;
}

function followUpBlock(day){
  const fu = day?.followUp;
  if (!fu?.answers?.length) return "";
  return `
    <p class="group-label">Gezielte Nachfragen</p>
    ${fu.urgent ? `<div class="flag"><span class="tx"><b>Dringlichkeitshinweis</b>${esc(fu.urgent)}</span></div>` : ""}
    <div class="glass drv">
      ${fu.answers.map(a => `
        <div class="drv-item">
          <span class="tx"><b style="font-weight:600;font-size:14px">${esc(a.q)}</b></span>
          <span class="val" style="color:${a.hit ? "var(--lvl-high)" : "var(--ink-3)"}">
            ${a.a === "yes" ? "Ja" : a.a === "no" ? "Nein" : "?"}</span>
        </div>`).join("")}
      ${fu.note ? `<div class="drv-item"><span class="tx">
        <b style="font-weight:600;font-size:14px">Ergänzung</b>
        <span>${esc(fu.note)}</span></span></div>` : ""}
    </div>`;
}

function labBlock(days){
  const out = {};
  for (let i = days.length - 1; i >= 0; i--){
    const l = days[i].labs;
    if (!l) continue;
    for (const [k, v] of Object.entries(l))
      if (out[k] === undefined && Number.isFinite(v)) out[k] = { v, date:days[i].key };
  }
  const keys = Object.keys(out);
  if (!keys.length) return "";
  return `
    <p class="group-label">Zuletzt eingetragene Laborwerte</p>
    <div class="glass drv">
      ${keys.map(k => {
        const def = LABS.find(x => x.id === k);
        return `<div class="drv-item">
          <span class="tx"><b>${esc(def?.n || k)}</b><span>${esc(fmtDate(out[k].date))}</span></span>
          <span class="val" style="color:var(--ink)">${out[k].v} ${esc(def?.unit || "")}</span>
        </div>`;
      }).join("")}
    </div>`;
}

function photoBlock(days){
  const shots = [];
  for (let i = days.length - 1; i >= 0 && shots.length < 3; i--)
    for (const ph of (days[i].photos || [])) shots.push({ ...ph, key:days[i].key });
  if (!shots.length) return "";
  return `
    <p class="group-label">Fotodokumentation</p>
    <div class="glass drv">
      ${shots.map(s => `
        <div class="drv-item">
          <span class="tx">
            <b>${esc(JOINTS.find(j => j.id === s.region)?.n || s.region)}</b>
            <span>${esc(fmtDate(s.key))} · ${esc((s.findings || []).map(f => `${f.feature}: ${f.value}`).join("; ").slice(0, 120))}</span>
          </span>
        </div>`).join("")}
    </div>`;
}

/* ─────────────────  7. EINSTELLUNGEN  ───────────────── */

function openDoctorSettings(){
  const rows = FIELDS.map(f => `
    <div class="field">
      <label for="ds-${f.k}">${esc(f.l)}</label>
      <input id="ds-${f.k}" type="text" value="${esc(practice?.[f.k] || "")}">
    </div>`).join("");

  ctx.ui.openSheet("Praxis", `
    <div class="glass card" style="margin-bottom:18px">
      <p class="eyebrow">Praxiscode</p>
      <h2 style="margin-top:6px;letter-spacing:.06em">${esc(practice?.code || "—")}</h2>
      <p class="sub" style="margin-top:6px">Bleibt dauerhaft gleich. Patienten
        tragen ihn in ihrer App unter Einstellungen → Praxis ein.</p>
    </div>
    <p class="hint" style="margin-bottom:16px">Änderungen an den Praxisdaten
      erfordern eine erneute Prüfung. Bis zur Freigabe ist der Patientenzugriff gesperrt.</p>
    ${rows}`, `
    <button class="btn btn-primary" id="ds-save">Speichern</button>
    <button class="btn btn-glass btn-sm" id="ds-out">Abmelden</button>`);

  $("#ds-save").onclick = async () => {
    $("#ds-save").disabled = true;
    const next = { ...practice };
    for (const f of FIELDS) next[f.k] = $(`#ds-${f.k}`).value.trim();
    if (!FIELDS.some(f => next[f.k] !== (practice?.[f.k] || ""))){
      ctx.ui.closeSheet();
      return;
    }
    next.verified = false;
    next.verifiedAt = null;
    next.verifiedBy = null;
    try {
      await setDoc(doc(ctx.db, "doctors", ctx.auth.currentUser.uid), next, { merge:true });
      practice = next;
      patients = [];
      await openDoctorHome();
      ctx.ui.closeSheet();
      ctx.ui.toast("Gespeichert.");
    } catch { $("#ds-save").disabled = false; ctx.ui.toast("Speichern fehlgeschlagen."); }
  };
  $("#ds-out").onclick = () => ctx.onSignOut?.();
}
