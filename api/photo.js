/* ══════════════════════════════════════════════════════════════════
   /api/photo.js — Vercel Serverless Function

   Wertet ein standardisiertes Foto einer betroffenen Körperstelle aus.

   Wichtig ist die Abgrenzung: Das Modell BESCHREIBT, was auf dem Bild
   zu sehen ist — Schwellung, Rötung, Verformung — und vergleicht es mit
   dem Vorbefund. Es beurteilt nicht, ob eine Entzündung vorliegt. Ein
   Foto kann eine geschwollene Fingergrundgelenkreihe zeigen; ob das
   aktiv entzündlich ist, entscheidet die Untersuchung, nicht das Bild.

   Der eigentliche Wert liegt im Vergleich über die Zeit. Deshalb bekommt
   das Modell den letzten Befund derselben Region mitgeliefert.

   Health-Check: /api/photo im Browser aufrufen.
   ══════════════════════════════════════════════════════════════════ */

import { readBody, callClaude, healthCheck, GUARDRAILS } from "./_claude.js";

export const config = { maxDuration: 60 };

const SYSTEM = `Du beschreibst Fotos betroffener Körperstellen für die Verlaufs-
dokumentation bei einer Autoimmunerkrankung.

Deine Aufgabe ist BESCHREIBEN, nicht BEURTEILEN.

Vorgehen:
1. Benenne, was sichtbar ist: Schwellung einzelner Gelenke, Rötung,
   Hautveränderungen, Verformungen, Schonhaltung.
2. Werde konkret. "Schwellung" hilft niemandem. "Mittelgelenke Zeige- und
   Mittelfinger rechts wirken verdickt, Hautfalten über den Knöcheln
   verstrichen" ist eine Beobachtung, mit der man arbeiten kann.
3. Sag ausdrücklich, was du NICHT beurteilen kannst. Wärme und
   Druckschmerz sind auf einem Foto grundsätzlich nicht erkennbar —
   und genau das sind zwei der wichtigsten Entzündungszeichen.
4. Liegt ein Vorbefund vor, ist der Vergleich das Wichtigste: eher mehr,
   eher weniger, oder unverändert? Halte fest, wenn die Aufnahme-
   bedingungen den Vergleich einschränken — anderer Winkel, anderes
   Licht, andere Handhaltung.

Zu "findings": jeder Eintrag ist ein Merkmal ("feature", z. B. "Schwellung
Fingermittelgelenke rechts") mit einer knappen Ausprägung ("value", z. B.
"deutlich" oder "nicht erkennbar"). Drei bis sechs Einträge.

"change" füllst du nur, wenn ein Vorbefund mitgeliefert wurde. Ein kurzer
Vergleich in wenigen Worten, z. B. "etwas ausgeprägter als am 12.08." oder
"unverändert".

"confidence": "hoch" nur bei gut ausgeleuchtetem, scharfem Bild in
passender Perspektive. "niedrig", wenn Licht, Schärfe oder Winkel die
Beurteilung erschweren — und schreibe in "note" dazu, was beim nächsten
Mal besser wäre.

Ist auf dem Bild keine Körperstelle zu erkennen, setzt du "findings" auf
eine leere Liste, "confidence" auf "niedrig" und erklärst das in "note".

"note" ist genau ein kurzer Satz.
${GUARDRAILS}`;

const SCHEMA = {
  type:"object",
  properties:{
    findings:{
      type:"array",
      description:"Drei bis sechs sichtbare Merkmale.",
      items:{
        type:"object",
        properties:{
          feature:{ type:"string", description:"Das Merkmal, konkret und seitenbezogen." },
          value:  { type:"string", description:"Die Ausprägung, knapp." }
        },
        required:["feature","value"],
        additionalProperties:false
      }
    },
    change:{ type:"string",
      description:"Vergleich zum Vorbefund. Leerer String, wenn kein Vorbefund vorlag." },
    confidence:{ type:"string", enum:["hoch","mittel","niedrig"] },
    note:{ type:"string", description:"Ein kurzer Satz zu Einschränkungen der Beurteilbarkeit." }
  },
  required:["findings","change","confidence","note"],
  additionalProperties:false
};

export default async function handler(req, res){
  try {
    if (req.method === "GET")  return healthCheck(res, "photo");
    if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

    const body = await readBody(req);
    if (!body) return res.status(400).json({ error:"bad_body",
      message:"Anfrage konnte nicht gelesen werden." });

    const { image, mime = "image/jpeg", region, condition, previous } = body;
    if (!image) return res.status(400).json({ error:"no_image",
      message:"Es wurde kein Bild übermittelt." });

    const parts = [];
    parts.push(`Körperstelle: ${region || "nicht angegeben"}`);
    if (condition) parts.push(`Erkrankung: ${condition}`);

    if (previous?.findings?.length){
      parts.push("");
      parts.push(`Vorbefund derselben Stelle vom ${previous.date}:`);
      for (const f of previous.findings) parts.push(`· ${f.feature}: ${f.value}`);
      parts.push("");
      parts.push("Beschreibe das aktuelle Bild und vergleiche es mit diesem Vorbefund.");
    } else {
      parts.push("");
      parts.push("Es liegt kein Vorbefund vor. Beschreibe das Bild als Ausgangsaufnahme " +
                 "für spätere Vergleiche und lass \"change\" leer.");
    }

    const out = await callClaude({
      system: SYSTEM,
      content:[
        { type:"image", source:{ type:"base64", media_type:mime, data:image } },
        { type:"text",  text: parts.join("\n") }
      ],
      schema: SCHEMA,
      maxTokens: 1400,
      timeoutMs: 50000
    });

    if (out.error) return res.status(out.status).json(out);
    return res.status(200).json(out.result);

  } catch (e){
    console.error("UNHANDLED FUNCTION ERROR", e);
    return res.status(500).json({
      error:"internal_function_error",
      message:String(e?.message || e),
      stack:String(e?.stack || "").split("\n").slice(0,4).join(" | ")
    });
  }
}
