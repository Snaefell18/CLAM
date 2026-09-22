/* ══════════════════════════════════════════════════════════════════
   CLAM — Testpatienten

   Legt Konten mit fertigen Verläufen an, damit sich alle Zustände der
   App ansehen lassen, ohne 28 Tage lang Werte einzutippen.

   ───────────────────────────────────────────────────────────────────
   WARUM EINE ZWEITE FIREBASE-INSTANZ
   ───────────────────────────────────────────────────────────────────
   createUserWithEmailAndPassword meldet den Aufrufer als den NEUEN
   Nutzer an. Auf der normalen Instanz aufgerufen wäre der Admin nach
   dem ersten Testpatienten aus seinem eigenen Konto geworfen.

   Deshalb läuft das Anlegen über eine zweite, benannte App-Instanz mit
   eigenem Auth-Zustand. Die Adminsitzung auf der Hauptinstanz bleibt
   davon unberührt.

   Der angenehme Nebeneffekt: die Testdaten werden ALS DER JEWEILIGE
   PATIENT geschrieben. Damit greifen genau dieselben Firestore-Regeln
   wie im echten Betrieb — es braucht weder ein Dienstkonto noch eine
   Sonderregel, und ein Fehler im Berechtigungsmodell würde hier sofort
   auffallen statt umgangen zu werden.

   ───────────────────────────────────────────────────────────────────
   WARUM DIE VERLÄUFE NACHGERECHNET WERDEN
   ───────────────────────────────────────────────────────────────────
   Feste Zahlenreihen, die "hoch" ergeben sollen, ergeben irgendwann
   nicht mehr "hoch" — spätestens, wenn im Adminbereich Gewichte oder
   Schwellen geändert werden. Der Generator steigert die Auslenkung
   deshalb schrittweise und prüft nach jedem Schritt mit derselben
   assess-Funktion, die auch die App benutzt, ob die Zielstufe erreicht
   ist. Er ist damit gegen seine eigene Rechengrundlage geschlossen.
   ══════════════════════════════════════════════════════════════════ */

import { initializeApp, deleteApp } from "./backend.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, deleteUser
} from "./backend.js";
import {
  getFirestore, doc, setDoc, deleteDoc, collection, getDocs
} from "./backend.js";

import { CONDITIONS, DRUGS, ICON } from "./data.js";
import { assess, assessSeries, lastKeys, GATES, SIGNALS, probPct } from "./risk.js";
import { resolveCode, CODE_RE } from "./doctor.js";

let ctx = null;   // { db, auth, config, ui }
export function initSeed(c){ ctx = c; }

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

/* .test ist als Domain dauerhaft reserviert und wird nie an jemanden
   vergeben — Testkonten können damit nie versehentlich eine echte
   Adresse treffen. Firebase akzeptiert das Format. */
export const TEST_DOMAIN = "clam.test";
const mailFor = word => `${word}@${TEST_DOMAIN}`;

const dayMs = 86400000;
const keyOf = d => d.toISOString().slice(0,10);
const shift = (key, n) => keyOf(new Date(new Date(`${key}T12:00:00`).getTime() + n*dayMs));

/* ─────────────────  SZENARIEN  ─────────────────
   Jedes zeigt einen anderen Zustand der App. Zusammen decken sie ab,
   was ein Betrachter sehen können muss, ohne wochenlang Daten zu
   sammeln. */

export const SCENARIOS = [
  { id:"low", word:"ruhig", label:"Niedriges Risiko",
    desc:"34 stabile Tage, alles im Normbereich",
    level:"low", condition:"ra", days:34, drugs:["adalimumab","mtx"] },

  { id:"elevated", word:"erhoeht", label:"Erhöhtes Risiko",
    desc:"Beginnende Abweichung über zwei Tage",
    level:"elevated", condition:"ra", days:34, flare:2, drugs:["adalimumab"] },

  { id:"high", word:"schub", label:"Hohes Risiko",
    desc:"Deutlicher Schub, Nachfragen beantwortet, CRP nachgetragen",
    level:"high", condition:"ra", days:34, flare:3, drugs:["adalimumab","mtx"],
    followUp:true, labs:true },

  { id:"reported", word:"gemeldet", label:"Hoch, Bericht gespeichert",
    desc:"Wie oben, Bericht zur eigenen Weitergabe gespeichert",
    level:"high", condition:"ra", days:34, flare:3, drugs:["infliximab"],
    followUp:true, labs:true, reported:true },

  { id:"building", word:"neu", label:"Baseline im Aufbau",
    desc:"Erst sechs Tage erfasst, noch keine Risikoaussage",
    level:"building", condition:"ra", days:6, drugs:["etanercept"] },

  { id:"empty", word:"leer", label:"Ohne Einträge",
    desc:"Profil vorhanden, noch kein einziger Tag",
    level:"nodata", condition:"ibd", days:0, drugs:["vedolizumab"] }
];

