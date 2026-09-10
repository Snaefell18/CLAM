/* ══════════════════════════════════════════════════════════════════
   CLAM — Schubrisiko-Berechnung

   Kern der App. Alles hier arbeitet gegen die INDIVIDUELLE Baseline des
   Nutzers, nicht gegen Bevölkerungsnormwerte: ein Ruhepuls von 72 kann
   für den einen völlig normal und für den anderen 8 bpm über seinem
   Üblichen sein. Nur die zweite Aussage ist ein Signal.

   ───────────────────────────────────────────────────────────────────
   EVIDENZLAGE — bitte vor dem Ändern von Gewichten lesen
   ───────────────────────────────────────────────────────────────────
   Die Richtungen der Signale stützen sich auf Beobachtungsstudien zu
   Wearables bei entzündlich-rheumatischen Erkrankungen (u. a. eine 2025
   publizierte Kohorte mit 53 RA-Patienten, Apple Watch / Fitbit / Oura):
   während entzündlicher Schübe waren Herzfrequenz und Ruhepuls erhöht,
   HRV und Aktivität verändert.

   Was daraus folgt und was NICHT:
   · Die Richtung jedes Signals (Ruhepuls hoch = ungünstig, HRV runter =
     ungünstig, Aktivität runter = ungünstig) ist gut abgestützt.
   · Die konkreten Grenzwerte und Gewichte unten sind ausdrücklich
     HYPOTHESEN. Es gibt bislang keine validierten Cut-offs, aus denen
     sich ein Schubrisiko in Prozent ableiten ließe.
   · Deshalb steht in WEIGHTS und GATES jede Zahl an genau einer Stelle,
     kommentiert und einzeln änderbar. Wenn eigene Verlaufsdaten oder
     neue Studien bessere Werte hergeben, wird nur diese Datei angefasst.

   Die Ausgabe ist bewusst ein RISIKOHINWEIS, keine Diagnose: sie sagt
   "hier weicht etwas von deinem Normal ab, das lohnt eine Abklärung",
   nicht "du hast einen Schub".
   ══════════════════════════════════════════════════════════════════ */

/* ─────────────────  1. SIGNALE  ─────────────────
   dir = +1 bedeutet: ein Anstieg gegenüber der Baseline ist ungünstig.
   dir = -1 bedeutet: ein Abfall ist ungünstig.

   floor = kleinste absolute Änderung, die überhaupt als Signal zählt.
   Das ist der wichtigste Schutz gegen Fehlalarme: wer einen extrem
   stabilen Ruhepuls hat, bekommt sonst schon bei 1,5 bpm Abweichung
   einen hohen z-Wert, obwohl das klinisch nichts bedeutet. Erst wenn
   BEIDES zutrifft — statistisch auffällig UND absolut relevant —
   trägt ein Signal zum Score bei.

   minMad = Untergrenze der Streuung. Verhindert Division durch ~0 bei
   Nutzern mit sehr gleichmäßigen Werten.

   src = woher der Wert kommt. "wear" = Wearable, "pro" = Patient
   Reported Outcome (aktive Eingabe). Wird für die Abdeckungsanzeige
   gebraucht: ein Risiko allein aus Wearable-Daten ohne Tages-Check ist
   schwächer belegt als eines aus beiden Quellen. */

