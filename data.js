/* ══════════════════════════════════════════════════════════════════
   CLAM — Stammdaten

   Alles, was Auswahllisten füllt. Bewusst als eigene Datei, damit die
   fachlichen Listen (Diagnosen, Wirkstoffe, Gelenkregionen) gepflegt
   werden können, ohne die App-Logik anzufassen.
   ══════════════════════════════════════════════════════════════════ */

/* ─────────────────  DIAGNOSEN  ─────────────────
   pro = die Patienteneingaben, die für dieses Krankheitsbild sinnvoll
   sind. Nicht jede Erkrankung hat Morgensteifigkeit als Leitsymptom;
   der Tages-Check zeigt deshalb nur, was zur Diagnose passt.
   photo = ob standardisierte Fotos überhaupt etwas beitragen können. */
export const CONDITIONS = [
  { id:"ra",    n:"Rheumatoide Arthritis",   s:"Gelenkentzündung, oft symmetrisch",
    pro:["pain","stiff","fatigue","global"], photo:true,
    joints:["hand_l","hand_r","wrist_l","wrist_r","knee_l","knee_r","foot_l","foot_r"] },
  { id:"psa",   n:"Psoriasis-Arthritis",     s:"Gelenke und Haut betroffen",
    pro:["pain","stiff","fatigue","global","skin"], photo:true,
    joints:["hand_l","hand_r","knee_l","knee_r","foot_l","foot_r","spine"] },
  { id:"axspa", n:"Axiale Spondyloarthritis", s:"Entzündung der Wirbelsäule",
    pro:["pain","stiff","fatigue","global"], photo:false,
    joints:["spine","hip_l","hip_r","si"] },
  { id:"sle",   n:"Lupus erythematodes",     s:"Systemisch, viele Organe",
    pro:["pain","fatigue","global","skin"], photo:true,
    joints:["hand_l","hand_r","knee_l","knee_r"] },
  { id:"ibd",   n:"Chronische Darmentzündung", s:"Morbus Crohn oder Colitis ulcerosa",
    pro:["pain","fatigue","global","stool"], photo:false,
    joints:["knee_l","knee_r","si"] },
  { id:"ms",    n:"Multiple Sklerose",       s:"Entzündung im Nervensystem",
    pro:["fatigue","global","neuro"], photo:false, joints:[] },
  { id:"other", n:"Andere Autoimmunerkrankung", s:"Selbst benennen",
    pro:["pain","stiff","fatigue","global"], photo:true,
    joints:["hand_l","hand_r","knee_l","knee_r","foot_l","foot_r"] }
];

/* ─────────────────  KÖRPERREGIONEN  ───────────────── */
export const JOINTS = [
  { id:"hand_l",  n:"Hand links",        g:"Hände" },
  { id:"hand_r",  n:"Hand rechts",       g:"Hände" },
  { id:"wrist_l", n:"Handgelenk links",  g:"Hände" },
  { id:"wrist_r", n:"Handgelenk rechts", g:"Hände" },
  { id:"elbow_l", n:"Ellenbogen links",  g:"Arme" },
  { id:"elbow_r", n:"Ellenbogen rechts", g:"Arme" },
  { id:"shoulder_l", n:"Schulter links", g:"Arme" },
  { id:"shoulder_r", n:"Schulter rechts",g:"Arme" },
  { id:"spine",   n:"Wirbelsäule",       g:"Rumpf" },
  { id:"si",      n:"Iliosakralgelenk",  g:"Rumpf" },
  { id:"hip_l",   n:"Hüfte links",       g:"Beine" },
  { id:"hip_r",   n:"Hüfte rechts",      g:"Beine" },
  { id:"knee_l",  n:"Knie links",        g:"Beine" },
  { id:"knee_r",  n:"Knie rechts",       g:"Beine" },
  { id:"ankle_l", n:"Sprunggelenk links",g:"Beine" },
  { id:"ankle_r", n:"Sprunggelenk rechts",g:"Beine" },
  { id:"foot_l",  n:"Fuß links",         g:"Beine" },
  { id:"foot_r",  n:"Fuß rechts",        g:"Beine" }
];

/* ─────────────────  MEDIKAMENTE  ─────────────────
   tdm = für diesen Wirkstoff ist ein Wirkstoffspiegel (Therapeutisches
   Drug Monitoring) etabliert. Nur dann schlägt die App bei erhöhtem
   Risiko eine PoC-TDM-Bestimmung vor — bei Methotrexat etwa wäre das
   klinisch nicht üblich.
   ada = Anti-Drug-Antikörper sind bei diesem Wirkstoff ein Thema. */
