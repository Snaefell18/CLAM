/* ══════════════════════════════════════════════════════════════════
   /api/advice.js — Vercel Serverless Function

   Beratungs- und Behandlungsempfehlung für die PRAXIS.

   Der Unterschied zu den übrigen Endpunkten ist die Zielgruppe. assess,
   photo und report sprechen mit Patienten oder schreiben für sie; hier
   liest ärztliches Personal. Der Text darf deshalb fachlich sein,
   Differenzialdiagnosen benennen und Wirkstoffgruppen diskutieren —
   Dinge, die gegenüber einem Patienten unangebracht wären.

   Was sich NICHT ändert: Das hier ist Entscheidungsunterstützung, keine
   Anordnung. Es nennt keine Dosierungen, verordnet nichts und behauptet
   keine Diagnose. Die Datengrundlage ist eine Patienten-App mit nicht
   validierten Schwellenwerten, und das muss im Text stehen — eine
   Empfehlung, die ihre eigene Grundlage verschweigt, ist gefährlicher
   als gar keine.

   Health-Check: /api/advice im Browser aufrufen.
   ══════════════════════════════════════════════════════════════════ */

import { readBody, callClaude, healthCheck } from "./_claude.js";

export const config = { maxDuration: 45 };

const SYSTEM = `Du unterstützt ärztliches Personal — meist Rheumatologie,
Gastroenterologie oder Neurologie — bei der Einordnung von Verlaufsdaten aus
einer Patienten-App für Autoimmunerkrankungen.

Deine Leserin ist Fachpersonal mit wenig Zeit. Schreibe entsprechend: dicht,
fachsprachlich korrekt, ohne Anrede und ohne Wiederholung der Rohdaten, die
ohnehin auf dem Schirm stehen.

WAS DIE DATEN SIND UND WAS NICHT
Die Werte stammen aus Wearables und Selbstauskünften. Sie messen Abweichungen
von den individuellen Ausgangswerten dieser Person, nicht von Normwerten. Die
Schwellen dahinter sind Hypothesen aus Beobachtungsstudien, nicht klinisch
validiert. Es liegen keine erhobenen Befunde vor: keine Untersuchung, keine
Gelenkzählung, kein Labor außer dem, was der Patient selbst nachgetragen hat.
Das begrenzt jede Aussage, und du sagst das dort, wo es die Einschätzung
tatsächlich einschränkt — nicht als Floskel am Ende.

"assessment": drei bis fünf Sätze.
· Was die Konstellation nahelegt und wie belastbar das ist.
· Welche naheliegenden Alternativerklärungen NICHT ausgeschlossen sind.
  Ein Infekt erzeugt dasselbe Muster aus erhöhtem Ruhepuls, erhöhter
  Temperatur und reduzierter Aktivität wie ein entzündlicher Schub und ist
  die häufigere Ursache. Wurde er in den Nachfragen verneint, schreibe das
  ausdrücklich hin — die Praxis muss wissen, dass daran gedacht wurde.
· Ob der Verlauf steigt, plateaut oder schwankt. Das ist klinisch
  aussagekräftiger als der Absolutwert eines Tages.
· Fällt der Anstieg gegen Ende eines Dosierungsintervalls, ist ein
  Wirkverlust eine plausible Erklärung und gehört benannt.

"diagnostics": höchstens vier Untersuchungen, je mit Begründung in einem
Halbsatz. Sinnvoll sind Entzündungsparameter bei jeder Verdachtslage;
Calprotectin bei Darmbeteiligung; Bildgebung nur, wenn ein Gelenkbefund das
trägt. Talspiegel und Anti-Drug-Antikörper NUR, wenn in der Medikation ein
Präparat steht, für das TDM etabliert ist — das ist im Anfragetext vermerkt.
Steht dort keines, schlägst du beides nicht vor.

"options": zwei bis vier Vorgehensweisen, je mit Begründung. Erlaubt sind
abwartendes Beobachten mit definiertem Wiedervorstellungsintervall, klinische
Untersuchung, Anpassung des Kontrollrhythmus, Erwägung einer Umstellung der
Basistherapie auf Wirkstoffgruppenebene.
Nicht erlaubt: konkrete Dosierungen, Präparatenamen als Verordnung, das
Anweisen von Absetzen oder Aufdosieren. Formuliere als Erwägung ("kommt in
Betracht", "wäre zu prüfen"), nicht als Anordnung.

"urgency": ein Satz zum zeitlichen Rahmen — etwa "kurzfristige Vorstellung
innerhalb weniger Tage sinnvoll" oder "im regulären Kontrollintervall
ausreichend". Leerer String, wenn die Daten dafür nichts hergeben.

Schreibe auf Deutsch. Keine Markdown-Auszeichnung, reiner Text mit Absätzen.`;

