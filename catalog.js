/* ══════════════════════════════════════════════════════════════════
   CLAM — Katalog

   Alles, worauf die Berechnung fußt, steht als Vorgabe im Code
   (data.js und risk.js). Diese Datei legt einen in Firestore
   gepflegten Katalog darüber, damit Admins Erkrankungen, Wirkstoffe,
   Signale, Gewichte und Schwellen ändern können, ohne dass jemand
   deployen muss.

   Kernentscheidung: die Vorgaben werden AN ORT UND STELLE überschrieben.
   CONDITIONS, DRUGS, SIGNALS, WEIGHTS und die übrigen Strukturen bleiben
   dieselben Objekte, nur ihr Inhalt wechselt. Dadurch funktioniert jeder
   bestehende Import unverändert weiter — sonst müsste jede Fundstelle in
   app.js auf einen Getter umgestellt werden, und genau dort schleichen
   sich stille Fehler ein.

   Fällt Firestore aus oder ist noch kein Katalog angelegt, läuft die App
   auf den Vorgaben aus dem Code. Es gibt also keinen Zustand, in dem sie
   ohne Stammdaten dasteht.
   ══════════════════════════════════════════════════════════════════ */

import {
  doc, getDoc, setDoc, writeBatch
} from "./backend.js";

import {
  CONDITIONS, JOINTS, DRUGS, WEARABLES, LABS, CHECKS, STIFF_STEPS, VITALS
} from "./data.js";
import { SIGNALS, SIGNAL_IDS, WEIGHTS, GATES } from "./risk.js";

/* ─────────────────  1. TABELLEN  ─────────────────
   Beschreibt jede pflegbare Tabelle einmal: woher sie kommt, wie sie
   aussieht und welche Spalten sie hat. Der Editor und der Excel-Austausch
   arbeiten beide gegen diese Beschreibung — dadurch gibt es keine zweite
   Stelle, die bei einer neuen Spalte nachgezogen werden müsste.

   shape:
     "list" — ein Array von Zeilen, id-Spalte im Datensatz
     "map"  — ein Objekt id → Datensatz, id wird beim Lesen zur Spalte
     "pairs"— ein Objekt Schlüssel → Zahl, wird zu zwei Spalten

   type je Spalte:
     text | num | bool | ids (Liste von Kennungen, kommagetrennt) */