export const DRUGS = [
  { id:"adalimumab",  n:"Adalimumab",    g:"TNF-Blocker",  tdm:true,  ada:true,  every:14 },
  { id:"etanercept",  n:"Etanercept",    g:"TNF-Blocker",  tdm:true,  ada:false, every:7 },
  { id:"infliximab",  n:"Infliximab",    g:"TNF-Blocker",  tdm:true,  ada:true,  every:56 },
  { id:"golimumab",   n:"Golimumab",     g:"TNF-Blocker",  tdm:true,  ada:true,  every:28 },
  { id:"certolizumab",n:"Certolizumab",  g:"TNF-Blocker",  tdm:true,  ada:true,  every:14 },
  { id:"tocilizumab", n:"Tocilizumab",   g:"IL-Hemmer",    tdm:true,  ada:true,  every:7 },
  { id:"secukinumab", n:"Secukinumab",   g:"IL-Hemmer",    tdm:true,  ada:true,  every:28 },
  { id:"ustekinumab", n:"Ustekinumab",   g:"IL-Hemmer",    tdm:true,  ada:true,  every:84 },
  { id:"rituximab",   n:"Rituximab",     g:"B-Zell-Therapie", tdm:false, ada:true, every:180 },
  { id:"abatacept",   n:"Abatacept",     g:"T-Zell-Therapie", tdm:false, ada:true, every:7 },
  { id:"vedolizumab", n:"Vedolizumab",   g:"Integrin-Hemmer", tdm:true, ada:true, every:56 },
  { id:"mtx",         n:"Methotrexat",   g:"Basistherapie", tdm:false, ada:false, every:7 },
  { id:"lefluno",     n:"Leflunomid",    g:"Basistherapie", tdm:false, ada:false, every:1 },
  { id:"sulfa",       n:"Sulfasalazin",  g:"Basistherapie", tdm:false, ada:false, every:1 },
  { id:"hcq",         n:"Hydroxychloroquin", g:"Basistherapie", tdm:false, ada:false, every:1 },
  { id:"azathioprin", n:"Azathioprin",   g:"Basistherapie", tdm:false, ada:false, every:1 },
  { id:"tofacitinib", n:"Tofacitinib",   g:"JAK-Hemmer",   tdm:false, ada:false, every:1 },
  { id:"baricitinib", n:"Baricitinib",   g:"JAK-Hemmer",   tdm:false, ada:false, every:1 },
  { id:"upadacitinib",n:"Upadacitinib",  g:"JAK-Hemmer",   tdm:false, ada:false, every:1 },
  { id:"prednisolon", n:"Prednisolon",   g:"Kortison",     tdm:false, ada:false, every:1 },
  { id:"other",       n:"Anderes Präparat", g:"Sonstige",  tdm:false, ada:false, every:14 }
];

/* ─────────────────  WEARABLES  ─────────────────
   Was das Gerät liefern kann, entscheidet, welche Signale die App
   überhaupt erwarten darf. Fehlende Signale werden nicht als Lücke
   angemahnt — eine Uhr ohne Temperatursensor ist kein Datenproblem. */
export const WEARABLES = [
  { id:"applewatch", n:"Apple Watch",  s:"Ruhepuls, HRV, Schritte, Schlaf, Temperatur",
    signals:["rhr","hrv","steps","sleep","temp"] },
  { id:"fitbit",     n:"Fitbit",       s:"Ruhepuls, HRV, Schritte, Schlaf, Temperatur",
    signals:["rhr","hrv","steps","sleep","temp"] },
  { id:"oura",       n:"Oura Ring",    s:"Ruhepuls, HRV, Schlaf, Temperatur",
    signals:["rhr","hrv","sleep","temp"] },
  { id:"garmin",     n:"Garmin",       s:"Ruhepuls, HRV, Schritte, Schlaf",
    signals:["rhr","hrv","steps","sleep"] },
  { id:"other",      n:"Anderes Gerät", s:"Werte von Hand eintragen",
    signals:["rhr","hrv","steps","sleep"] },
  { id:"none",       n:"Kein Wearable", s:"Nur Tages-Check und Fotos",
    signals:[] }
];

/* ─────────────────  LABORWERTE  ─────────────────
   Kommen aus der Praxis und werden von Hand nachgetragen. Sie gehen
   NICHT in den Risikoscore ein — sie sind das Ergebnis der Abklärung,
   nicht ihr Auslöser. Im Verlauf und im Praxisbericht stehen sie
   trotzdem, weil sie den Loop schließen. */
