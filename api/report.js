/* ══════════════════════════════════════════════════════════════════
   /api/report.js — Vercel Serverless Function

   Erzeugt einen Bericht, den die betroffene Person selbst weitergeben kann.

   Der Maßstab für diesen Text ist streng: Eine rheumatologische Praxis
   hat pro Patient wenige Minuten. Ein Bericht, der erst gelesen werden
   muss, um zu erkennen, worum es geht, ist wertlos. Deshalb steht das
   Ergebnis in den ersten zwei Zeilen und der Rest ist Beleg.

   Der Bericht wird NICHT automatisch versendet. Er wird erzeugt, dem
   Patienten vollständig gezeigt und erst nach dessen Bestätigung
   gespeichert (siehe openReport in app.js).

   Health-Check: /api/report im Browser aufrufen.
   ══════════════════════════════════════════════════════════════════ */

import { readBody, callClaude, healthCheck, GUARDRAILS } from "./_claude.js";

import { authorize } from "./_auth.js";

export const config = { maxDuration: 40 };

const SYSTEM = `Du schreibst eine Verlaufsmeldung, die eine betroffene Person
selbst an ihre behandelnde Praxis weitergeben kann. Die App speichert den Text,
versendet ihn aber nicht. Behaupte keine Übermittlung oder Kenntnisnahme.

Empfänger ist ärztliches Fachpersonal mit wenig Zeit. Danach richtet sich alles:

Aufbau von "summary" (reiner Text, keine Markdown-Auszeichnung):

  Zeile 1: "Verlaufsmeldung CLAM · <Datum>"
  Zeile 2: Erkrankung und aktuelle Medikation in einer Zeile.
  Dann eine Leerzeile.

  Absatz "Anlass": zwei bis drei Sätze. Was hat sich verändert, seit wann,
  wie stark gegenüber der individuellen Baseline. Das ist der wichtigste
  Absatz — er muss für sich allein verständlich sein.

  Absatz "Objektive Abweichungen": die Kennzahlen als Liste mit
  Baseline → aktuell und Differenz. Nur die auffälligen.

  Absatz "Patientenangaben": Ergebnis der gezielten Nachfragen. Auffällige
  Antworten zuerst. Wenn ein Infekt verneint wurde, schreibe das
  ausdrücklich hin — die Praxis muss wissen, dass daran gedacht wurde.

  Absatz "Verlauf": wie sich das Risiko über die letzten Tage entwickelt hat.
  Ein Satz. Ob es steigt, plateaut oder schwankt, ist klinisch relevanter
  als der Absolutwert eines einzelnen Tages.

  Falls Bildbefunde vorliegen, ein kurzer Absatz "Bildbefund".
  Falls Laborwerte vorliegen, ein kurzer Absatz "Zuletzt bekannte Laborwerte"
  mit Datum.

  Zum Schluss ein Absatz "Einordnung" mit genau diesem Inhalt, sinngemäß:
  Die Werte stammen aus einer Patienten-App, die Abweichungen von
  individuellen Ausgangswerten misst. Die Medizinprodukte-Einordnung steht noch aus; die Einstufung ist keine
  Diagnose, und die zugrunde
  liegenden Schwellenwerte sind nicht klinisch validiert.

Ton: sachlich, knapp, fachsprachlich korrekt. Keine Anrede, keine Grußformel,
keine Werbung für die App. Keine Konjunktive wie "könnte möglicherweise".

Was du NICHT tust:
· Keine Verdachtsdiagnose stellen.
· Keine Therapie vorschlagen und keine Dosis nennen.
· Keine Dringlichkeit behaupten, die die Daten nicht hergeben.
· Keine Untersuchungen oder Wirkstoffspiegel empfehlen.
${GUARDRAILS}`;

const SCHEMA = {
  type:"object",
  properties:{
    summary:{ type:"string",
      description:"Der vollständige Berichtstext, reiner Text mit Absätzen." }
  },
  required:["summary"],
  additionalProperties:false
};

export default async function handler(req, res){
  try {
    if (req.method === "GET")  return healthCheck(res, "report");
    if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

    const body = await readBody(req);
    if (!body) return res.status(400).json({ error:"bad_body",
      message:"Anfrage konnte nicht gelesen werden." });
    if (!await authorize(req, res, "report", body)) return;

    const {
      condition, conditionName, date, level, prob, confidence, baselineDays,
      drivers = [], trend = [], followUp = [], followUpNote,
      photos = [], drugs = [], daysToNextDose, labs = {}, joints = []
    } = body;

    const L = [];
    L.push(`Datum der Meldung: ${date}`);
    L.push(`Erkrankung: ${conditionName || condition || "Autoimmunerkrankung"}`);
    if (joints.length) L.push(`Üblicherweise betroffene Regionen: ${joints.join(", ")}`);

    if (drugs.length){
      L.push(`Medikation: ${drugs.map(d => d.name).join(", ")}`);
    }
    if (Number.isFinite(daysToNextDose)){
      L.push(daysToNextDose >= 0
        ? `Nächste Gabe in ${daysToNextDose} Tagen.`
        : `Letzte Gabe vor ${-daysToNextDose} Tagen.`);
    }

    L.push("");
    L.push(`Auffälligkeit gegenüber der Baseline: ${level}`);
    L.push(`Grundlage: ${baselineDays} Vergleichstage; Einstufung nicht klinisch validiert.`);

    L.push("");
    L.push("Abweichungen gegenüber der individuellen Baseline (stärkster Beitrag zuerst):");
    if (drivers.length) for (const d of drivers)
      L.push(`· ${d.signal}: Baseline ${d.baseline} → aktuell ${d.current} (${d.delta}, Anteil ${d.share} %)`);
    else L.push("· keine");

    if (trend.length){
      L.push("");
      L.push("Risikoverlauf der letzten Tage:");
      L.push(trend.map(t => `${t.date}: ${t.level}`).join(" · "));
    }

    if (followUp.length){
      L.push("");
      L.push("Gezielte Nachfragen an die Patientin oder den Patienten:");
      for (const a of followUp){
        const ans = a.a === "yes" ? "Ja" : a.a === "no" ? "Nein" : "Weiß nicht";
        L.push(`· ${a.q} — ${ans}${a.hit ? "  [auffällig]" : ""}`);
      }
      if (followUpNote) L.push(`· Freie Ergänzung: ${followUpNote}`);
    }

    if (photos.length){
      L.push("");
      L.push("Fotodokumentation:");
      for (const p of photos){
        L.push(`· ${p.region}: ${(p.findings || []).map(f => `${f.feature} ${f.value}`).join("; ")}`);
        if (p.change) L.push(`  Vergleich zur Voraufnahme: ${p.change}`);
      }
    }

    const labKeys = Object.keys(labs);
    if (labKeys.length){
      L.push("");
      L.push("Zuletzt bekannte Laborwerte:");
      for (const k of labKeys)
        L.push(`· ${k}: ${labs[k].value} ${labs[k].unit} (${labs[k].date})`);
    }

    L.push("");
    L.push("Schreibe daraus die Verlaufsmeldung für die Praxis.");

    const out = await callClaude({
      system: SYSTEM,
      content:[{ type:"text", text: L.join("\n") }],
      schema: SCHEMA,
      maxTokens: 2200
    });

    if (out.error) return res.status(out.status).json(out);
    return res.status(200).json(out.result);

  } catch (e){
    console.error("UNHANDLED FUNCTION ERROR", e);
    return res.status(500).json({
      error:"internal_function_error",
      message:"Die Funktion konnte nicht ausgeführt werden."
    });
  }
}
