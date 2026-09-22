/* ══════════════════════════════════════════════════════════════════
   CLAM — Adminbereich

   Pflegt die Stammdaten, auf denen die ganze App rechnet: Erkrankungen,
   Wirkstoffe, Signale, Gewichte, Schwellen, Laborwerte, Regionen,
   Wearables und die Fragen des Tages-Checks.

   ───────────────────────────────────────────────────────────────────
   ZUGANG
   ───────────────────────────────────────────────────────────────────
   Es gibt genau einen fest verdrahteten Wurzel-Admin (ROOT_ADMIN). Alle
   weiteren Admins trägt er in config/admins ein.

   Die Prüfung im Frontend entscheidet nur, ob das Menü sichtbar ist.
   Verbindlich ist sie NICHT — verbindlich sind die Firestore-Regeln, die
   dieselbe Bedingung serverseitig noch einmal ziehen. Wer die Prüfung
   hier im Browser aushebelt, bekommt vom Server trotzdem nichts.

   ───────────────────────────────────────────────────────────────────
   VORSICHT BEIM ÄNDERN
   ───────────────────────────────────────────────────────────────────
   Gewichte und Schwellen wirken sofort auf alle Nutzer und verändern
   deren angezeigtes Risiko. Der Bereich sagt das an den betreffenden
   Stellen deutlich; gespeicherte Tagesbewertungen bleiben unberührt,
   damit der Verlauf nicht rückwirkend umgeschrieben wird.
   ══════════════════════════════════════════════════════════════════ */

import {
  doc, getDoc, setDoc, collection, getDocs, updateDoc
} from "./backend.js";

import {
  TABLES, tableById, readTable, writeTable, snapshot, validate,
  saveCatalog, resetToDefaults, defaultsFor, parseCell, formatCell
} from "./catalog.js";
import { ICON } from "./data.js";
import { openSeed } from "./seed.js";

/* Der Wurzel-Admin steht bewusst im Code UND in den Firestore-Regeln.
   Er lässt sich über die Oberfläche nicht entfernen — sonst könnte sich
   das Projekt selbst aussperren. */
export const ROOT_ADMIN = "jan.rentzsch@googlemail.com";

let ctx = null;      // { db, auth, ui, onSaved }
let adminEmails = [];

export function initAdmin(c){ ctx = c; }

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));

const myEmail = () => (ctx?.auth?.currentUser?.email || "").toLowerCase();
export const isRoot = () => ctx?.auth?.currentUser?.emailVerified === true && myEmail() === ROOT_ADMIN;

/* ─────────────────  ZUGANG PRÜFEN  ─────────────────
   Der Wurzel-Admin steht fest. Für alle anderen ist der Leseversuch auf
   config/admins selbst die Prüfung: die Regeln geben das Dokument nur
   an Admins heraus. Damit muss die Liste der Admin-Adressen nicht für
   jeden lesbar sein, nur damit die App weiß, wer Admin ist. */
export async function checkAdmin(){
  if (!ctx?.auth?.currentUser?.emailVerified) return false;
  if (isRoot()) { await loadAdminList(); return true; }
  try {
    const snap = await getDoc(doc(ctx.db, "config", "admins"));
    adminEmails = snap.exists() ? (snap.data().emails || []) : [];
    return adminEmails.map(e => e.toLowerCase()).includes(myEmail());
  } catch { return false; }
}

async function loadAdminList(){
  try {
    const snap = await getDoc(doc(ctx.db, "config", "admins"));
    adminEmails = snap.exists() ? (snap.data().emails || []) : [];
  } catch { adminEmails = []; }
  return adminEmails;
}

/* ─────────────────  HAUPTMENÜ  ───────────────── */