export const LABS = [
  { id:"crp",   n:"CRP",              unit:"mg/l",  step:0.1,  hint:"Allgemeiner Entzündungsmarker" },
  { id:"esr",   n:"BSG",              unit:"mm/h",  step:1,    hint:"Blutsenkung, 1. Stunde" },
  { id:"calpro",n:"Calprotectin",     unit:"µg/g",  step:1,    hint:"Stuhl, bei Darmbeteiligung" },
  { id:"level", n:"Wirkstoffspiegel", unit:"µg/ml", step:0.1,  hint:"Talspiegel vor der nächsten Gabe" },
  { id:"ada",   n:"Anti-Drug-Antikörper", unit:"AU/ml", step:1, hint:"Antikörper gegen das Medikament" },
  { id:"leuko", n:"Leukozyten",       unit:"/nl",   step:0.1,  hint:"Weiße Blutkörperchen" },
  { id:"hb",    n:"Hämoglobin",       unit:"g/dl",  step:0.1,  hint:"Roter Blutfarbstoff" }
];

/* ─────────────────  TAGES-CHECK  ─────────────────
   kind bestimmt die Eingabeart: "scale" = 0–10, "minutes" = Auswahl
   von Zeitspannen, "count" = Zahl.
   Die ids stimmen mit den Signal-ids in risk.js überein, wo es ein
   Signal gibt. skin/stool/neuro sind Zusatzangaben ohne eigenes
   Signalgewicht — sie landen im Praxisbericht, nicht im Score. */
export const CHECKS = [
  { id:"pain",    kind:"scale",   n:"Schmerz",           lo:"keine",    hi:"stärkste" },
  { id:"stiff",   kind:"minutes", n:"Morgensteifigkeit", hint:"Wie lange dauerte es heute Morgen, bis die Gelenke wieder beweglich waren?" },
  { id:"fatigue", kind:"scale",   n:"Fatigue",           lo:"ausgeruht", hi:"erschöpft" },
  { id:"global",  kind:"scale",   n:"Allgemeines Befinden", lo:"sehr gut", hi:"sehr schlecht" },
  { id:"skin",    kind:"scale",   n:"Hautbeteiligung",   lo:"ruhig",    hi:"stark" },
  { id:"stool",   kind:"count",   n:"Stuhlgänge",        hint:"Anzahl in den letzten 24 Stunden" },
  { id:"neuro",   kind:"scale",   n:"Neurologische Symptome", lo:"keine", hi:"stark" }
];

/* Auswahlstufen für die Morgensteifigkeit. Minuten sind für Patienten
   schwer zu schätzen, Spannen dagegen gut — der gespeicherte Wert ist
   die Mitte der Spanne. */
export const STIFF_STEPS = [
  { v:0,   n:"keine" },
  { v:8,   n:"< 15 min" },
  { v:22,  n:"15–30 min" },
  { v:45,  n:"30–60 min" },
  { v:90,  n:"1–2 h" },
  { v:150, n:"> 2 h" }
];

/* ─────────────────  VITALWERTE VON HAND  ─────────────────
   Die Reihenfolge ist die Eingabereihenfolge im Sheet. */
export const VITALS = [
  { id:"rhr",   n:"Ruhepuls",        unit:"bpm", step:1,    min:30,  max:140,  ph:"z. B. 62" },
  { id:"hrv",   n:"HRV",             unit:"ms",  step:1,    min:5,   max:250,  ph:"z. B. 45" },
  { id:"steps", n:"Schritte",        unit:"",    step:100,  min:0,   max:60000,ph:"z. B. 8200" },
  { id:"sleep", n:"Schlaf",          unit:"h",   step:0.1,  min:0,   max:16,   ph:"z. B. 7,2" },
  { id:"temp",  n:"Hauttemperatur",  unit:"°C",  step:0.01, min:28,  max:40,   ph:"z. B. 33,15" }
];

