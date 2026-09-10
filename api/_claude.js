/* ══════════════════════════════════════════════════════════════════
   /api/_claude.js — gemeinsame Grundlage der Claude-Endpunkte

   Liegt bewusst mit Unterstrich vorn: Vercel behandelt Dateien in /api
   als Funktionen, Dateien mit führendem Unterstrich nicht. Das hier ist
   nur eine Bibliothek.

   Alle drei Endpunkte (assess, photo, report) machen dasselbe Grund-
   gerüst: Key prüfen, Body lesen, Anthropic mit einem festgelegten
   JSON-Schema aufrufen, Antwort zurückgeben. Deshalb steht das einmal
   hier statt dreimal fast gleich.
   ══════════════════════════════════════════════════════════════════ */

/* Ein Modell für alle Endpunkte. Sonnet ist der richtige Kompromiss:
   die Aufgaben sind sprachlich anspruchsvoll (medizinischer Ton, keine
   Diagnose-Formulierungen), aber nicht rechenintensiv.
   Serverseitig festgelegt, damit über den Request kein anderes Modell
   untergeschoben werden kann. */
export const MODEL = "claude-sonnet-5";

/* Sonnet 5 denkt standardmäßig mit, und max_tokens begrenzt Denken UND
   Antwort zusammen. Ohne Abschalten bleibt bei knappem Budget kein Platz
   für den eigentlichen Text. */
function thinkingOff(model){
  return /^claude-(sonnet|opus)-5/.test(model) ? { thinking: { type: "disabled" } } : {};
}

/* Diese Zeilen stehen in jedem System-Prompt. Der Ton ist bei einer
   Gesundheits-App keine Stilfrage: eine Formulierung wie "Sie haben
   einen Schub" wäre eine Diagnose, die weder die App noch das Modell
   stellen darf. */
export const GUARDRAILS = `
Grundregeln, die IMMER gelten:

· Du stellst keine Diagnose und empfiehlst keine Therapie. Du beschreibst
  Beobachtungen und Auffälligkeiten.
· Formuliere nie "Sie haben einen Schub" oder "es liegt eine Entzündung vor".
  Richtig ist: "die Werte weichen von der Baseline ab", "das spricht für eine
  Abklärung".
· Du änderst niemals eine Medikation und rätst nie zum Absetzen oder Anpassen
  einer Dosis. Das entscheidet ausschließlich die behandelnde Praxis.
· Du beruhigst nicht vorschnell und dramatisierst nicht. Nüchtern und knapp.
· Bei Hinweisen auf einen Notfall — starke Atemnot, Brustschmerz, hohes Fieber
  mit Schüttelfrost, plötzliche neurologische Ausfälle — weist du unmissver-
  ständlich auf sofortige ärztliche Hilfe hin.
· Du schreibst auf Deutsch, in der Du-Form gegenüber Patientinnen und Patienten
  und sachlich-fachlich gegenüber der Praxis.`;

/* ── Body robust lesen ──
   Vercel füllt req.body meistens, aber nicht immer: bei fehlendem oder
   ungewöhnlichem content-type kommt der Stream roh an. */
export async function readBody(req){
  let body = req.body;
  if (typeof body === "string"){
    try { return JSON.parse(body); } catch { body = null; }
  }
  if (body && typeof body === "object") return body;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return null; }
}

/* Notnagel: Structured Outputs liefern gültiges JSON — außer die Antwort
   läuft ins Token-Limit. Dann wird hier gerettet, was geht. */
export function salvage(text){
  const t = String(text || "").trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  const body = t.slice(start).replace(/,\s*$/, "");
  for (const suffix of ["", '"}]}', '"}}', "}]}", "]}", "}}", "}"]){
    try { return JSON.parse(body + suffix); } catch {}
  }
  const cut = body.lastIndexOf("}");
  if (cut > 0) for (const suffix of ["]}", "}"]){
    try { return JSON.parse(body.slice(0, cut + 1) + suffix); } catch {}
  }
  return null;
}

/* ── Anthropic aufrufen ──
   schema legt die Antwortstruktur per Grammatik fest, deshalb ist kein
   Parsen von Fließtext nötig. Kein Prefill — das ist damit unvereinbar. */
export async function callClaude({ system, content, schema, maxTokens = 1600, timeoutMs = 45000 }){
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { error:"missing_key", status:500,
    message:"ANTHROPIC_API_KEY ist nicht gesetzt. In Vercel unter Settings → " +
            "Environment Variables anlegen und neu deployen." };

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let response, rawText;

  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      signal: ctrl.signal,
      headers:{
        "content-type":"application/json",
        "x-api-key": key,
        "anthropic-version":"2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        ...thinkingOff(MODEL),
        max_tokens: maxTokens,
        system,
        messages:[{ role:"user", content }],
        output_config:{ format:{ type:"json_schema", schema } }
      })
    });
    rawText = await response.text();
  } catch (e){
    return { error:"upstream_failed", status:504,
      message: e.name === "AbortError"
        ? "Die Auswertung hat zu lange gedauert. Bitte noch einmal versuchen."
        : String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok){
    let detail = rawText.slice(0, 500);
    try { detail = JSON.parse(rawText)?.error?.message || detail; } catch {}
    console.error("Anthropic API error", response.status, detail);
    return { error:"anthropic_error", status:502, message: detail };
  }

  let raw;
  try { raw = JSON.parse(rawText); }
  catch { return { error:"invalid_response", status:502,
    message:"Unerwartete Antwort der Auswertung." }; }

  const text = (raw.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  let result = null;
  try { result = JSON.parse(text); } catch { result = salvage(text); }

  if (!result) return { error:"bad_model_output", status:502,
    stop_reason: raw.stop_reason || null,
    message: raw.stop_reason === "max_tokens"
      ? "Die Antwort wurde abgeschnitten. Bitte noch einmal versuchen."
      : "Die Auswertung war nicht verwertbar." };

  return { result };
}

/* Health-Check, den alle Endpunkte über GET anbieten. Damit lässt sich
   ohne Frontend prüfen, ob Funktion und Key auf dem Server stimmen. */
export function healthCheck(res, name){
  const key = process.env.ANTHROPIC_API_KEY;
  return res.status(200).json({
    endpoint: name,
    function_reachable: true,
    api_key_present: Boolean(key),
    api_key_length: key ? key.length : 0,
    api_key_prefix: key ? key.slice(0, 7) : null,
    model: MODEL,
    node: process.version
  });
}