/* ─────────────────  VERLAUF ERZEUGEN  ─────────────────
   Ruhige Tage schwanken leicht um einen persönlichen Normalwert, sonst
   wäre die Streuung null und jede noch so kleine Abweichung ergäbe
   einen riesigen z-Wert. */

function baseDay(i, seed){
  const j = n => Math.sin((i + seed) * 2.7) * n;
  return {
    rhr:   62 + j(1.5),
    hrv:   48 + j(4),
    steps: 8200 + j(900),
    sleep: 7.2 + j(0.3),
    temp:  33.10 + j(0.06),
    pain:  2 + Math.abs(j(0.5)),
    stiff: 15 + Math.abs(j(4)),
    fatigue: 3 + Math.abs(j(0.5)),
    global:  2 + Math.abs(j(0.4)),
    medTaken:"yes"
  };
}

/* k steigert die Auslenkung. Die Richtungen entsprechen dem, was die
   Signale als ungünstig werten: Puls und Beschwerden hoch, HRV,
   Aktivität und Schlaf runter. */
function flareDay(i, seed, k, step){
  const b = baseDay(i, seed);
  const f = k * (0.5 + 0.5 * step);          // späte Tage stärker
  return {
    ...b,
    rhr:   b.rhr   + 5 * f,
    hrv:   b.hrv   - 8 * f,
    steps: b.steps - 2200 * f,
    sleep: b.sleep - 0.9 * f,
    temp:  b.temp  + 0.22 * f,
    pain:  Math.min(10, b.pain    + 3.2 * f),
    stiff:              b.stiff   + 45 * f,
    fatigue: Math.min(10, b.fatigue + 2.6 * f),
    global:  Math.min(10, b.global  + 3.0 * f)
  };
}

function buildDays(scn, k, today){
  const out = [];
  const seed = scn.word.length;
  for (let i = scn.days - 1; i >= 0; i--){
    const key = shift(today, -i);
    const inFlare = scn.flare && i < scn.flare;
    out.push({ key, ...(inFlare
      ? flareDay(i, seed, k, (scn.flare - i) / scn.flare)
      : baseDay(i, seed)) });
  }
  return out;
}

/* Steigert die Auslenkung, bis assess die Zielstufe meldet. Läuft gegen
   dieselbe Funktion wie die App — ändert jemand die Gewichte, passt
   sich der Generator an, statt stillschweigend das Falsche zu liefern. */
function daysForLevel(scn, today){
  if (!scn.days) return { days:[], reached:true, k:0 };
  if (scn.level === "building" || scn.level === "low" || !scn.flare){
    const days = buildDays(scn, 0, today);
    const { level:got } = evalLast(days, today);
    return { days, reached: got === scn.level, k:0, got };
  }
  let last = null;
  for (let k = 0.20; k <= 3.2; k += 0.05){
    const days = buildDays(scn, k, today);
    const { level:got, prob } = evalLast(days, today);
    last = { days, k, got, prob };

    if (got !== scn.level) {
      /* Über das Ziel hinaus: bei "erhöht" ergibt weiteres Steigern nur
         noch "hoch". Dann den letzten brauchbaren Stand behalten. */
      if (scn.level === "elevated" && got === "high") break;
      continue;
    }

    /* Bei "erhöht" reicht die Stufe allein nicht. Die Beharrlichkeits-
       regel hält einen einzelnen Tag auch dann noch auf "erhöht", wenn
       die interne Kennzahl längst über der Schwelle für "hoch" liegt.
       Als Demo wäre das irreführend: dort stünde "Erhöht" neben 75 %,
       während die Schwelle bei 62 % liegt. Deshalb muss der Wert hier
       auch im Band liegen. */
    if (scn.level === "elevated" && !(prob >= GATES.elevated && prob < GATES.high)) continue;

    return { ...last, reached:true };
  }
  return { ...last, reached:false };
}