/* ─────────────────  ICONS  ───────────────── */
export const ICON = {
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`,
  heart: `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 22l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>`,
  wave:  `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h3l2.5-7 4 14 3-9 2 2h5.5"/></svg>`,
  steps: `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4c1.6 0 2.6 1.2 2.6 3 0 2.2-1 3.4-1 5.2 0 1 .3 1.8.3 2.6 0 1.2-.8 1.9-2 1.9s-2-.7-2-1.9c0-.8.3-1.6.3-2.6C5.2 10.4 4.2 9.2 4.2 7c0-1.8 1.2-3 2.8-3zM17 8c1.6 0 2.6 1.2 2.6 3 0 2.2-1 3.4-1 5.2 0 1 .3 1.8.3 2.6 0 1.2-.8 1.9-2 1.9s-2-.7-2-1.9c0-.8.3-1.6.3-2.6c0-1.8-1-3-1-5.2 0-1.8 1.2-3 2.8-3z"/></svg>`,
  moon:  `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>`,
  temp:  `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.8V4.5a2.5 2.5 0 0 0-5 0v10.3a4.5 4.5 0 1 0 5 0z"/></svg>`,
  bolt:  `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4.5 13.5H11l-1 8.5 8.5-11.5H12z"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 1.8"/></svg>`,
  face:  `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 14.5s1.3 1.5 3.5 1.5 3.5-1.5 3.5-1.5"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>`,
  cam:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>`,
  send:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>`,
  chev:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>`,
  down:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
  info:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>`,
  pill:  `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 20.5a5 5 0 0 1-7-7l6-6a5 5 0 0 1 7 7z"/><path d="M8.5 8.5l7 7"/></svg>`,
  lab:   `<svg viewBox="0 0 24 24" fill="none" stroke="#1D6EF5" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6.5L4.2 18A2 2 0 0 0 6 21h12a2 2 0 0 0 1.8-3L15 9.5V3"/><path d="M8 3h8M7.5 14h9"/></svg>`
};

/* Signal-Symbol je Kennzahl — für Kacheln und Treiberliste. */
export const SIG_ICON = {
  rhr:ICON.heart, hrv:ICON.wave, steps:ICON.steps, sleep:ICON.moon, temp:ICON.temp,
  pain:ICON.bolt, stiff:ICON.clock, fatigue:ICON.moon, global:ICON.face
};

/* ─────────────────  RECHTSTEXTE  ─────────────────
   Platzhalter. Vor Veröffentlichung durch geprüfte Texte ersetzen —
   die App verarbeitet Gesundheitsdaten (Art. 9 DSGVO), da genügt kein
   Standardbaustein. */
export const LEGAL = {
  privacy: `<h4>Welche Daten wir verarbeiten</h4>
<p>CLAM verarbeitet Gesundheitsdaten im Sinne von Art. 9 DSGVO: deine Angaben
zu Beschwerden, Werte deines Wearables, Fotos betroffener Körperstellen sowie
von dir eingetragene Laborwerte.</p>
<h4>Wo die Daten liegen</h4>
<p>Konto und Daten liegen in deinem Firebase-Projekt. Fotos und Kennzahlen
werden zur Auswertung an die Claude-API von Anthropic übermittelt.</p>
<h4>Weitergabe an deine Praxis</h4>
<p>Eine Meldung an deine Praxis wird ausschließlich auf deine ausdrückliche
Bestätigung hin erzeugt und versendet. Ohne dein Zutun verlässt kein Bericht
die App.</p>
<h4>Deine Rechte</h4>
<p>Du kannst deine Daten jederzeit exportieren und dein Konto mit allen Daten
vollständig löschen — beides in den Einstellungen.</p>
<p class="todo">Platzhalter. Vor Veröffentlichung durch eine geprüfte
Datenschutzerklärung ersetzen, einschließlich Auftragsverarbeitungsverträgen
mit Google (Firebase) und Anthropic.</p>`,

  terms: `<h4>Zweck der App</h4>
<p>CLAM erkennt Abweichungen von deinen persönlichen Normalwerten und weist
dich darauf hin, wenn eine ärztliche Abklärung sinnvoll sein könnte.</p>
<h4>Keine Diagnose, keine Therapie</h4>
<p>CLAM ist kein Medizinprodukt. Die App stellt keine Diagnose, empfiehlt keine
Therapie und ersetzt keinen Arztbesuch. Alle Hinweise sind Anhaltspunkte für
ein Gespräch mit deiner Praxis.</p>
<h4>Grenzen der Berechnung</h4>
<p>Das Schubrisiko beruht auf Hypothesen aus der aktuellen Forschung und auf
deinen eigenen Verlaufsdaten. Es gibt keine validierten Grenzwerte. Ein
niedriges Risiko schließt einen Schub nicht aus.</p>
<h4>Im Notfall</h4>
<p>Bei akuten oder schweren Beschwerden wende dich unmittelbar an deine Praxis,
den ärztlichen Bereitschaftsdienst oder den Notruf 112.</p>
<p class="todo">Platzhalter. Vor Veröffentlichung anwaltlich prüfen lassen —
insbesondere die Abgrenzung zum Medizinprodukt nach MDR.</p>`
};
