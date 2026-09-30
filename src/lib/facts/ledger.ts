/**
 * Silman-style ledger: for each side, what's going for it and what's going against it,
 * every entry tied to a fact (and therefore to squares on the board).
 */
import { PIECE_NAME, other, type Color } from "../chess/types";
import type { PositionFacts } from "./index";
import type { Fact, Polarity } from "./types";

type Rule = Polarity | ((f: Fact) => Polarity);

const POLARITY: Record<string, Rule> = {
  check: "weakness",
  "mate-in-one": "strength",
  checks: "neutral",
  hanging: "weakness",
  "attacked-by-cheaper": "weakness",
  "pin-absolute": "weakness",
  "pin-relative": "weakness",
  fork: "strength",
  "fork-move": (f) => (f.evidence === "engine" ? "strength" : "neutral"),
  overloaded: "weakness",
  "engine-threat": "weakness",
  "escape-squares": (f) => (f.tone === "danger" ? "weakness" : "neutral"),
  "king-zone-attackers": (f) => (f.tone === "danger" ? "weakness" : "neutral"),
  "pawn-shield": "weakness",
  "open-file-at-king": "weakness",
  "king-in-center": "weakness",
  "available-checks": (f) => (f.tone === "danger" ? "weakness" : "neutral"),
  passed: "strength",
  isolated: "weakness",
  backward: "weakness",
  vulnerable: "weakness",
  doubled: "weakness",
  undeveloped: "weakness",
  restricted: "weakness",
  "bad-bishop": "weakness",
  outpost: "strength",
  "outpost-available": "neutral",
  "open-file": (f) => (f.tone === "opportunity" ? "strength" : "neutral"),
  "half-open-file": "strength",
  "bishop-pair": "strength",
  "connected-rooks": "strength",
  center: "neutral",
  target: (f) => (f.tone === "danger" ? "weakness" : "neutral"),
  loose: "neutral",
  battery: "strength",
  balance: (f) => (f.tone === "opportunity" ? "strength" : "neutral"),
  imbalance: "neutral",
};

export function polarityOf(f: Fact): Polarity {
  if (f.polarity) return f.polarity;
  const rule = POLARITY[f.kind];
  if (!rule) return "neutral";
  return typeof rule === "function" ? rule(f) : rule;
}

const pieceAt = (f: Fact, facts: PositionFacts) => {
  const x = facts.ctx.p[f.anchor];
  return x ? PIECE_NAME[x.type] : "piece";
};

export function labelOf(f: Fact, facts: PositionFacts): string {
  if (f.label) return f.label;
  const piece = pieceAt(f, facts);
  const sq = f.anchor;
  switch (f.kind) {
    case "check":
      return "In check";
    case "mate-in-one":
      return "Mate in one";
    case "hanging":
      return `Loose ${piece} ${sq}`;
    case "attacked-by-cheaper":
      return `${piece[0].toUpperCase()}${piece.slice(1)} ${sq} under fire`;
    case "pin-absolute":
    case "pin-relative":
      return `Pinned ${piece} ${sq}`;
    case "fork":
      return `Fork from ${sq}`;
    case "fork-move":
      return `Fork idea ${sq}`;
    case "overloaded":
      return `Overloaded ${piece} ${sq}`;
    case "engine-threat":
      return "Threat against you";
    case "escape-squares":
      return "Boxed-in king";
    case "king-zone-attackers":
      return "King under pressure";
    case "pawn-shield":
      return "Thin pawn cover";
    case "open-file-at-king":
      return `Open ${sq[0]}-file at king`;
    case "king-in-center":
      return "King in the centre";
    case "available-checks":
      return "Mate threat";
    case "passed":
      return `Passed ${sq} pawn`;
    case "isolated":
      return `Isolated ${sq} pawn`;
    case "backward":
      return `Backward ${sq} pawn`;
    case "vulnerable":
      return `Weak ${sq} pawn`;
    case "doubled":
      return `Doubled ${sq[0]}-pawns`;
    case "undeveloped":
      return `Undeveloped ${piece} ${sq}`;
    case "restricted":
      return `Stuck ${piece} ${sq}`;
    case "bad-bishop":
      return `Bad bishop ${sq}`;
    case "outpost":
      return `Outpost ${piece} ${sq}`;
    case "open-file":
      return `Open ${sq[0]}-file`;
    case "half-open-file":
      return `Pressure on ${sq[0]}-file`;
    case "bishop-pair":
      return "Bishop pair";
    case "connected-rooks":
      return "Connected rooks";
    case "target":
      return `Target ${sq}`;
    case "loose":
      return "Undefended pieces";
    case "battery": {
      const [a, b] = (f.marks.links?.[0] ? [f.marks.links[0].to, f.marks.links[0].from] : [sq, sq]);
      return `Battery ${a}–${b}`;
    }
    case "balance":
      return "Material edge";
    default:
      return f.kind;
  }
}

export interface LedgerEntry {
  fact: Fact;
  label: string;
  polarity: "strength" | "weakness";
}

export interface SideLedger {
  strengths: LedgerEntry[];
  weaknesses: LedgerEntry[];
}

export type Ledger = Record<Color, SideLedger>;

/** Facts from every lens, plus extras (e.g. the engine threat), sorted into the ledger. */
export function buildLedger(facts: PositionFacts, extras: Fact[] = []): Ledger {
  const all = [...extras, ...Object.values(facts.byLens).flat()];
  const ledger: Ledger = { w: { strengths: [], weaknesses: [] }, b: { strengths: [], weaknesses: [] } };
  const seen = new Set<string>();
  for (const f of [...all].sort((a, b) => b.priority - a.priority)) {
    const pol = polarityOf(f);
    if (pol === "neutral") continue;
    // One entry per square and polarity: the most important explanation wins.
    const key = `${f.side}-${pol}-${f.anchor}`;
    if (seen.has(key) || seen.has(f.id)) continue;
    seen.add(key);
    seen.add(f.id);
    const entry: LedgerEntry = { fact: f, label: labelOf(f, facts), polarity: pol };
    (pol === "strength" ? ledger[f.side].strengths : ledger[f.side].weaknesses).push(entry);
  }
  return ledger;
}

/** A single number per side for the scoreboard: strengths minus weaknesses, weighted by importance. */
export function ledgerBalance(l: Ledger, c: Color): number {
  const w = (xs: LedgerEntry[]) => xs.reduce((s, e) => s + Math.max(1, Math.round(e.fact.priority / 25)), 0);
  return w(l[c].strengths) - w(l[c].weaknesses) - (w(l[other(c)].strengths) - w(l[other(c)].weaknesses));
}