const SCHEMA = {
  type:"object",
  properties:{
    assessment:{ type:"string",
      description:"Drei bis fünf Sätze fachliche Einordnung samt Grenzen der Aussage." },
    diagnostics:{
      type:"array",
      description:"Höchstens vier erwägenswerte Untersuchungen.",
      items:{
        type:"object",
        properties:{
          test:{ type:"string", description:"Die Untersuchung." },
          why: { type:"string", description:"Begründung in einem Halbsatz." }
        },
        required:["test","why"], additionalProperties:false
      }
    },
    options:{
      type:"array",
      description:"Zwei bis vier Vorgehensoptionen, als Erwägung formuliert.",
      items:{
        type:"object",
        properties:{
          option:   { type:"string", description:"Die Option." },
          rationale:{ type:"string", description:"Warum sie in Betracht kommt." }
        },
        required:["option","rationale"], additionalProperties:false
      }
    },
    urgency:{ type:"string",
      description:"Ein Satz zum zeitlichen Rahmen, sonst leerer String." }
  },
  required:["assessment","diagnostics","options","urgency"],
  additionalProperties:false
};

export default async function handler(req, res){
  try {
    if (req.method === "GET")  return healthCheck(res, "advice");
    if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

    const body = await readBody(req);
    if (!body) return res.status(400).json({ error:"bad_body",
      message:"Anfrage konnte nicht gelesen werden." });

    const {
      condition, level, prob, confidence, baselineDays, drivers = [], trend = [],
      drugs = [], daysToNextDose, joints = [], followUp = [], followUpNote,
      labs = {}, photos = []
    } = body;

    const L = [];
    L.push(`Erkrankung: ${condition || "Autoimmunerkrankung"}`);
    if (joints.length) L.push(`Üblicherweise betroffen: ${joints.join(", ")}`);

    if (drugs.length){
      L.push(`Medikation: ${drugs.map(d => `${d.name} (${d.group})`).join(", ")}`);
      /* Ausdrücklich hinschreiben, wofür TDM überhaupt etabliert ist —
         sonst schlägt das Modell Spiegelbestimmungen auch bei
         Methotrexat vor, wo das unüblich wäre. */
      const tdm = drugs.filter(d => d.tdm).map(d => d.name);
      const ada = drugs.filter(d => d.ada).map(d => d.name);
      L.push(tdm.length
        ? `Spiegelbestimmung etabliert für: ${tdm.join(", ")}.`
        : `Für keines der Präparate ist eine Spiegelbestimmung etabliert.`);
      if (ada.length) L.push(`Anti-Drug-Antikörper relevant bei: ${ada.join(", ")}.`);
    } else {
      L.push("Keine Medikation hinterlegt.");
    }

    if (Number.isFinite(daysToNextDose)){
      L.push(daysToNextDose >= 0
        ? `Nächste Gabe in ${daysToNextDose} Tagen.`
        : `Letzte Gabe vor ${-daysToNextDose} Tagen.`);
    }

    L.push("");
    L.push(`Eingestuftes Schubrisiko: ${level} (${prob} %)`);
    L.push(`Aussagekraft ${confidence} %, Baseline aus ${baselineDays} Tagen.`);

    L.push("");
    L.push("Abweichungen gegenüber der individuellen Baseline, stärkster Beitrag zuerst:");
    if (drivers.length) for (const d of drivers)
      L.push(`· ${d.signal}: ${d.baseline} → ${d.current} (${d.delta}, Anteil ${d.share} %)`);
    else L.push("· keine");

    if (trend.length){
      L.push("");
      L.push("Risikoverlauf:");
      L.push(trend.map(t => `${t.date}: ${t.prob} %`).join(" · "));
    }

    if (followUp.length){
      L.push("");
      L.push("Gezielte Nachfragen an die Patientin oder den Patienten:");
      for (const a of followUp){
        const ans = a.a === "yes" ? "Ja" : a.a === "no" ? "Nein" : "Weiß nicht";
        L.push(`· ${a.q} — ${ans}${a.hit ? "  [auffällig]" : ""}`);
      }
      if (followUpNote) L.push(`· Freie Ergänzung: ${followUpNote}`);
    } else {
      L.push("");
      L.push("Es liegen keine Nachfragen vor — ein Infekt als Ursache ist damit nicht abgefragt.");
    }

    const labKeys = Object.keys(labs);
    if (labKeys.length){
      L.push("");
      L.push("Vom Patienten nachgetragene Laborwerte:");
      for (const k of labKeys) L.push(`· ${k}: ${labs[k].value} ${labs[k].unit} (${labs[k].date})`);
    } else {
      L.push("");
      L.push("Keine Laborwerte hinterlegt.");
    }

    if (photos.length){
      L.push("");
      L.push("Fotodokumentation (Sichtbefund aus Patientenaufnahmen, keine Untersuchung):");
      for (const p of photos){
        L.push(`· ${p.region}: ${(p.findings || []).map(f => `${f.feature} ${f.value}`).join("; ")}`);
        if (p.change) L.push(`  Vergleich zur Voraufnahme: ${p.change}`);
      }
    }

    L.push("");
    L.push("Erstelle daraus die Einschätzung für die behandelnde Person.");

    const out = await callClaude({
      system: SYSTEM,
      content:[{ type:"text", text: L.join("\n") }],
      schema: SCHEMA,
      maxTokens: 2000
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
