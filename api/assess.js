/* ══════════════════════════════════════════════════════════════════
   /api/assess.js — Vercel Serverless Function

   Stellt die gezielten Nachfragen, wenn das Schubrisiko erhöht ist.

   Warum überhaupt ein Modell dafür? Weil die richtige Frage davon
   abhängt, WAS den Score treibt. Ist der Ruhepuls hoch und die
   Aktivität eingebrochen, ist die wichtigste Frage die nach einem
   Infekt — der erzeugt dasselbe Muster und muss abgegrenzt werden,
   bevor jemand seine Praxis alarmiert. Steht dagegen die Morgen-
   steifigkeit oben, sind Verteilung und Dauer entscheidend.

   Ein fester Fragenkatalog könnte das nicht leisten. Die App hat
   trotzdem einen (siehe fallbackQuestions in app.js), damit der Ablauf
   auch ohne diesen Dienst weiterläuft.

   Health-Check: /api/assess im Browser aufrufen.
   ══════════════════════════════════════════════════════════════════ */

import { readBody, callClaude, healthCheck, GUARDRAILS } from "./_claude.js";

import { authorize } from "./_auth.js";

export const config = { maxDuration: 30 };

const SYSTEM = `Du unterstützt Menschen mit einer chronischen Autoimmunerkrankung
dabei, einen möglichen Krankheitsschub früh einzuordnen.

Die App hat aus Wearable-Daten und Selbstauskünften eine Abweichung von der
persönlichen Baseline festgestellt. Deine Aufgabe: drei bis vier gezielte
Fragen stellen, deren Antworten den Verdacht erhärten oder entkräften.

Was gute Fragen ausmacht:

1. Die WICHTIGSTE Frage steht zuerst. Wenn Ruhepuls, Temperatur oder HRV
   auffällig sind, ist das fast immer die Abgrenzung gegen einen Infekt —
   ein Infekt erzeugt dasselbe Muster wie ein Schub und wäre die banalere
   und häufigere Erklärung.
2. Jede Frage muss mit Ja, Nein oder "Weiß nicht" beantwortbar sein.
   Keine Skalen, keine offenen Fragen, keine Mehrfachauswahl.
3. Frage nur nach Dingen, die der Mensch selbst wahrnehmen kann:
   Schwellung, Wärme, Rötung, Fieber, Beweglichkeit, Alltagsfunktion.
   Nicht nach Laborwerten oder Befunden.
4. Beziehe dich konkret auf die genannten Auffälligkeiten und die
   betroffenen Gelenke. Allgemeinplätze helfen niemandem.
5. Berücksichtige den Behandlungszyklus: Steht die nächste Gabe kurz
   bevor, ist ein Nachlassen der Wirkung gegen Ende des Intervalls eine
   naheliegende Erklärung und eine Frage wert.

Zu jeder Frage gehört:
· "why" — ein kurzer Satz, warum genau diese Frage jetzt gestellt wird.
  Das ist wichtig: Menschen beantworten Fragen ehrlicher, wenn sie den
  Zweck kennen.
· "alarm" — welche Antwort ("yes" oder "no") in Richtung entzündlicher
  Aktivität deutet. Bei "Hast du dich normal bewegen können?" wäre das
  "no", bei "Sind Gelenke geschwollen?" wäre es "yes".
· "flag" — ein Stichwort in einem Wort, z. B. "infekt", "schwellung",
  "funktion", "wirkverlust".

"intro" ist ein einzelner Satz, der einordnet, worum es geht — ruhig und
ohne Dramatik.

"urgent" setzt du nur, wenn die geschilderte Konstellation eine
unverzügliche ärztliche Vorstellung nahelegt. Sonst lässt du das Feld leer.
${GUARDRAILS}`;

const SCHEMA = {
  type:"object",
  properties:{
    intro:{ type:"string", description:"Ein einordnender Satz, ruhig formuliert." },
    questions:{
      type:"array",
      description:"Drei bis vier Fragen, wichtigste zuerst.",
      items:{
        type:"object",
        properties:{
          text: { type:"string", description:"Die Frage, mit Ja/Nein beantwortbar." },
          why:  { type:"string", description:"Ein Satz: warum diese Frage jetzt." },
          alarm:{ type:"string", enum:["yes","no"],
                  description:"Welche Antwort in Richtung entzündlicher Aktivität deutet." },
          flag: { type:"string", description:"Stichwort in einem Wort." }
        },
        required:["text","why","alarm","flag"],
        additionalProperties:false
      }
    },
    urgent:{ type:"string",
      description:"Nur bei Hinweis auf einen Notfall ausfüllen, sonst leerer String." }
  },
  required:["intro","questions","urgent"],
  additionalProperties:false
};

export default async function handler(req, res){
  /* Alles umschlossen: ohne diesen Rahmen zeigt Vercel bei einem
     unerwarteten Fehler nur FUNCTION_INVOCATION_FAILED ohne Hinweis. */
  try {
    if (req.method === "GET")  return healthCheck(res, "assess");
    if (req.method !== "POST") return res.status(405).json({ error:"method_not_allowed" });

    const body = await readBody(req);
    if (!body) return res.status(400).json({ error:"bad_body",
      message:"Anfrage konnte nicht gelesen werden." });
    if (!await authorize(req, res, "assess", body)) return;

    const {
      condition, conditionName, level, prob, drivers = [],
      drugs = [], daysToNextDose, missedDose, joints = []
    } = body;

    if (!drivers.length && !missedDose){
      return res.status(400).json({ error:"no_input",
        message:"Ohne auffällige Werte gibt es nichts nachzufragen." });
    }

    /* Der Prompt bekommt bewusst nur Kennzahlen und Abweichungen —
       keinen Namen, kein Geburtsdatum, keine Kontaktdaten. Für die
       Fragenauswahl braucht es das nicht. */
    const lines = [];
    lines.push(`Erkrankung: ${conditionName || condition || "Autoimmunerkrankung"}`);
    if (joints.length) lines.push(`Üblicherweise betroffen: ${joints.join(", ")}`);
    if (drugs.length)  lines.push(`Medikation: ${drugs.join(", ")}`);
    if (Number.isFinite(daysToNextDose)){
      lines.push(daysToNextDose >= 0
        ? `Nächste Gabe in ${daysToNextDose} Tagen.`
        : `Letzte Gabe vor ${-daysToNextDose} Tagen.`);
    }
    if (missedDose) lines.push("Die letzte fällige Dosis wurde vergessen.");
    lines.push("");
    lines.push(`Auffälligkeit gegenüber der Baseline: ${level}; keine klinisch validierte Vorhersage.`);
    lines.push("");
    lines.push("Abweichungen gegenüber der persönlichen Baseline, stärkste zuerst:");
    for (const d of drivers)
      lines.push(`· ${d.signal}: Baseline ${d.baseline}, aktuell ${d.current} (${d.delta})`);
    lines.push("");
    lines.push("Stelle jetzt die gezielten Nachfragen.");

    const out = await callClaude({
      system: SYSTEM,
      content: [{ type:"text", text: lines.join("\n") }],
      schema: SCHEMA,
      maxTokens: 1200
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