export function openAdmin(){
  const rows = TABLES.map(t => {
    const n = readTable(t).length;
    return `
      <button class="set-row" data-tbl="${t.id}">
        <span class="tx"><b>${esc(t.label)}</b>
          <span>${n} ${n === 1 ? "Eintrag" : "Einträge"}</span></span>
        ${ICON.chev}
      </button>`;
  }).join("");

  ctx.ui.openSheet("Adminbereich", `
    <div class="flag" style="margin-bottom:18px">
      <span class="dot" style="background:var(--lvl-elevated-soft)"></span>
      <span class="tx"><b>Diese Tabellen gelten für alle Nutzer</b>
        Änderungen an Signalen, Gewichten und Schwellen verändern sofort das
        angezeigte Risiko. Bereits gespeicherte Tagesbewertungen bleiben stehen.</span>
    </div>

    <div class="settings-grp">
      <p class="eyebrow">Stammdaten</p>
      ${rows}
    </div>

    <div class="settings-grp">
      <p class="eyebrow">Austausch</p>
      <button class="set-row" data-act="export">
        <span class="tx"><b>Als Excel exportieren</b>
          <span>Eine Mappe, ein Blatt je Tabelle</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="import">
        <span class="tx"><b>Aus Excel importieren</b>
          <span>Wird vor dem Übernehmen geprüft</span></span>
        ${ICON.chev}
      </button>
    </div>

    <div class="settings-grp">
      <p class="eyebrow">Verwaltung</p>
      <button class="set-row" data-act="admins">
        <span class="tx"><b>Admins</b>
          <span>${adminEmails.length + 1} ${adminEmails.length ? "Personen" : "Person"}</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="practices">
        <span class="tx"><b>Praxen prüfen</b>
          <span>Identität vor dem Zugriff auf Patientendaten bestätigen</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="seed">
        <span class="tx"><b>Testpatienten</b>
          <span>Konten mit fertigen Verläufen für alle Risikostufen</span></span>
        ${ICON.chev}
      </button>
      <button class="set-row" data-act="reset">
        <span class="tx"><b style="color:var(--bad)">Auf Vorgaben zurücksetzen</b>
          <span>Alle Tabellen auf den Auslieferungsstand</span></span>
        ${ICON.chev}
      </button>
    </div>

    <p class="hint" style="text-align:center">
      Angemeldet als ${esc(myEmail())}${isRoot() ? " · Wurzel-Admin" : ""}</p>`);

  $$(".set-row", $("#sheet-body")).forEach(el => el.onclick = () => {
    if (el.dataset.tbl) return openTable(el.dataset.tbl);
    const a = el.dataset.act;
    if (a === "export") return exportXlsx();
    if (a === "import") return importXlsx();
    if (a === "admins") return openAdmins();
    if (a === "practices") return openPractices();
    if (a === "seed")   return openSeed(openAdmin);
    if (a === "reset")  return confirmReset();
  });
}

/* ─────────────────  TABELLE  ─────────────────
   Auf einem Telefon ist ein echtes Raster nicht bedienbar. Deshalb:
   waagerecht scrollbare Übersicht zum Lesen, Zeile antippen zum
   Bearbeiten in einem Formular. */

function openTable(id){
  const t = tableById(id);
  const rows = readTable(t);
  const cols = colsOf(t);

  const head = cols.map(c => `<th>${esc(c.label)}</th>`).join("");
  const body = rows.map((r, i) => `
    <tr data-i="${i}">
      ${cols.map(c => `<td>${esc(String(formatCell(c, r[c.key])).slice(0, 40))}</td>`).join("")}
    </tr>`).join("");

  ctx.ui.openSheet(t.label, `
    ${t.hint ? `<p class="hint" style="margin:0 2px 16px">${esc(t.hint)}</p>` : ""}
    <div class="tbl-wrap">
      <table class="tbl">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="hint">Zeile antippen zum Bearbeiten.</p>`, `
    <button class="btn btn-primary" id="tb-add">Zeile hinzufügen</button>
    <button class="btn btn-glass btn-sm" id="tb-back">Zurück</button>`);

  $$("#sheet-body tbody tr").forEach(tr =>
    tr.onclick = () => openRow(id, Number(tr.dataset.i)));
  $("#tb-add").onclick  = () => openRow(id, null);
  $("#tb-back").onclick = openAdmin;
}

/* Spalten einer Tabelle — Zahlenpaare bekommen ihre beiden Spalten hier,
   damit der Rest des Bereichs nicht zwischen den Formen unterscheiden muss. */
