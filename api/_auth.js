import { adminAuth, adminDb } from "./_firebase.js";

const DAY_LIMIT = { assess:20, photo:10, report:10, advice:20 };
const BODY_LIMIT = { photo:1_500_000 };

export async function authorize(req, res, purpose, body){
  const token = /^Bearer (\S+)$/i.exec(req.headers?.authorization || "")?.[1];
  if (!token){ res.status(401).json({ error:"unauthorized" }); return null; }

  try {
    const claims = await adminAuth().verifyIdToken(token, true);
    const db = adminDb();
    if (purpose === "advice"){
      if (claims.email_verified !== true){
        res.status(403).json({ error:"email_verification_required" });
        return null;
      }
      const doctor = await db.collection("doctors").doc(claims.uid).get();
      if (!doctor.exists || doctor.data().verified !== true){
        res.status(403).json({ error:"practice_not_verified" });
        return null;
      }
    } else {
      const patient = await db.collection("users").doc(claims.uid).get();
      if (!patient.exists || !patient.data().onboarded){
        res.status(403).json({ error:"patient_account_required" });
        return null;
      }
      if (patient.data().consentShare !== true){
        res.status(403).json({ error:"ai_consent_required" });
        return null;
      }
      if (["assess", "report"].includes(purpose) && patient.data().condition !== "ra"){
        res.status(403).json({ error:"condition_not_supported" });
        return null;
      }
    }

    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (bytes > (BODY_LIMIT[purpose] || 65_536)){
      res.status(413).json({ error:"request_too_large" });
      return null;
    }

    const date = new Date().toISOString().slice(0,10);
    const ref = db.collection("apiUsage").doc(claims.uid)
      .collection("days").doc(date);
    const allowed = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const count = snap.data()?.[purpose] || 0;
      if (count >= DAY_LIMIT[purpose]) return false;
      tx.set(ref, { [purpose]: count + 1 }, { merge:true });
      return true;
    });
    if (!allowed){ res.status(429).json({ error:"daily_limit_reached" }); return null; }
    return { uid:claims.uid, db };
  } catch (error){
    if (error?.code?.startsWith("auth/"))
      res.status(401).json({ error:"unauthorized" });
    else {
      console.error("API authorization unavailable", error);
      res.status(503).json({ error:"authorization_unavailable" });
    }
    return null;
  }
}