export const TABLES = [
  {
    id:"conditions", label:"Erkrankungen", shape:"list", target:CONDITIONS,
    hint:"Bestimmt, welche Beschwerden der Tages-Check abfragt und welche Regionen vorgeschlagen werden.",
    cols:[
      { key:"id",     label:"Kennung",   type:"text", req:true },
      { key:"n",      label:"Name",      type:"text", req:true },
      { key:"s",      label:"Untertitel",type:"text" },
      { key:"pro",    label:"Tages-Check", type:"ids",
        help:"Kennungen aus der Tabelle Tages-Check, z. B. pain,stiff,fatigue,global" },
      { key:"photo",  label:"Fotos sinnvoll", type:"bool" },
      { key:"joints", label:"Regionen",  type:"ids",
        help:"Kennungen aus der Tabelle Körperregionen" }
    ]
  },
  {
    id:"drugs", label:"Medikamente", shape:"list", target:DRUGS,
    hint:"tdm steuert nur, ob passende Laborwerte nachgetragen werden können.",
    cols:[
      { key:"id",    label:"Kennung", type:"text", req:true },
      { key:"n",     label:"Name",    type:"text", req:true },
      { key:"g",     label:"Gruppe",  type:"text" },
      { key:"tdm",   label:"Spiegel etabliert", type:"bool" },
      { key:"ada",   label:"Antikörper relevant", type:"bool" },
      { key:"every", label:"Intervall in Tagen", type:"num" }
    ]
  },
  {
    id:"signals", label:"Signale", shape:"map", target:SIGNALS,
    hint:"Die Kennzahlen, aus denen das Risiko entsteht. dir +1 heißt: ein Anstieg ist ungünstig, −1 heißt: ein Abfall ist ungünstig.",
    cols:[
      { key:"id",     label:"Kennung", type:"text", req:true },
      { key:"label",  label:"Anzeigename", type:"text", req:true },
      { key:"src",    label:"Quelle",  type:"text", help:"wear = Wearable, pro = Selbstauskunft" },
      { key:"dir",    label:"Richtung", type:"num", help:"+1 oder −1" },
      { key:"unit",   label:"Einheit", type:"text" },
      { key:"dec",    label:"Nachkommastellen", type:"num" },
      { key:"floor",  label:"Relevanzschwelle", type:"num",
        help:"Kleinste absolute Änderung, die überhaupt zählt" },
      { key:"minMad", label:"Mindeststreuung", type:"num",
        help:"Untergrenze der Streuung, schützt vor Division durch fast null" }
    ]
  },
  {
    id:"weights", label:"Gewichte", shape:"pairs", target:WEIGHTS,
    keyLabel:"Signal", valLabel:"Gewicht",
    hint:"Relatives Gewicht jedes Signals im Gesamtscore. Nur Signale mit Daten gehen an dem Tag ein."
  },
  {
    id:"gates", label:"Schwellen", shape:"pairs", target:GATES,
    keyLabel:"Stellschraube", valLabel:"Wert",
    hint:"Baselinelänge, Versatz, Kappung und die Grenzen der drei Risikostufen. Änderungen wirken sofort auf alle Nutzer."
  },
  {
    id:"labs", label:"Laborwerte", shape:"list", target:LABS,
    hint:"Werte aus der Praxis. Gehen nicht in den Score ein, stehen aber im Bericht.",
    cols:[
      { key:"id",   label:"Kennung", type:"text", req:true },
      { key:"n",    label:"Name",    type:"text", req:true },
      { key:"unit", label:"Einheit", type:"text" },
      { key:"step", label:"Schrittweite", type:"num" },
      { key:"hint", label:"Hinweis",  type:"text" }
    ]
  },
  {
    id:"checks", label:"Tages-Check", shape:"list", target:CHECKS,
    hint:"Die Fragen der täglichen Selbstauskunft. kind bestimmt die Eingabeart.",
    cols:[
      { key:"id",   label:"Kennung", type:"text", req:true },
      { key:"n",    label:"Frage",   type:"text", req:true },
      { key:"kind", label:"Art",     type:"text", help:"scale, minutes oder count" },
      { key:"lo",   label:"Skala unten", type:"text" },
      { key:"hi",   label:"Skala oben",  type:"text" },
      { key:"hint", label:"Hinweis", type:"text" }
    ]
  },
  {
    id:"vitals", label:"Vitalwerte", shape:"list", target:VITALS,
    hint:"Die Felder der manuellen Eingabe samt Plausibilitätsgrenzen.",
    cols:[
      { key:"id",   label:"Kennung", type:"text", req:true },
      { key:"n",    label:"Name",    type:"text", req:true },
      { key:"unit", label:"Einheit", type:"text" },
      { key:"step", label:"Schrittweite", type:"num" },
      { key:"min",  label:"Minimum", type:"num" },
      { key:"max",  label:"Maximum", type:"num" },
      { key:"ph",   label:"Platzhalter", type:"text" }
    ]
  },
  {
    id:"joints", label:"Körperregionen", shape:"list", target:JOINTS,
    cols:[
      { key:"id", label:"Kennung", type:"text", req:true },
      { key:"n",  label:"Name",    type:"text", req:true },
      { key:"g",  label:"Gruppe",  type:"text" }
    ]
  },
  {
    id:"wearables", label:"Wearables", shape:"list", target:WEARABLES,
    hint:"signals bestimmt, welche Kacheln die App überhaupt erwartet.",
    cols:[
      { key:"id",      label:"Kennung", type:"text", req:true },
      { key:"n",       label:"Name",    type:"text", req:true },
      { key:"s",       label:"Untertitel", type:"text" },
      { key:"signals", label:"Signale", type:"ids",
        help:"Kennungen aus der Tabelle Signale" }
    ]
  },
  {
    id:"stiffSteps", label:"Steifigkeitsstufen", shape:"list", target:STIFF_STEPS,
    hint:"Auswahlstufen der Morgensteifigkeit. Gespeichert wird die Minutenzahl.",
    cols:[
      { key:"v", label:"Minuten", type:"num", req:true },
      { key:"n", label:"Beschriftung", type:"text", req:true }
    ]
  }
];