function colsOf(t){
  if (t.shape !== "pairs") return t.cols;
  return [
    { key:"key",   label:t.keyLabel || "Schlüssel", type:"text", req:true },
    { key:"value", label:t.valLabel || "Wert",      type:"num",  req:true }
  ];
}

/* ─────────────────  ZEILE BEARBEITEN  ───────────────── */

function openRow(tableId, index){
  const t = tableById(tableId);
  const cols = colsOf(t);
  const rows = readTable(t);
  const isNew = index === null;
  const row = isNew ? {} : rows[index];
  const draft = { ...row };

  const fields = cols.map(c => {
    const v = draft[c.key];
    if (c.type === "bool") return `
      <button class="consent${v ? " sel" : ""}" data-bool="${c.key}" style="margin-top:0;margin-bottom:12px">
        <span class="check">${ICON.check}</span>
        <span class="tx">${esc(c.label)}${c.help ? `<br><span style="color:var(--ink-3)">${esc(c.help)}</span>` : ""}</span>
      </button>`;
    return `
      <div class="field">
        <label for="rw-${c.key}">${esc(c.label)}${c.req ? " *" : ""}</label>
        <input id="rw-${c.key}" type="${c.type === "num" ? "number" : "text"}"
               ${c.type === "num" ? 'inputmode="decimal" step="any"' : ""}
               value="${esc(formatCell(c, v))}">
        ${c.help ? `<p class="hint">${esc(c.help)}</p>` : ""}
      </div>`;
  }).join("");

  ctx.ui.openSheet(isNew ? `${t.label} · neu` : `${t.label} · bearbeiten`, fields, `
    <button class="btn btn-primary" id="rw-save">${isNew ? "Hinzufügen" : "Speichern"}</button>
    ${isNew ? "" : `<button class="btn btn-glass btn-sm" id="rw-del"
      style="color:var(--bad)">Zeile löschen</button>`}
    <button class="btn btn-ghost" id="rw-cancel">Abbrechen</button>`);

  $$("[data-bool]", $("#sheet-body")).forEach(b => b.onclick = () => {
    const k = b.dataset.bool;
    draft[k] = !draft[k];
    b.classList.toggle("sel", !!draft[k]);
  });

  $("#rw-cancel").onclick = () => openTable(tableId);

  $("#rw-save").onclick = () => {
    for (const c of cols){
      if (c.type === "bool") continue;
      draft[c.key] = parseCell(c, $(`#rw-${c.key}`).value);
    }
    const next = isNew ? [...rows, draft] : rows.map((r, i) => i === index ? draft : r);
    const errs = validate(t, next);
    if (errs.length) return ctx.ui.toast(errs[0]);
    commit(t, next, () => openTable(tableId));
  };

  const del = $("#rw-del");
  if (del) del.onclick = () => {
    const next = rows.filter((_, i) => i !== index);
    const errs = validate(t, next);
    if (errs.length) return ctx.ui.toast(errs[0]);
    commit(t, next, () => openTable(tableId));
  };
}

/* Übernimmt eine geänderte Tabelle: erst lokal anwenden, dann speichern.
   Schlägt das Speichern fehl, wird die Änderung zurückgerollt — sonst
   liefe die App auf Werten, die auf keinem anderen Gerät ankommen. */
async function commit(t, rows, done){
  const backup = readTable(t);
  writeTable(t, rows);
  try {
    const saved = await saveCatalog(ctx.db, myEmail());
    ctx.onSaved?.(saved);
    ctx.ui.toast("Gespeichert.");
    done?.();
  } catch (e){
    writeTable(t, backup);
    ctx.ui.toast("Speichern fehlgeschlagen — Änderung verworfen.");
  }
}

/* ─────────────────  ADMINS  ───────────────── */

