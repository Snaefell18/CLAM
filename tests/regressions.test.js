import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { assess, shiftKey, GATES } from "../risk.js";
import assessHandler from "../api/assess.js";
import photoHandler from "../api/photo.js";
import reportHandler from "../api/report.js";
import adviceHandler from "../api/advice.js";
import ingestHandler from "../api/ingest.js";
import { applyRiskCatalog } from "../api/_risk_catalog.js";

function response(){
  return {
    code:null, body:null,
    status(code){ this.code = code; return this; },
    json(body){ this.body = body; return this; }
  };
}

test("KI-Endpunkte lehnen Aufrufe ohne Firebase-Anmeldung ab", async () => {
  for (const handler of [assessHandler, photoHandler, reportHandler]){
    const res = response();
    await handler({ method:"POST", headers:{}, body:{} }, res);
    assert.equal(res.code, 401);
    assert.equal(res.body.error, "unauthorized");
  }
});

test("Praxisempfehlung bleibt deaktiviert und Kurzbefehle brauchen neue Schlüssel", async () => {
  const advice = response();
  await adviceHandler({ method:"POST", body:{} }, advice);
  assert.equal(advice.code, 503);
  const ingest = response();
  await ingestHandler({ method:"POST", body:{ token:"alter-klartext-schluessel", rhr:65 } }, ingest);
  assert.equal(ingest.code, 401);
});

function dayLogic(profile, days, current, failCommit = false){
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const start = source.indexOf("function recompute(){");
  const end = source.indexOf("/* ─────────────────  7. ONBOARDING", start);
  assert.ok(start >= 0 && end > start);
  const writes = [];
  const S = { uid:"test", dayKey:current.key, day:current, days:[...days],
    profile, modelVersion:"test-v1", risk:null };
  const context = vm.createContext({
    S, assess, shiftKey, db:{},
    doc:(_db, ...parts) => parts.join("/"),
    writeBatch:() => ({
      set:(path, data) => writes.push({ path, data }),
      commit:async () => { if (failCommit) throw new Error("offline"); }
    }),
    structuredClone, viewingToday:() => true,
    setDoc:async () => {}, renderHome:() => {}, toast:() => {}
  });
  vm.runInContext(`${source.slice(start,end)}\nthis.saveDay = saveDay; this.patchDay = patchDay;`, context);
  return { save:context.saveDay, patch:context.patchDay, S, writes };
}

test("erster Eintrag eines neuen Tages wird mit seinen Werten bewertet und atomar geteilt", async () => {
  const key = "2026-09-22";
  const days = Array.from({ length:35 }, (_, i) => ({
    key:shiftKey(key, i - 35),
    rhr:62 + (i % 3), hrv:48 + (i % 3), steps:8100 + (i % 3)*200,
    sleep:7.2, temp:33.1,
    pain:2 + (i % 3)*0.2, stiff:15 + (i % 3), fatigue:3, global:2
  }));
  const current = { key, rhr:92, hrv:20, steps:2500, sleep:4.5,
    temp:34.2, pain:9, stiff:90, fatigue:9, global:9 };
  const { save, S, writes } = dayLogic({ condition:"ra", doctorUid:"practice" }, days, current);
  await save();
  assert.notEqual(S.day.risk, null);
  assert.equal(S.day.risk.level, "high");
  assert.equal(writes.length, 2);
  assert.equal(writes[0].data.risk.level, writes[1].data.lastRisk.level);
  assert.equal(writes[0].data.risk.modelVersion, "test-v1");
});

test("nicht unterstützte Erkrankungen speichern keine RA-Einstufung", async () => {
  const current = { key:"2026-09-22", rhr:90, neuro:10 };
  const { save, S, writes } = dayLogic({ condition:"ms", doctorUid:"practice" }, [], current);
  await save();
  assert.equal(S.risk.level, "unsupported");
  assert.equal(S.day.risk, null);
  assert.equal(writes[1].data.lastRisk.level, "unsupported");
});

test("fehlgeschlagene Tagesspeicherung nimmt lokale Änderungen zurück", async () => {
  const current = { key:"2026-09-22", pain:2 };
  const { patch, S } = dayLogic({ condition:"ra" }, [current], current, true);
  assert.equal(await patch({ pain:8 }), false);
  assert.equal(S.day.pain, 2);
  assert.equal(S.days[0].pain, 2);
});

test("Katalogwechsel setzt alte Modellschwellen zurück", () => {
  const original = GATES.high;
  const gates = Object.entries(GATES).map(([key, value]) => ({
    key, value:key === "high" ? original + 0.1 : value
  }));
  assert.equal(applyRiskCatalog({ version:"changed", gates }), "changed");
  assert.equal(GATES.high, original + 0.1);
  assert.equal(applyRiskCatalog(null), "defaults-v1");
  assert.equal(GATES.high, original);
});
