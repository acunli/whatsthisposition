/**
 * The guided tour: the handful of findings that matter most, in the order a coach
 * would point them out. Urgent tactics first, then the biggest strengths and
 * weaknesses, alternating sides so neither is forgotten.
 */
import type { Color } from "../chess/types";
import type { Ledger, LedgerEntry } from "./ledger";
import type { Fact } from "./types";

export interface Scene {
  id: string;
  fact: Fact;
  label: string;
  polarity: "strength" | "weakness";
  side: Color;
}

const URGENT = new Set(["check", "mate-in-one", "engine-threat", "hanging", "attacked-by-cheaper", "fork", "skewer", "back-rank"]);

export function buildTour(ledger: Ledger, turn: Color, max = 7): Scene[] {
  const toScene = (e: LedgerEntry, side: Color): Scene => ({ id: e.fact.id, fact: e.fact, label: e.label, polarity: e.polarity, side });
  const pool: Scene[] = [];
  for (const c of ["w", "b"] as Color[]) {
    for (const e of [...ledger[c].strengths, ...ledger[c].weaknesses]) pool.push(toScene(e, c));
  }
  const urgent = pool.filter((s) => URGENT.has(s.fact.kind)).sort((a, b) => b.fact.priority - a.fact.priority);
  const rest = pool.filter((s) => !URGENT.has(s.fact.kind));
  const bySide = (c: Color) => rest.filter((s) => s.side === c).sort((a, b) => b.fact.priority - a.fact.priority);
  const first = bySide(turn);
  const second = bySide(turn === "w" ? "b" : "w");
  const out: Scene[] = [...urgent.slice(0, 3)];
  const kinds = new Set(out.map((s) => s.fact.kind));
  let i = 0;
  while (out.length < max && (i < first.length || i < second.length)) {
    for (const s of [first[i], second[i]]) {
      if (!s || out.length >= max) continue;
      // Variety: at most two scenes of the same kind.
      if (kinds.has(s.fact.kind) && out.filter((o) => o.fact.kind === s.fact.kind).length >= 2) continue;
      if (out.some((o) => o.id === s.id)) continue;
      out.push(s);
      kinds.add(s.fact.kind);
    }
    i++;
  }
  return out;
}