async function openAdmins(){
  await loadAdminList();
  const list = adminEmails.map((e, i) => `
    <div class="hist-item">
      <span class="dot" style="background:var(--blue-500)"></span>
      <span class="tx"><b>${esc(e)}</b><span>Admin</span></span>
      ${isRoot() ? `<button class="icon-btn" data-del="${i}" aria-label="Entfernen"
        style="width:32px;height:32px">${ICON.chev}</button>` : ""}
    </div>`).join("");

  ctx.ui.openSheet("Admins", `
    <div class="hist-item" style="margin-bottom:8px">
      <span class="dot" style="background:var(--lvl-low-soft)"></span>
      <span class="tx"><b>${esc(ROOT_ADMIN)}</b><span>Wurzel-Admin, fest hinterlegt</span></span>
    </div>
    ${list}
    ${isRoot() ? `
      <div class="field" style="margin-top:18px">
        <label for="ad-mail">Weiteren Admin hinzufügen</label>
        <input id="ad-mail" type="email" placeholder="name@beispiel.de">
      </div>` : `
      <p class="hint" style="margin-top:18px">Nur der Wurzel-Admin kann
        Admins hinzufügen oder entfernen.</p>`}`, `
    ${isRoot() ? `<button class="btn btn-primary" id="ad-add">Hinzufügen</button>` : ""}
    <button class="btn btn-glass btn-sm" id="ad-back">Zurück</button>`);

  $("#ad-back").onclick = openAdmin;

  const add = $("#ad-add");
  if (add) add.onclick = async () => {
    const mail = $("#ad-mail").value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return ctx.ui.toast("Keine gültige E-Mail-Adresse.");
    if (mail === ROOT_ADMIN) return ctx.ui.toast("Das ist bereits der Wurzel-Admin.");
    if (adminEmails.includes(mail)) return ctx.ui.toast("Steht schon auf der Liste.");
    await saveAdmins([...adminEmails, mail]);
  };

  $$("[data-del]", $("#sheet-body")).forEach(b => b.onclick = async () => {
    const i = Number(b.dataset.del);
    await saveAdmins(adminEmails.filter((_, x) => x !== i));
  });
}

async function saveAdmins(emails){
  try {
    await setDoc(doc(ctx.db, "config", "admins"), { emails, updatedAt:new Date().toISOString() });
    adminEmails = emails;
    ctx.ui.toast("Gespeichert.");
    openAdmins();
  } catch { ctx.ui.toast("Speichern fehlgeschlagen."); }
}

async function openPractices(){
  let practices;
  try {
    const snap = await getDocs(collection(ctx.db, "doctors"));
    practices = snap.docs.map(d => ({ uid:d.id, ...d.data() }));
  } catch { return ctx.ui.toast("Praxen konnten nicht geladen werden."); }
  ctx.ui.openSheet("Praxen prüfen", practices.length ? practices.map(p => `
    <div class="glass card" style="margin-bottom:12px">
      <b>${esc(p.name || "Praxis")}</b>
      <p class="sub">${esc(p.physician || "")} · ${esc(p.mail || p.email || "")}</p>
      <p class="hint">${p.verified === true ? "Freigeschaltet" : "Nicht verifiziert"}</p>
      <button class="btn btn-glass btn-sm" data-practice="${esc(p.uid)}"
        data-verified="${p.verified === true ? "false" : "true"}">
        ${p.verified === true ? "Zugang sperren" : "Nach Identitätsprüfung freischalten"}
      </button>
    </div>`).join("") : `<p class="empty">Noch keine Praxen registriert.</p>`,
    `<button class="btn btn-glass" id="pr-back">Zurück</button>`);
  $("#pr-back").onclick = openAdmin;
  $$("[data-practice]", $("#sheet-body")).forEach(button => button.onclick = async () => {
    button.disabled = true;
    try {
      await updateDoc(doc(ctx.db, "doctors", button.dataset.practice), {
        verified:button.dataset.verified === "true",
        verifiedAt:new Date().toISOString(),
        verifiedBy:myEmail()
      });
      ctx.ui.toast("Praxisstatus gespeichert.");
      openPractices();
    } catch { button.disabled = false; ctx.ui.toast("Änderung fehlgeschlagen."); }
  });
}

/* ─────────────────  ZURÜCKSETZEN  ───────────────── */