export const SIGNALS = {
  /* ── Passiv: Wearable ── */
  rhr: {
    src:"wear", dir:+1, unit:"bpm", dec:0,
    floor:2.0,        // unter 2 bpm Abweichung: klinisch nicht verwertbar
    minMad:1.5,
    label:"Ruhepuls"
  },
  hrv: {
    src:"wear", dir:-1, unit:"ms", dec:0,
    floor:4.0,        // HRV schwankt von Natur aus stark
    minMad:3.0,
    label:"HRV"
  },
  steps: {
    src:"wear", dir:-1, unit:"Schritte", dec:0,
    floor:800,        // ein einzelner ruhiger Tag ist noch kein Signal
    minMad:600,
    label:"Aktivität"
  },
  sleep: {
    src:"wear", dir:-1, unit:"h", dec:1,
    floor:0.5,
    minMad:0.4,
    label:"Schlaf"
  },
  temp: {
    src:"wear", dir:+1, unit:"°C", dec:2,
    floor:0.20,       // Handgelenktemperatur, Abweichung vom Median
    minMad:0.10,
    label:"Hauttemperatur"
  },

  /* ── Aktiv: Patienteneingaben ──
     Die Skalen sind bereits klein (0–10 bzw. Minuten), deshalb sind die
     floors hier niedriger — eine Verschiebung um 2 Punkte auf einer
     11-stufigen Schmerzskala ist eine echte Veränderung. */
  pain: {
    src:"pro", dir:+1, unit:"/10", dec:0,
    floor:1.5,
    minMad:0.8,
    label:"Schmerz"
  },
  stiff: {
    src:"pro", dir:+1, unit:"min", dec:0,
    floor:15,         // Morgensteifigkeit, Minuten
    minMad:10,
    label:"Morgensteifigkeit"
  },
  fatigue: {
    src:"pro", dir:+1, unit:"/10", dec:0,
    floor:1.5,
    minMad:0.8,
    label:"Fatigue"
  },
  global: {
    src:"pro", dir:+1, unit:"/10", dec:0,
    floor:1.5,
    minMad:0.8,
    label:"Befinden"
  }
};

export const SIGNAL_IDS = Object.keys(SIGNALS);

/* ─────────────────  2. GEWICHTE  ─────────────────
   Relatives Gewicht jedes Signals im Gesamtscore. Summiert wird nur
   über die Signale, für die an diesem Tag überhaupt Daten vorliegen —
   dadurch bleibt der Score vergleichbar, auch wenn mal die Uhr nicht
   getragen wurde.

   Begründung der Abstufung:
   · Schmerz und Morgensteifigkeit sind die Leitsymptome des Schubs und
     das, was am Ende auch die Praxis interessiert → höchstes Gewicht.
   · Ruhepuls und HRV sind die am besten belegten passiven Marker.
   · Schritte sind aussagekräftig, aber stark vom Alltag überlagert
     (Urlaub, Wochenende, Wetter) → geringeres Gewicht.
   · Schlaf und Temperatur sind Zusatzsignale mit dünnerer Datenlage. */
export const WEIGHTS = {
  pain:    1.30,
  stiff:   1.15,
  rhr:     1.00,
  hrv:     0.95,
  global:  0.90,
  fatigue: 0.80,
  temp:    0.75,
  steps:   0.65,
  sleep:   0.45
};

/* ─────────────────  3. STELLSCHRAUBEN  ───────────────── */
export const GATES = {
  /* Baseline über 28 Tage. Kürzer wäre zu anfällig für Ausreißer,
     länger würde echte Veränderungen (neues Medikament, Jahreszeit)
     zu lange nachziehen. */
  baselineDays: 28,

  /* Die Baseline endet BEWUSST zwei Tage vor dem bewerteten Tag.
     Sonst zieht ein sich aufbauender Schub seine eigene Vergleichs-
     grundlage mit nach oben und macht sich damit selbst unsichtbar —
     genau der Fall, den die App erkennen soll. */
  baselineLag: 2,

  /* Unter so vielen Baseline-Tagen wird kein Risiko ausgewiesen,
     sondern "Baseline wird aufgebaut". Lieber keine Aussage als eine
     auf drei Messwerten. */
  minBaselineDays: 10,

  /* Ab dieser Anzahl Tage gilt die Baseline als voll belastbar; dazwischen
     wird die Konfidenz anteilig abgewertet. */
  goodBaselineDays: 21,

  /* z-Wert, ab dem ein Signal als voll ausgelenkt gilt. Alles darüber
     wird gekappt — ein einzelner Extremwert soll den Score nicht allein
     tragen können. */
  zCap: 3.0,

  /* Logistische Kurve: bei rawMid liegt die Wahrscheinlichkeit bei 50 %,
     steep bestimmt, wie schnell sie von 0 auf 1 läuft. */
  rawMid: 0.34,
  steep:  7.5,

  /* Schwellen für die drei Stufen. */
  elevated: 0.35,
  high:     0.62,

  /* Beharrlichkeit: "hoch" wird nur ausgerufen, wenn der Wert an zwei
     aufeinanderfolgenden Tagen über der Schwelle liegt — oder an einem
     Tag sehr deutlich (spike). Das dämpft Einzeltagsausreißer, ohne
     einen wirklich akuten Schub zu verschleppen. */
  persistDays: 2,
  spike:       0.80,

  /* Medikament vergessen: kein eigenes Signal (dafür ist es zu grob),
     aber ein Aufschlag auf den Rohscore. Ausgelassene Dosen sind ein
     bekannter Auslöser. */
  missedDoseBoost: 0.06,
  missedDoseMax:   0.12
};

