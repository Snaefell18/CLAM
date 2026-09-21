import { SIGNALS, SIGNAL_IDS, WEIGHTS, GATES } from "../risk.js";

const defaults = {
  signals:structuredClone(SIGNALS),
  weights:structuredClone(WEIGHTS),
  gates:structuredClone(GATES)
};

function replace(target, rows, shape){
  if (!Array.isArray(rows) || !rows.length) return;
  const next = {};
  for (const row of rows){
    if (shape === "pairs") next[row.key] = Number(row.value);
    else {
      const { id, ...data } = row;
      next[id] = data;
    }
  }
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

export function applyRiskCatalog(catalog){
  for (const [target, source] of [
    [SIGNALS, defaults.signals], [WEIGHTS, defaults.weights], [GATES, defaults.gates]
  ]){
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, structuredClone(source));
  }
  SIGNAL_IDS.splice(0, SIGNAL_IDS.length, ...Object.keys(SIGNALS));
  if (!catalog) return "defaults-v1";
  replace(SIGNALS, catalog.signals, "map");
  SIGNAL_IDS.splice(0, SIGNAL_IDS.length, ...Object.keys(SIGNALS));
  replace(WEIGHTS, catalog.weights, "pairs");
  replace(GATES, catalog.gates, "pairs");
  return catalog.version || catalog.updatedAt || "legacy";
}