function confirmReset(){
  ctx.ui.openSheet("Auf Vorgaben zurücksetzen", `
    <div class="glass card">
      <h3>Alle Tabellen werden überschrieben</h3>
      <p class="sub" style="margin-top:8px">Erkrankungen, Wirkstoffe, Signale,
        Gewichte, Schwellen und alles Übrige gehen auf den Auslieferungsstand
        zurück. Eigene Ergänzungen sind danach weg.</p>
      <p class="sub" style="margin-top:10px">Exportiere vorher nach Excel, wenn
        du deinen Stand behalten willst.</p>
    </div>`, `
    <button class="btn btn-glass btn-sm" id="rs-export">Erst exportieren</button>
    <button class="btn" id="rs-go" style="background:var(--bad);color:#fff">
      Zurücksetzen</button>
    <button class="btn btn-ghost" id="rs-cancel">Abbrechen</button>`);

  $("#rs-cancel").onclick = openAdmin;
  $("#rs-export").onclick = exportXlsx;
  $("#rs-go").onclick = async () => {
    $("#rs-go").disabled = true;
    const backup = snapshot();
    resetToDefaults();
    try {
      const saved = await saveCatalog(ctx.db, myEmail());
      ctx.onSaved?.(saved);
      ctx.ui.toast("Auf Vorgaben zurückgesetzt.");
      openAdmin();
    } catch {
      for (const t of TABLES) writeTable(t, backup[t.id]);
      $("#rs-go").disabled = false;
      ctx.ui.toast("Speichern fehlgeschlagen — nichts geändert.");
    }
  };
}

/* ─────────────────  EXCEL  ─────────────────
   SheetJS wird erst geladen, wenn jemand tatsächlich exportiert oder
   importiert. Für die 99 % der Nutzer, die nie in den Adminbereich
   kommen, fällt die Bibliothek damit gar nicht an. */

let xlsxPromise = null;
function loadXLSX(){
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (!xlsxPromise) xlsxPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload  = () => window.XLSX ? res(window.XLSX) : rej(new Error("Bibliothek unvollständig."));
    s.onerror = () => rej(new Error("Excel-Bibliothek konnte nicht geladen werden."));
    document.head.appendChild(s);
  });
  return xlsxPromise;
}

/* Blattnamen dürfen in Excel höchstens 31 Zeichen haben. */
const sheetName = t => t.label.slice(0, 31);

async function exportXlsx(){
  ctx.ui.toast("Mappe wird erstellt …");
  let XLSX;
  try { XLSX = await loadXLSX(); }
  catch (e){ return ctx.ui.toast(e.message); }

  const wb = XLSX.utils.book_new();
  for (const t of TABLES){
    const cols = colsOf(t);
    /* Kopfzeile trägt die Beschriftungen, nicht die technischen Schlüssel:
       die Mappe soll auch für jemanden lesbar sein, der den Code nicht
       kennt. Der Import akzeptiert beides. */
    const aoa = [cols.map(c => c.label)];
    for (const r of readTable(t)) aoa.push(cols.map(c => formatCell(c, r[c.key])));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName(t));
  }

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `clam-stammdaten-${today}.xlsx`);
  ctx.ui.toast("Export heruntergeladen.");
}

function importXlsx(){
  ctx.ui.openSheet("Aus Excel importieren", `
    <p class="sub" style="margin-bottom:18px">Die Mappe muss dieselben Blätter
      und Spalten haben wie der Export. Blätter, die fehlen, bleiben unverändert.</p>
    <button class="shot" id="im-pick" style="padding:0">
      <div class="drop">
        ${ICON.lab}
        <b>Datei wählen</b>
        <small>.xlsx aus dem Export, gerne bearbeitet</small>
      </div>
    </button>
    <input type="file" id="im-file" accept=".xlsx,.xls" hidden>
    <div id="im-out"></div>`, `
    <button class="btn btn-glass btn-sm" id="im-back">Zurück</button>`);

  $("#im-back").onclick = openAdmin;
  $("#im-pick").onclick = () => $("#im-file").click();
  $("#im-file").onchange = e => {
    const f = e.target.files?.[0];
    if (f) readWorkbook(f);
  };
}

