#!/usr/bin/env node
// Compares two runs of src/lib/eval/miss-report.test.ts (their EVAL_LABELS files, or folders of
// labels-*.json from sharded runs): label counts before and after, every change of label by kind,
// and the moves that changed, with what decided them.
//
//   node scripts/eval/miss-diff.mjs scripts/eval/out/miss-base scripts/eval/out/miss-new [label=miss] [max=20]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [a, b, label = "miss", maxArg] = process.argv.slice(2);
if (!a || !b) {
  console.error("Usage: node scripts/eval/miss-diff.mjs <before> <after> [label] [max]");
  process.exit(1);
}
const max = Number(maxArg ?? 20);
const load = (p) =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .filter((f) => /^labels.*\.json$/.test(f))
        .flatMap((f) => JSON.parse(readFileSync(join(p, f), "utf8")))
    : JSON.parse(readFileSync(p, "utf8"));
const key = (r) => `${r.url}#${r.ply}`;
const before = new Map(load(a).map((r) => [key(r), r]));
const after = load(b);

const count = (rows) => rows.reduce((t, r) => ((t[r.cls] = (t[r.cls] ?? 0) + 1), t), {});
console.log("before", count([...before.values()]));
console.log("after ", count(after));

const changes = new Map();
for (const r of after) {
  const o = before.get(key(r));
  if (!o || o.cls === r.cls) continue;
  const k = `${o.cls} → ${r.cls}`;
  changes.set(k, [...(changes.get(k) ?? []), { o, r }]);
}
console.log("\nChanges:");
for (const [k, list] of [...changes].sort((x, y) => y[1].length - x[1].length)) console.log(`  ${String(list.length).padStart(4)}  ${k}`);

const pct = (x) => `${Math.round(100 * x)}%`;
for (const [k, list] of changes) {
  if (!k.includes(label)) continue;
  console.log(`\n${k} (${list.length}):`);
  for (const { r } of list.slice(0, max)) {
    console.log(`  ${r.san} ${r.evalBefore} → ${r.evalAfter}, ${pct(r.before)} → ${pct(r.after)}, after ${r.prev ?? "the start"}  ${r.url}#${r.ply}`);
    console.log(`      best ${r.best} [${r.bestGain >= 0 ? "+" : ""}${r.bestGain}]   game ${r.game} [${r.playedGain >= 0 ? "+" : ""}${r.playedGain}]`);
  }
}