function evalLast(days, today){
  const series = assessSeries(days, lastKeys(today, 4));
  const r = series[series.length - 1];
  return { level:r.level, prob:r.prob ?? 0 };
}

/* Die gespeicherte Momentaufnahme je Tag — im echten Betrieb schreibt
   saveDay sie mit. Ohne sie bliebe der Verlauf im Diagramm leer. */
function withRisk(days, today){
  const keys = days.map(d => d.key);
  const series = assessSeries(days, keys);
  return days.map((d, i) => {
    const r = series[i];
    return { ...d, risk: r.prob == null ? null : {
      level: r.level,
      prob: Math.round(r.prob * 1000) / 1000,
      raw:  Math.round(r.raw  * 1000) / 1000,
      confidence: Math.round(r.confidence * 100) / 100,
      drivers: r.drivers.slice(0,3).map(x => x.id)
    }, updatedAt: new Date().toISOString() };
  });
}

const FOLLOW_UP = {
  at: new Date().toISOString(),
  note: "Seit Montag auch das linke Knie.",
  answers: [
    { q:"Hattest du in den letzten Tagen Fieber, Halsschmerzen oder andere Infektzeichen?", a:"no",  hit:false },
    { q:"Sind mehrere Gelenke gleichzeitig betroffen?", a:"yes", hit:true },
    { q:"Sind Gelenke sichtbar geschwollen oder überwärmt?", a:"yes", hit:true },
    { q:"Schränken die Beschwerden dich im Alltag stärker ein als sonst?", a:"yes", hit:true }
  ]
};

/* ─────────────────  OBERFLÄCHE  ───────────────── */

export function openSeed(back){
  const rows = SCENARIOS.map(s => `
    <button class="consent sel" data-scn="${s.id}" style="margin-top:0;margin-bottom:9px">
      <span class="check">${ICON.check}</span>
      <span class="tx"><b style="color:var(--ink);font-size:14.5px">${esc(s.label)}</b><br>
        ${esc(s.desc)}<br>
        <span style="color:var(--ink-3)">Anmeldung: ${esc(mailFor(s.word))}</span></span>
    </button>`).join("");

  ctx.ui.openSheet("Testpatienten", `
    <p class="sub" style="margin-bottom:18px">Legt Konten mit fertigen Verläufen
       an, damit sich alle Zustände der App ansehen lassen. Die Verläufe werden
       gegen die aktuell eingestellten Gewichte und Schwellen nachgerechnet.</p>

    <p class="group-label">Anzulegen</p>
    ${rows}

    <div class="field" style="margin-top:18px">
      <label for="sd-pass">Passwort für alle Testkonten</label>
      <input id="sd-pass" type="password" autocomplete="new-password"
             placeholder="Eigenes Testpasswort wählen">
      <p class="hint">Mindestens sechs Zeichen. Gilt für alle hier angelegten Konten.</p>
    </div>

    <div class="field">
      <label for="sd-code">Mit Praxis verknüpfen (optional)</label>
      <input id="sd-code" type="text" maxlength="8" placeholder="CLAB1234"
             style="text-transform:uppercase;letter-spacing:.08em;font-weight:700">
      <p class="hint">Praxiscode eintragen, dann erscheinen alle angelegten
         Testpatienten sofort in dieser Praxis.</p>
    </div>

    <div id="sd-out"></div>

    <div class="disclaimer">
      ${ICON.info}
      <p>Die Konten laufen auf der Domain <b>${esc(TEST_DOMAIN)}</b>, die dauerhaft
         reserviert ist und nie an jemanden vergeben wird. Sie lassen sich unten
         wieder vollständig entfernen.</p>
    </div>`, `
    <button class="btn btn-primary" id="sd-go">Anlegen</button>
    <button class="btn btn-glass btn-sm" id="sd-del" style="color:var(--bad)">
      Testpatienten entfernen</button>
    <button class="btn btn-ghost" id="sd-back">Zurück</button>`);

  const picked = new Set(SCENARIOS.map(s => s.id));
  $$("[data-scn]", $("#sheet-body")).forEach(b => b.onclick = () => {
    const id = b.dataset.scn;
    if (picked.has(id)) picked.delete(id); else picked.add(id);
    b.classList.toggle("sel", picked.has(id));
  });

  const code = $("#sd-code");
  code.oninput = () => code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, "");

  $("#sd-back").onclick = back;
  $("#sd-go").onclick   = () => run([...picked], back);
  $("#sd-del").onclick  = () => removeAll(back);
}