/* ─────────────────  4. ROBUSTE STATISTIK  ─────────────────
   Median und MAD statt Mittelwert und Standardabweichung: ein einzelner
   Schubtag in der Baseline-Periode verschiebt den Median kaum, den
   Mittelwert dagegen deutlich. */

export function median(arr){
  const a = arr.filter(n => Number.isFinite(n)).sort((x,y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

/* Median Absolute Deviation, skaliert auf Normalverteilungs-Sigma.
   Der Faktor 1.4826 macht MAD und Standardabweichung vergleichbar,
   sodass die z-Werte die gewohnte Größenordnung haben. */
export function mad(arr, med = null){
  const a = arr.filter(n => Number.isFinite(n));
  if (a.length < 2) return null;
  const m = med ?? median(a);
  return 1.4826 * median(a.map(v => Math.abs(v - m)));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* ─────────────────  5. BASELINE  ─────────────────
   days: Array von Tagesobjekten { key:"YYYY-MM-DD", rhr, hrv, ... }
   Für jedes Signal wird über das Fenster [key - lag - baselineDays,
   key - lag] Median und Streuung gebildet. */

const dayMs = 86400000;
const keyToDate = k => new Date(`${k}T12:00:00`);   // Mittag: immun gegen Sommerzeit
export const dateToKey = d =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
export const shiftKey = (k, n) => dateToKey(new Date(keyToDate(k).getTime() + n * dayMs));

export function baselineFor(days, key, gates = GATES){
  const end   = keyToDate(key).getTime() - gates.baselineLag * dayMs;
  const start = end - gates.baselineDays * dayMs;

  const window = days.filter(d => {
    const t = keyToDate(d.key).getTime();
    return t >= start && t <= end;
  });

  const out = { n:0, per:{} };

  for (const id of SIGNAL_IDS){
    const vals = window.map(d => d[id]).filter(n => Number.isFinite(n));
    if (vals.length < 4){ out.per[id] = null; continue; }   // zu dünn für eine Streuung
    const med = median(vals);
    const spread = Math.max(mad(vals, med) ?? 0, SIGNALS[id].minMad);
    out.per[id] = { med, spread, n: vals.length };
  }

  /* Tage, an denen überhaupt irgendein Signal vorlag — das ist die
     Reifezahl der Baseline, nicht die Zahl pro Einzelsignal. */
  out.n = window.filter(d => SIGNAL_IDS.some(id => Number.isFinite(d[id]))).length;
  return out;
}

/* ─────────────────  6. EINZELSIGNAL BEWERTEN  ─────────────────
   Gibt zurück, wie stark und in welche Richtung ein Signal an diesem
   Tag von der Baseline abweicht — und ob die Abweichung die absolute
   Relevanzschwelle (floor) überhaupt reißt. */

export function scoreSignal(id, value, base){
  const S = SIGNALS[id];
  if (!S || !Number.isFinite(value) || !base) return null;

  const delta = value - base.med;                 // absolute Abweichung, vorzeichenbehaftet
  const adverse = delta * S.dir;                  // > 0 = in die ungünstige Richtung
  const z = delta / base.spread;
  const adverseZ = z * S.dir;

  /* Doppeltes Tor: statistisch auffällig UND absolut relevant. */
  const passesFloor = Math.abs(delta) >= S.floor;
  const active = adverse > 0 && passesFloor;

  /* Beitrag 0…1. Nur die ungünstige Richtung zählt — ein besonders
     guter Tag soll ein schlechtes Signal an anderer Stelle nicht
     wegrechnen können. */
  const load = active ? clamp(adverseZ / GATES.zCap, 0, 1) : 0;

  return {
    id, value, delta, z, adverseZ, load, active, passesFloor,
    baseline: base.med,
    pct: base.med ? (delta / Math.abs(base.med)) * 100 : null
  };
}

/* ─────────────────  7. GESAMTSCORE  ─────────────────
   assess(days, key) bewertet EINEN Tag gegen die Baseline davor.

   days  — alle bekannten Tage, in beliebiger Reihenfolge
   key   — der zu bewertende Tag
   prev  — Ergebnis des Vortags (für die Beharrlichkeitsregel), optional */

export function assess(days, key, prev = null, gates = GATES){
  const today = days.find(d => d.key === key) || { key };
  const base  = baselineFor(days, key, gates);

  /* ── Signale bewerten ── */
  const signals = {};
  let sumW = 0, sumWL = 0;
  const present = { wear:0, pro:0 };

  for (const id of SIGNAL_IDS){
    const s = scoreSignal(id, today[id], base.per[id]);
    if (!s) continue;
    signals[id] = s;
    present[SIGNALS[id].src]++;
    const w = WEIGHTS[id] ?? 1;
    sumW  += w;
    sumWL += w * s.load;
  }

  /* ── Baseline noch zu jung? Dann keine Risikoaussage. ── */
  if (base.n < gates.minBaselineDays){
    return {
      key, level:"building", prob:null, raw:null,
      signals, base, confidence:0,
      baselineDays: base.n,
      needed: gates.minBaselineDays - base.n,
      drivers: [], coverage: present
    };
  }

  /* ── Keine Daten für heute? Ebenfalls keine Aussage. ── */
  if (!sumW){
    return {
      key, level:"nodata", prob:null, raw:null,
      signals, base, confidence:0,
      baselineDays: base.n, drivers: [], coverage: present
    };
  }

  /* Gewichteter Mittelwert der Auslenkungen. Durch die Division nur
     über die VORHANDENEN Gewichte bleibt der Wert vergleichbar,
     egal wie viele Signale an diesem Tag geliefert haben. */
  let raw = sumWL / sumW;

  /* Ausgelassene Dosen als Aufschlag. */
  const missed = Number(today.missedDoses || 0);
  if (missed > 0) raw += Math.min(missed * gates.missedDoseBoost, gates.missedDoseMax);
  raw = clamp(raw, 0, 1);

  /* Logistische Abbildung auf eine Wahrscheinlichkeit. Bewusst als
     "Wahrscheinlichkeit" und nicht als Prozentzahl kommuniziert:
     die Kurve ist kalibriert auf Plausibilität, nicht auf validierte
     Ereignisraten. */
  const prob = 1 / (1 + Math.exp(-gates.steep * (raw - gates.rawMid)));

  /* ── Konfidenz ──
     Zwei Faktoren: wie reif die Baseline ist und wie viele Quellen
     heute geliefert haben. Wearable UND Tages-Check ergibt die
     belastbarste Aussage. */
  const matur = clamp(
    (base.n - gates.minBaselineDays) /
    Math.max(1, gates.goodBaselineDays - gates.minBaselineDays), 0, 1);
  const bothSources = present.wear > 0 && present.pro > 0;
  const cover = bothSources ? 1 : (present.wear || present.pro ? 0.6 : 0);
  const confidence = clamp(0.35 + 0.35 * matur + 0.30 * cover, 0, 1);

  /* ── Stufe mit Beharrlichkeitsregel ── */
  let level = prob >= gates.high ? "high"
            : prob >= gates.elevated ? "elevated"
            : "low";

  /* "hoch" nur bei Bestätigung am Folgetag — oder wenn der Wert für
     sich schon extrem ist. Ein einzelner schlechter Tag ist erst mal
     nur "erhöht".

     prev muss dafür wirklich der Vortag sein: bei einer Lücke im
     Verlauf (Uhr nicht getragen, App nicht geöffnet) ist der letzte
     bekannte Wert keine Bestätigung für heute. */
  if (level === "high" && prob < gates.spike){
    const prevIsYesterday = prev && prev.key === shiftKey(key, -1);
    const prevHigh = prevIsYesterday && prev.prob != null && prev.prob >= gates.high;
    if (!prevHigh) level = "elevated";
  }

  /* ── Treiber: was hat den Score gemacht? ──
     Nach Beitrag sortiert, damit Nutzer und Praxis sofort sehen,
     woran es liegt. */
  const drivers = Object.values(signals)
    .filter(s => s.active)
    .map(s => ({ ...s, weight: WEIGHTS[s.id] ?? 1, share: ((WEIGHTS[s.id] ?? 1) * s.load) / sumWL }))
    .sort((a,b) => b.share - a.share);

  return {
    key, level, prob, raw, signals, base, confidence,
    baselineDays: base.n, drivers, coverage: present, missedDoses: missed
  };
}

/* ─────────────────  8. VERLAUF  ─────────────────
   Bewertet eine ganze Reihe von Tagen der Reihe nach, damit die
   Beharrlichkeitsregel den jeweiligen Vortag kennt. Grundlage für die
   Verlaufskurve und für den Praxisbericht. */

export function assessSeries(days, keys, gates = GATES){
  const sorted = [...keys].sort();
  const out = [];
  let prev = null;
  for (const k of sorted){
    const r = assess(days, k, prev, gates);
    out.push(r);
    prev = r;
  }
  return out;
}

/* Die letzten n Tage bis einschließlich key — auch die ohne Eintrag,
   damit Lücken in der Kurve als Lücken sichtbar bleiben. */
export function lastKeys(key, n){
  return Array.from({ length:n }, (_, i) => shiftKey(key, -(n - 1 - i)));
}

/* ─────────────────  9. DARSTELLUNG  ───────────────── */

/* color = Schrift, ring = Bogen. Zwei Werte je Stufe, weil beide
   Verschiedenes leisten müssen: die Stufenbezeichnung braucht Kontrast,
   der Ring soll ruhig wirken.

   Die Töne sind gegenüber der Signalfarbpalette entsättigt und
   abgedunkelt — das passt zur hellen Glasoberfläche und verbessert
   nebenbei die Lesbarkeit deutlich. Die vorherigen Werte lagen auf dem
   Farbfeld bei 2,24:1 (grün) und 1,83:1 (amber) und rissen damit sogar
   die 3:1-Grenze für große Schrift. Die neuen liegen bei 4,1 bis 5,1:1. */
export const LEVELS = {
  building: { color:"#7C879B", ring:"#C7CFDD" },
  nodata:   { color:"#7C879B", ring:"#C7CFDD" },
  low:      { color:"#217A54", ring:"#46A181" },
  elevated: { color:"#9C6820", ring:"#CE9A4E" },
  high:     { color:"#A8433A", ring:"#C86F66" }
};

/* Abweichung als lesbarer Text: "+6 bpm" statt "z = 2.1". Der z-Wert
   ist die Rechengrundlage, aber niemand denkt in Standardabweichungen. */
export function deltaText(id, s){
  const S = SIGNALS[id];
  if (!S || !s || !Number.isFinite(s.delta)) return "–";

  /* Das Vorzeichen richtet sich nach dem GERUNDETEN Wert, nicht nach dem
     rohen Delta. Sonst wird aus einer Abweichung von −0,004 °C ein
     "−0,00 °C" — ein negatives Nichts, das aussieht wie ein Messfehler. */
  const dec = id === "steps" ? 0 : S.dec;
  const rounded = Number(s.delta.toFixed(dec));
  const v = Math.abs(rounded);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  if (id === "steps") return `${sign}${v.toLocaleString("de-DE")}`;
  /* Deutsches Dezimalkomma — sonst steht neben dem Wert "33,50" die
     Abweichung "+0.39" und es sieht aus wie zwei verschiedene Systeme. */
  const n = v.toLocaleString("de-DE", { minimumFractionDigits:S.dec, maximumFractionDigits:S.dec });
  // Skalen schreiben sich "+5/10", Einheiten "+11 bpm"
  return S.unit.startsWith("/") ? `${sign}${n}${S.unit}` : `${sign}${n} ${S.unit}`;
}

/* Prozentangabe fürs Frontend. Bewusst gerundet auf 5er-Schritte —
   eine Nachkommastelle würde eine Genauigkeit vortäuschen, die diese
   Kalibrierung nicht hat. */
export function probPct(prob){
  if (prob == null) return null;
  return Math.round(prob * 100 / 5) * 5;
}