async function readWorkbook(file){
  $("#im-out").innerHTML = `<div class="analyzing"><span class="spin"></span>
    Mappe wird gelesen …</div>`;
  let XLSX;
  try { XLSX = await loadXLSX(); }
  catch (e){ return ($("#im-out").innerHTML = `<p class="note" style="color:var(--bad)">${esc(e.message)}</p>`); }

  let wb;
  try {
    wb = XLSX.read(await file.arrayBuffer(), { type:"array" });
  } catch {
    return ($("#im-out").innerHTML = `<p class="note" style="color:var(--bad)">
      Die Datei konnte nicht gelesen werden.</p>`);
  }

  /* Erst komplett prüfen, dann anzeigen, erst nach Bestätigung übernehmen.
     Ein Import, der eine Tabelle einspielt und bei der nächsten abbricht,
     hinterlässt einen Stand, den niemand mehr nachvollziehen kann. */
  const staged = [];
  const problems = [];

  for (const t of TABLES){
    const ws = wb.Sheets[sheetName(t)];
    if (!ws) continue;
    const cols = colsOf(t);
    const aoa = XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
    if (aoa.length < 2){ problems.push(`${t.label}: keine Datenzeilen.`); continue; }

    const header = aoa[0].map(h => String(h).trim());
    const index = {};
    for (const c of cols){
      let i = header.indexOf(c.label);
      if (i < 0) i = header.indexOf(c.key);      // technische Schlüssel auch zulassen
      index[c.key] = i;
    }
    const missing = cols.filter(c => c.req && index[c.key] < 0).map(c => c.label);
    if (missing.length){ problems.push(`${t.label}: Spalte ${missing.join(", ")} fehlt.`); continue; }

    const rows = aoa.slice(1)
      .filter(line => line.some(v => String(v).trim() !== ""))
      .map(line => {
        const r = {};
        for (const c of cols) if (index[c.key] >= 0) r[c.key] = parseCell(c, line[index[c.key]]);
        return r;
      });

    const errs = validate(t, rows);
    if (errs.length){ problems.push(`${t.label}: ${errs[0]}`); continue; }
    staged.push({ t, rows, before:readTable(t).length });
  }

  if (!staged.length){
    return ($("#im-out").innerHTML = `
      <p class="note" style="color:var(--bad)">Nichts übernehmbar.</p>
      ${problems.map(p => `<p class="hint">· ${esc(p)}</p>`).join("")}`);
  }

  $("#im-out").innerHTML = `
    <p class="group-label" style="margin-top:20px">Wird übernommen</p>
    <div class="glass drv">
      ${staged.map(s => `
        <div class="drv-item">
          <span class="ic">${ICON.check}</span>
          <span class="tx"><b>${esc(s.t.label)}</b>
            <span>${s.before} → ${s.rows.length} ${s.rows.length === 1 ? "Eintrag" : "Einträge"}</span></span>
        </div>`).join("")}
    </div>
    ${problems.length ? `
      <p class="group-label">Übersprungen</p>
      ${problems.map(p => `<p class="hint">· ${esc(p)}</p>`).join("")}` : ""}`;

  $("#sheet-foot").innerHTML = `
    <button class="btn btn-primary" id="im-go">Übernehmen</button>
    <button class="btn btn-ghost" id="im-cancel">Abbrechen</button>`;
  $("#im-cancel").onclick = openAdmin;
  $("#im-go").onclick = async () => {
    $("#im-go").disabled = true;
    const backup = snapshot();
    for (const s of staged) writeTable(s.t, s.rows);
    try {
      const saved = await saveCatalog(ctx.db, myEmail());
      ctx.onSaved?.(saved);
      ctx.ui.toast(`${staged.length} ${staged.length === 1 ? "Tabelle" : "Tabellen"} übernommen.`);
      openAdmin();
    } catch {
      for (const t of TABLES) writeTable(t, backup[t.id]);
      $("#im-go").disabled = false;
      ctx.ui.toast("Speichern fehlgeschlagen — nichts geändert.");
    }
  };
}
