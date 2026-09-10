/* ══════════════════════════════════════════════════════════════════
   /api/ingest.js — Vercel Serverless Function

   Nimmt die passiven Wearable-Werte entgegen.

   Warum dieser Umweg? Eine Web-App kommt nicht an HealthKit heran —
   das geht nur aus einer nativen iOS-App. Der praktikable Weg für ein
   PWA ist ein Apple-Kurzbefehl, der die Werte morgens ausliest und
   hierher schickt. Einmal eingerichtet, läuft das ohne Zutun.

   Authentifizierung läuft über einen persönlichen Token, den der Nutzer
   in den Einstellungen erzeugt (openIngest in app.js). Firebase-Auth
   scheidet aus: ein Kurzbefehl kann sich nicht anmelden.

   ▸ VORAUSSETZUNG: die Umgebungsvariable FIREBASE_SERVICE_ACCOUNT mit
     dem JSON eines Dienstkontos. Ohne sie antwortet der Endpunkt mit
     einem klaren Hinweis statt mit einem Absturz. Details in der README.

   Health-Check: /api/ingest im Browser aufrufen.
   ══════════════════════════════════════════════════════════════════ */

import { readBody } from "./_claude.js";

export const config = { maxDuration: 20 };

/* Was übernommen werden darf, mit plausiblen Grenzen. Ein Kurzbefehl
   liefert gelegentlich Unsinn — etwa eine Schlafdauer von 0, wenn die
   Uhr nachts nicht getragen wurde. Solche Werte dürfen nicht in die
   Baseline laufen, sonst verschiebt sich das Normal nach unten und ein
   echter Einbruch fällt später nicht mehr auf. */
const FIELDS = {
  rhr:   { min:30, max:140 },
  hrv:   { min:5,  max:250 },
  steps: { min:0,  max:60000 },
  sleep: { min:1,  max:16 },     // unter 1 h ist keine Messung, sondern eine Lücke
  temp:  { min:28, max:40 }
};

/* ── Firebase Admin ──
   Lazy geladen: der Health-Check soll auch ohne Dienstkonto antworten
   können, damit man beim Einrichten sieht, was noch fehlt. */
let adminDb = null;
async function getDb(){
  if (adminDb) return adminDb;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("missing_service_account");

  let creds;
  try { creds = JSON.parse(raw); }
  catch { throw new Error("bad_service_account"); }

  /* Beim Kopieren durch die Vercel-Oberfläche werden Zeilenumbrüche im
     privaten Schlüssel oft zu \n-Literalen. Das hier repariert das. */
  if (typeof creds.private_key === "string")
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");

  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");

  const app = getApps().length ? getApps()[0] : initializeApp({ credential: cert(creds) });
  adminDb = getFirestore(app);
  return adminDb;
}

/* Datum normalisieren. Ein Kurzbefehl liefert je nach Gebietsschema
   sehr unterschiedliche Formate. */
function normalizeDate(v){
  if (!v) return new Date().toISOString().slice(0,10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 24.09.2026 oder 24/09/2026
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  const d = new Date(s);
  return isNaN(d) ? new Date().toISOString().slice(0,10) : d.toISOString().slice(0,10);
}

function toNum(v){
  if (v == null || v === "") return null;
  // Kurzbefehle liefern Zahlen gern als Text, teils mit Komma
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export default async function handler(req, res){
  try {
    if (req.method === "GET"){
      return res.status(200).json({
        endpoint:"ingest",
        function_reachable:true,
        service_account_present: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT),
        accepts: Object.keys(FIELDS),
        node: process.version
      });
    }
    if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

    const body = await readBody(req);
    if (!body) return res.status(400).json({ error:"bad_body",
      message:"Anfrage konnte nicht gelesen werden." });

    const token = String(body.token || "").trim();
    if (!token || token.length < 16)
      return res.status(401).json({ error:"bad_token", message:"Kein gültiger Schlüssel." });

    let db;
    try { db = await getDb(); }
    catch (e){
      const missing = e.message === "missing_service_account";
      return res.status(500).json({
        error: e.message,
        message: missing
          ? "FIREBASE_SERVICE_ACCOUNT ist nicht gesetzt. Dienstkonto-JSON in Vercel " +
            "unter Settings → Environment Variables hinterlegen und neu deployen."
          : "FIREBASE_SERVICE_ACCOUNT enthält kein gültiges JSON."
      });
    }

    /* Nutzer über den Token finden. Gleichheitsabfrage auf einem Feld —
       dafür braucht Firestore keinen zusammengesetzten Index. */
    const snap = await db.collection("users").where("ingestToken", "==", token).limit(1).get();
    if (snap.empty)
      return res.status(401).json({ error:"unknown_token",
        message:"Dieser Schlüssel gehört zu keinem Konto." });

    const uid = snap.docs[0].id;
    const dayKey = normalizeDate(body.date);

    /* Werte prüfen. Unplausibles wird verworfen, nicht gerundet — ein
       stillschweigend zurechtgebogener Messwert wäre schlimmer als ein
       fehlender. */
    const patch = {};
    const rejected = [];
    for (const [k, range] of Object.entries(FIELDS)){
      const v = toNum(body[k]);
      if (v == null) continue;
      if (v < range.min || v > range.max){ rejected.push(k); continue; }
      patch[k] = v;
    }

    if (!Object.keys(patch).length){
      return res.status(400).json({ error:"no_values",
        message:"Keine übernehmbaren Werte in der Anfrage.",
        rejected });
    }

    patch.vitalsSource = "shortcut";
    patch.vitalsAt = new Date().toISOString();

    /* merge, damit der Tages-Check des Nutzers nicht überschrieben wird.
       Der Kurzbefehl liefert nur die passiven Werte. */
    await db.collection("users").doc(uid)
      .collection("days").doc(dayKey)
      .set(patch, { merge:true });

    return res.status(200).json({
      ok:true, date:dayKey, stored:Object.keys(patch).filter(k => k in FIELDS), rejected
    });

  } catch (e){
    console.error("UNHANDLED FUNCTION ERROR", e);
    return res.status(500).json({
      error:"internal_function_error",
      message:String(e?.message || e)
    });
  }
}