export const tableById = id => TABLES.find(t => t.id === id);

/* ─────────────────  2. VORGABEN SICHERN  ─────────────────
   Tiefe Kopie der eingebauten Werte, bevor irgendein Katalog darüber
   gelegt wird. Grundlage für "auf Vorgabe zurücksetzen" und dafür,
   nur echte Abweichungen zu speichern. */
const DEFAULTS = {};
for (const t of TABLES) DEFAULTS[t.id] = structuredClone(readTable(t));

export const defaultsFor = id => structuredClone(DEFAULTS[id]);

/* ─────────────────  3. LESEN  ─────────────────
   Liefert eine Tabelle als flaches Array von Zeilen — unabhängig davon,
   ob sie im Code als Liste, als Objekt oder als Zahlenpaare vorliegt. */

export function readTable(t){
  if (t.shape === "list") return structuredClone(t.target);
  if (t.shape === "map")
    return Object.entries(t.target).map(([id, v]) => ({ id, ...structuredClone(v) }));
  // pairs
  return Object.entries(t.target).map(([k, v]) => ({ key:k, value:v }));
}

/* Der gesamte Katalog als einfaches Objekt — für Speichern und Export. */
export function snapshot(){
  const out = {};
  for (const t of TABLES) out[t.id] = readTable(t);
  return out;
}

/* ─────────────────  4. SCHREIBEN  ─────────────────
   An Ort und Stelle, damit alle bestehenden Importe die Änderung sehen. */

function replaceList(target, rows){
  target.length = 0;
  for (const r of rows) target.push(r);
}
function replaceObject(target, obj){
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, obj);
}

export function writeTable(t, rows){
  if (t.shape === "list") return replaceList(t.target, structuredClone(rows));

  if (t.shape === "map"){
    const obj = {};
    for (const r of rows){
      const { id, ...rest } = r;
      if (id) obj[id] = rest;
    }
    replaceObject(t.target, obj);
    /* SIGNAL_IDS wird einmal beim Laden aus SIGNALS abgeleitet und wäre
       danach veraltet. Also mitziehen — ebenfalls an Ort und Stelle. */
    if (t.id === "signals"){
      SIGNAL_IDS.length = 0;
      for (const k of Object.keys(t.target)) SIGNAL_IDS.push(k);
    }
    return;
  }

  // pairs
  const obj = {};
  for (const r of rows) if (r.key) obj[r.key] = Number(r.value);
  replaceObject(t.target, obj);
}

/* Legt einen kompletten Katalog über die Vorgaben. Unbekannte oder
   leere Abschnitte bleiben auf der Vorgabe stehen — ein halb gefülltes
   Dokument darf die App nicht ausräumen. */
export function applyCatalog(cat){
  resetToDefaults();
  if (!cat) return;
  for (const t of TABLES){
    const rows = cat[t.id];
    if (Array.isArray(rows) && rows.length) writeTable(t, rows);
  }
}

/* Zurück auf die eingebauten Vorgaben, ohne Neuladen. */
export function resetToDefaults(){
  for (const t of TABLES) writeTable(t, structuredClone(DEFAULTS[t.id]));
}

/* ─────────────────  5. FIRESTORE  ─────────────────
   Ein einziges Dokument. Die Stammdaten sind zusammen deutlich kleiner
   als ein Foto, und ein Dokument heißt: ein Lesevorgang beim Start und
   keine halb angewandten Zwischenstände. */

const CATALOG_REF = db => doc(db, "config", "catalog");

export async function loadCatalog(db){
  try {
    const snap = await getDoc(CATALOG_REF(db));
    if (!snap.exists()) { resetToDefaults(); return { ok:true, applied:false }; }
    applyCatalog(snap.data());
    return { ok:true, applied:true, meta:{
      version:snap.data().version || snap.data().updatedAt || "legacy",
      updatedAt: snap.data().updatedAt || null,
      updatedBy: snap.data().updatedBy || null
    }};
  } catch (e){
    /* Die aufrufende App stoppt bei einem Fehler, statt stillschweigend
       mit einer anderen Rechengrundlage weiterzumachen. */
    console.warn("Katalog nicht geladen, Vorgaben bleiben aktiv:", e?.message || e);
    return { ok:false, applied:false, error:String(e?.message || e) };
  }
}