/* ─────────────────  ANLEGEN  ───────────────── */

async function run(ids, back){
  const pass = $("#sd-pass").value.trim();
  if (pass.length < 6) return ctx.ui.toast("Das Passwort braucht mindestens sechs Zeichen.");
  if (!ids.length)     return ctx.ui.toast("Nichts ausgewählt.");

  /* Praxiscode einmal über die Hauptinstanz auflösen — der Admin ist
     dort angemeldet und darf lesen. */
  let link = null;
  const raw = $("#sd-code").value.trim();
  if (raw){
    if (!CODE_RE.test(raw)) return ctx.ui.toast("Der Praxiscode passt nicht ins Muster.");
    const r = await resolveCode(ctx.db, raw);
    if (!r.ok) return ctx.ui.toast("Diesen Praxiscode gibt es nicht.");
    link = r;
  }

  $("#sd-go").disabled = true;
  const out = $("#sd-out");
  const today = keyOf(new Date());
  const results = [];

  /* Zweite Instanz: eigener Auth-Zustand, damit die Adminsitzung auf der
     Hauptinstanz unberührt bleibt. */
  const app2 = initializeApp(ctx.config, "clam-seed");
  const auth2 = getAuth(app2);
  const db2 = getFirestore(app2);

  try {
    for (const id of ids){
      const scn = SCENARIOS.find(s => s.id === id);
      out.innerHTML = `<div class="analyzing"><span class="spin"></span>
        ${esc(scn.label)} wird angelegt …</div>`;

      const mail = mailFor(scn.word);
      try {
        let uid;
        try {
          const cred = await createUserWithEmailAndPassword(auth2, mail, pass);
          uid = cred.user.uid;
        } catch (e){
          if (e.code === "auth/email-already-in-use"){
            /* Schon vorhanden: anmelden und überschreiben, statt zu
               scheitern. Ein zweiter Anlauf soll den Stand auffrischen. */
            const cred = await signInWithEmailAndPassword(auth2, mail, pass);
            uid = cred.user.uid;
          } else throw e;
        }

        const built = daysForLevel(scn, today);
        const days  = withRisk(built.days, today);
        const last  = days[days.length - 1];

        if (scn.followUp && last) last.followUp = FOLLOW_UP;
        if (scn.labs && last)     last.labs = { crp: 14.2, esr: 32 };
        if (scn.reported && last) last.reportSaved = {
          at: new Date().toISOString(), level:"high" };

        const cond = CONDITIONS.find(c => c.id === scn.condition) || CONDITIONS[0];
        const profile = {
          onboarded:true, seeded:true,
          condition: scn.condition,
          joints: [...(cond.joints || [])].slice(0,4),
          drugs: scn.drugs.filter(d => DRUGS.some(x => x.id === d)),
          drugEvery: 14,
          nextDose: shift(today, 3),
          wearable:"applewatch",
          practice:{ name:"", mail:"", phone:"" },
          consent:true, consentShare:true,
          createdAt:new Date().toISOString(),
          consentAt:new Date().toISOString()
        };

        if (link){
          Object.assign(profile, {
            doctorUid: link.uid, shareDoctorUid:link.uid, doctorCode: link.code,
            doctorName: link.practice.name || null,
            linkName: scn.label,
            linkedAt: new Date().toISOString()
          });
          const r = days.length
            ? assess(days, today, assess(days, shift(today, -1)))
            : { level:"nodata", prob:null, confidence:null, drivers:[] };
          profile.lastRisk = {
            level: scn.condition === "ra" ? r.level : "unsupported",
            prob: scn.condition === "ra" && r.prob != null ? Math.round(r.prob * 1000) / 1000 : null,
            confidence: scn.condition === "ra" && r.confidence != null ? Math.round(r.confidence * 100) / 100 : null,
            drivers: scn.condition === "ra" ? (r.drivers || []).slice(0,3).map(x => x.id) : [],
            date: today, at: new Date().toISOString()
          };
        }

        await setDoc(doc(db2, "users", uid), profile);
        for (const d of days){
          const { key, ...rest } = d;
          await setDoc(doc(db2, "users", uid, "days", key), rest);
        }
        if (scn.reported && last){
          await setDoc(doc(db2, "users", uid, "reports", "seed-report"), {
            at:last.reportSaved.at, dayKey:today, level:"high", status:"stored",
            summary:"Synthetischer Testbericht aus CLAM. Dieser Text wurde gespeichert, aber nicht an eine Praxis versendet.",
            practice:{ name:link?.practice.name || null, mail:null }
          });
        }

        results.push({ scn, mail, ok:true, ...built });
      } catch (e){
        results.push({ scn, mail, ok:false, msg: e.message || String(e) });
      } finally {
        await signOut(auth2).catch(() => {});
      }
    }
  } finally {
    await deleteApp(app2).catch(() => {});
  }

  const good = results.filter(r => r.ok).length;
  out.innerHTML = `
    <p class="group-label" style="margin-top:20px">Ergebnis</p>
    <div class="glass drv">
      ${results.map(r => `
        <div class="drv-item">
          <span class="ic" style="background:${r.ok
            ? "rgba(70,161,129,.14)" : "rgba(168,67,58,.14)"}">${r.ok ? ICON.check : ICON.alert}</span>
          <span class="tx"><b>${esc(r.scn.label)}</b>
            <span>${r.ok
              ? esc(`${r.mail} · Stufe ${r.got || r.scn.level}${r.reached === false ? " (Ziel nicht erreicht)" : ""}`)
              : esc(r.msg)}</span></span>
        </div>`).join("")}
    </div>
    ${link ? `<p class="hint">Verknüpft mit ${esc(link.practice.name || link.code)}.</p>` : ""}`;

  $("#sd-go").disabled = false;
  ctx.ui.toast(good === results.length
    ? `${good} Testpatienten angelegt.`
    : `${good} von ${results.length} angelegt.`);
}

