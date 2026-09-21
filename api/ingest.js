import { createHash } from "node:crypto";
import { FieldPath } from "firebase-admin/firestore";
import { readBody } from "./_claude.js";
import { adminDb } from "./_firebase.js";
import { assess, shiftKey } from "../risk.js";
import { applyRiskCatalog } from "./_risk_catalog.js";

export const config = { maxDuration:20 };

const FIELDS = {
  rhr:{ min:30, max:140 }, hrv:{ min:5, max:250 },
  steps:{ min:0, max:60000 }, sleep:{ min:1, max:16 },
  temp:{ min:28, max:40 }
};

function normalizeDate(value){
  if (!value) return new Date().toISOString().slice(0,10);
  const text = String(value).trim();
  const german = text.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  const iso = german
    ? `${german[3]}-${german[2].padStart(2,"0")}-${german[1].padStart(2,"0")}`
    : text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0,10) !== iso
    ? null : iso;
}

function toNumber(value){
  if (value == null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export default async function handler(req, res){
  if (req.method === "GET")
    return res.status(200).json({ endpoint:"ingest", available:Boolean(process.env.FIREBASE_SERVICE_ACCOUNT) });
  if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

  try {
    const body = await readBody(req);
    if (!body || typeof body !== "object")
      return res.status(400).json({ error:"bad_body" });
    if (Buffer.byteLength(JSON.stringify(body)) > 8192)
      return res.status(413).json({ error:"request_too_large" });
    const token = String(body.token || "").trim();
    if (!/^[0-9a-f]{32}$/.test(token))
      return res.status(401).json({ error:"bad_token" });

    const hash = createHash("sha256").update(token).digest("hex");
    const db = adminDb();
    const tokenRef = db.collection("ingestTokens").doc(hash);
    const tokenDoc = await tokenRef.get();
    if (!tokenDoc.exists)
      return res.status(401).json({ error:"unknown_token" });

    const dayKey = normalizeDate(body.date);
    const today = new Date().toISOString().slice(0,10);
    if (!dayKey || dayKey < shiftKey(today,-30) || dayKey > shiftKey(today,1))
      return res.status(400).json({ error:"date_out_of_range" });

    const patch = {};
    const rejected = [];
    for (const [key, range] of Object.entries(FIELDS)){
      const number = toNumber(body[key]);
      if (number == null) continue;
      if (number < range.min || number > range.max){ rejected.push(key); continue; }
      patch[key] = number;
    }
    if (!Object.keys(patch).length)
      return res.status(400).json({ error:"no_values", rejected });
    patch.vitalsSource = "shortcut";
    patch.vitalsAt = new Date().toISOString();

    const uid = tokenDoc.data().uid;
    const userRef = db.collection("users").doc(uid);
    const daysRef = userRef.collection("days");
    await db.runTransaction(async tx => {
      const [currentToken, user, history, catalog] = await Promise.all([
        tx.get(tokenRef), tx.get(userRef),
        tx.get(daysRef.where(FieldPath.documentId(), ">=", shiftKey(dayKey,-65))
          .where(FieldPath.documentId(), "<=", dayKey)),
        tx.get(db.collection("config").doc("catalog"))
      ]);
      if (!currentToken.exists || currentToken.data().uid !== uid || !user.exists)
        throw new Error("token_revoked");
      const days = history.docs.map(d => ({ key:d.id, ...d.data() }));
      const previousDay = days.find(d => d.key === dayKey) || { key:dayKey };
      const updated = { ...previousDay, ...patch };
      const index = days.findIndex(d => d.key === dayKey);
      if (index >= 0) days[index] = updated; else days.push(updated);
      const modelVersion = applyRiskCatalog(catalog.data());
      const assessed = assess(days, dayKey, assess(days, shiftKey(dayKey,-1)));
      const risk = user.data().condition === "ra" ? assessed :
        { ...assessed, level:"unsupported", prob:null, drivers:[] };
      const summary = risk.prob == null ? null : {
        modelVersion,
        level:risk.level, prob:Math.round(risk.prob*1000)/1000,
        raw:Math.round(risk.raw*1000)/1000,
        confidence:Math.round(risk.confidence*100)/100,
        drivers:risk.drivers.slice(0,3).map(d => d.id)
      };
      tx.set(daysRef.doc(dayKey), { ...patch, risk:summary, updatedAt:new Date().toISOString() }, { merge:true });
      if (user.data().doctorUid && dayKey === today){
        tx.set(userRef, { lastRisk:{
          modelVersion,
          level:risk.level, prob:summary?.prob ?? null,
          confidence:summary?.confidence ?? null,
          drivers:summary?.drivers || [], date:dayKey,
          at:new Date().toISOString()
        } }, { merge:true });
      }
    });
    return res.status(200).json({
      ok:true, date:dayKey, stored:Object.keys(patch).filter(key => key in FIELDS), rejected
    });
  } catch (error){
    if (error.message === "token_revoked")
      return res.status(401).json({ error:"unknown_token" });
    console.error("Ingest failed", error);
    return res.status(503).json({ error:"ingest_unavailable" });
  }
}