export async function saveCatalog(db, email){
  const version = `${Date.now()}-${crypto.randomUUID().slice(0,8)}`;
  const data = { ...snapshot(), version, updatedAt:new Date().toISOString(), updatedBy:email || null };
  const batch = writeBatch(db);
  batch.set(CATALOG_REF(db), data);
  batch.set(doc(db, "catalogVersions", version), data);
  await batch.commit();
  return data;
}

/* ─────────────────  6. PRÜFUNG  ─────────────────
   Läuft vor jedem Speichern und vor jedem Import. Der Katalog trägt die
   Rechengrundlage der ganzen App — eine Tabelle mit doppelten Kennungen
   oder fehlenden Pflichtfeldern würde stillschweigend falsche Ergebnisse
   erzeugen, und das fiele niemandem auf. */

export function validate(t, rows){
  const errs = [];
  if (!Array.isArray(rows) || !rows.length){
    errs.push("Die Tabelle ist leer.");
    return errs;
  }

  if (t.shape === "pairs"){
    const seen = new Set();
    rows.forEach((r, i) => {
      if (!r.key) errs.push(`Zeile ${i+1}: Schlüssel fehlt.`);
      else if (seen.has(r.key)) errs.push(`Zeile ${i+1}: Schlüssel "${r.key}" kommt mehrfach vor.`);
      else seen.add(r.key);
      if (!Number.isFinite(Number(r.value))) errs.push(`Zeile ${i+1}: "${r.value}" ist keine Zahl.`);
    });
    return errs;
  }

  const idKey = t.cols.find(c => c.req && c.type === "text")?.key || "id";
  const seen = new Set();
  rows.forEach((r, i) => {
    for (const c of t.cols){
      const v = r[c.key];
      if (c.req && (v === undefined || v === null || v === "")){
        errs.push(`Zeile ${i+1}: "${c.label}" ist ein Pflichtfeld.`);
      }
      if (c.type === "num" && v !== undefined && v !== null && v !== "" && !Number.isFinite(Number(v))){
        errs.push(`Zeile ${i+1}: "${c.label}" ist keine Zahl.`);
      }
    }
    const id = r[idKey];
    if (id !== undefined && id !== ""){
      if (seen.has(id)) errs.push(`Zeile ${i+1}: Kennung "${id}" kommt mehrfach vor.`);
      else seen.add(id);
    }
  });

  /* Querbezüge prüfen: eine Erkrankung, die auf ein nicht existierendes
     Signal zeigt, blendet im Tages-Check stillschweigend eine Frage aus.
     Das ist genau die Sorte Fehler, die man erst Wochen später bemerkt. */
  const refs = {
    conditions: { pro:CHECKS.map(c => c.id), joints:JOINTS.map(j => j.id) },
    wearables:  { signals:Object.keys(SIGNALS) }
  }[t.id];

  if (refs){
    rows.forEach((r, i) => {
      for (const [col, allowed] of Object.entries(refs)){
        const list = Array.isArray(r[col]) ? r[col] : String(r[col] || "").split(",").map(x => x.trim()).filter(Boolean);
        for (const ref of list)
          if (!allowed.includes(ref))
            errs.push(`Zeile ${i+1}: "${ref}" in ${col} gibt es nicht.`);
      }
    });
  }

  return errs;
}

/* ─────────────────  7. ZELLEN UMWANDELN  ─────────────────
   Excel liefert alles als Text oder Zahl; die App braucht echte Typen. */

export function parseCell(col, raw){
  const v = raw === undefined || raw === null ? "" : raw;
  if (col.type === "num"){
    if (v === "") return undefined;
    const n = parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  if (col.type === "bool"){
    const s = String(v).trim().toLowerCase();
    return ["ja","true","1","x","wahr","yes"].includes(s);
  }
  if (col.type === "ids"){
    if (Array.isArray(v)) return v;
    return String(v).split(",").map(x => x.trim()).filter(Boolean);
  }
  return String(v);
}

export function formatCell(col, v){
  if (col.type === "bool") return v ? "ja" : "nein";
  if (col.type === "ids")  return Array.isArray(v) ? v.join(", ") : String(v ?? "");
  return v === undefined || v === null ? "" : v;
}