/* ─────────────────  ENTFERNEN  ─────────────────
   Auch hier über die zweite Instanz: um ein Konto zu löschen, muss man
   als dieses Konto angemeldet sein. Ohne diesen Weg sammeln sich
   Testkonten an, die niemand mehr wegbekommt. */

async function removeAll(back){
  const pass = $("#sd-pass").value.trim();
  if (pass.length < 6) return ctx.ui.toast("Bitte das Passwort der Testkonten eintragen.");

  $("#sd-del").disabled = true;
  const out = $("#sd-out");
  const app2 = initializeApp(ctx.config, "clam-seed-del");
  const auth2 = getAuth(app2);
  const db2 = getFirestore(app2);
  let gone = 0, missing = 0;

  try {
    for (const scn of SCENARIOS){
      const mail = mailFor(scn.word);
      out.innerHTML = `<div class="analyzing"><span class="spin"></span>
        ${esc(mail)} wird entfernt …</div>`;
      try {
        const cred = await signInWithEmailAndPassword(auth2, mail, pass);
        const uid = cred.user.uid;
        for (const sub of ["days", "photos", "reports"]){
          const snap = await getDocs(collection(db2, "users", uid, sub));
          await Promise.all(snap.docs.map(d => deleteDoc(doc(db2, "users", uid, sub, d.id))));
        }
        await deleteDoc(doc(db2, "users", uid));
        await deleteUser(cred.user);
        gone++;
      } catch (e){
        if (["auth/user-not-found","auth/invalid-credential"].includes(e.code)) missing++;
        else console.warn(mail, e.message);
      }
    }
  } finally {
    await deleteApp(app2).catch(() => {});
  }

  out.innerHTML = `<p class="note">${gone} Konten entfernt${
    missing ? `, ${missing} waren nicht vorhanden` : ""}.</p>`;
  $("#sd-del").disabled = false;
  ctx.ui.toast(`${gone} Testpatienten entfernt.`);
}
