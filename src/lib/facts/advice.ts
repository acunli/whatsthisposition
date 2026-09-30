/**
 * "What should each side try to do?" Built from the ledger: fix your urgent problems,
 * exploit the opponent's weaknesses, make the most of your strengths. Every item points
 * at the fact it comes from, so the board can show it.
 */
import { PIECE_NAME, other, type Color } from "../chess/types";
import type { Ledger, LedgerEntry } from "./ledger";
import type { Evidence, Fact } from "./types";

export interface Advice {
  id: string;
  side: Color;
  kind: "now" | "fix" | "attack" | "use";
  text: string;
  fact?: Fact;
  evidence: Evidence;
}

const piece = (f: Fact, p: Record<string, { type: string } | undefined>) => {
  const x = p[f.anchor];
  return x ? PIECE_NAME[x.type as keyof typeof PIECE_NAME] : "piece";
};

function attackText(e: LedgerEntry, p: Record<string, { type: string } | undefined>): string | null {
  const f = e.fact;
  const sq = f.anchor;
  switch (f.kind) {
    case "hanging":
    case "attacked-by-cheaper":
      return `Win material: the ${piece(f, p)} on ${sq} is loose.`;
    case "isolated":
    case "backward":
    case "vulnerable":
      return `Pile up on the ${sq} pawn. It can't be defended by other pawns.`;
    case "hole":
      return `Plant a piece on ${sq}. No pawn can ever chase it away.`;
    case "colour-complex":
      return `Play on the ${/light/.test(f.title) ? "light" : "dark"} squares, where there's no bishop to defend.`;
    case "pawn-chain":
      return `Strike at the base of the chain on ${f.marks.icons?.[0]?.sq ?? sq} with a pawn break.`;
    case "back-rank":
      return "Look for checks on the back rank: the king has no way out.";
    case "king-danger":
    case "pawn-shield":
    case "open-file-at-king":
    case "king-zone-attackers":
    case "king-in-center":
      return "Go for the king: bring more pieces toward it and open lines.";
    case "pin-absolute":
    case "pin-relative":
      return `Pile up on the pinned ${piece(f, p)} on ${sq}. It can't run.`;
    case "overloaded":
      return `Attack what the ${piece(f, p)} on ${sq} guards. It can't cover both.`;
    case "worst-piece":
    case "restricted":
    case "bad-bishop":
    case "knight-rim":
      return `Keep the ${piece(f, p)} on ${sq} locked out of play.`;
    case "loose":
      return "Aim double attacks at the undefended pieces.";
    default:
      return null;
  }
}

function strengthText(e: LedgerEntry): string | null {
  const f = e.fact;
  const sq = f.anchor;
  switch (f.kind) {
    case "passed":
      return `Push the passed ${sq[0]}-pawn and clear its path.`;
    case "outpost":
      return `Keep the piece on ${sq}: it dominates from the outpost.`;
    case "majority":
      return `Advance the ${/queenside/.test(f.title) ? "queenside" : "kingside"} majority to make a passed pawn.`;
    case "open-file":
    case "half-open-file":
      return `Double rooks on the ${sq[0]}-file.`;
    case "space":
      return "Use the extra space: keep pieces on and avoid freeing trades.";
    case "bishop-pair":
      return "Open the position so the two bishops can breathe.";
    case "seventh-rank":
      return "Keep the rook on the 7th and add a second heavy piece.";
    case "dominant-piece":
      return `Build around the active piece on ${sq}.`;
    case "fork":
    case "skewer":
    case "discovery":
    case "mate-in-one":
      return f.title;
    default:
      return null;
  }
}

function fixText(e: LedgerEntry, p: Record<string, { type: string } | undefined>): string | null {
  const f = e.fact;
  const sq = f.anchor;
  switch (f.kind) {
    case "check":
      return "Get out of check.";
    case "engine-threat":
      return `Deal with the threat: ${f.title.replace(/\.$/, "")}.`;
    case "hanging":
    case "attacked-by-cheaper":
      return `Save the ${piece(f, p)} on ${sq}, or make a bigger threat.`;
    case "back-rank":
      return "Make luft: give the king a square off the back rank.";
    case "king-danger":
      return "Shore up the king: bring a defender or trade off an attacker.";
    case "worst-piece":
    case "restricted":
    case "bad-bishop":
    case "knight-rim":
      return `Improve your worst piece: the ${piece(f, p)} on ${sq}.`;
    case "undeveloped":
      return "Finish development and castle.";
    case "pin-absolute":
      return `Break the pin on the ${piece(f, p)} (${sq}).`;
    default:
      return null;
  }
}

const URGENT = new Set(["check", "engine-threat", "hanging", "attacked-by-cheaper", "back-rank"]);

export interface AdviceOptions {
  best?: { san: string; side: Color };
  /** First moves of the engine's candidate lines for the side to move (UCI). */
  engineFirstMoves?: string[];
}

export function buildAdvice(
  ledger: Ledger,
  placement: Record<string, { type: string } | undefined>,
  turn: Color,
  opts: AdviceOptions = {},
): Record<Color, Advice[]> {
  const { best, engineFirstMoves } = opts;
  const out: Record<Color, Advice[]> = { w: [], b: [] };
  for (const c of ["w", "b"] as Color[]) {
    const mine = ledger[c];
    const theirs = ledger[other(c)];
    const items: Advice[] = [];
    if (best && best.side === c && c === turn) {
      items.push({ id: `now-${c}`, side: c, kind: "now", text: `Right now the engine plays ${best.san}.`, evidence: "engine" });
    }
    const mate = mine.strengths.find((e) => e.fact.kind === "mate-in-one");
    if (mate && c === turn) {
      items.push({ id: `mate-${c}`, side: c, kind: "use", text: `Checkmate is on the board: ${mate.fact.title}`, fact: mate.fact, evidence: "rules" });
      out[c] = items;
      continue;
    }
    for (const e of mine.weaknesses.filter((x) => URGENT.has(x.fact.kind)).slice(0, 1)) {
      const t = fixText(e, placement);
      if (t) items.push({ id: `fix-${e.fact.id}`, side: c, kind: "fix", text: t, fact: e.fact, evidence: e.fact.evidence });
    }
    for (const e of theirs.weaknesses) {
      if (items.filter((i) => i.kind === "attack").length >= 2) break;
      let t = attackText(e, placement);
      let evidence: Evidence = e.fact.evidence === "engine" ? "engine" : "idea";
      if (t && (e.fact.kind === "hanging" || e.fact.kind === "attacked-by-cheaper")) {
        const captures = e.fact.marks.arrows.filter((a) => a.to === e.fact.anchor).map((a) => a.from + a.to);
        const name = piece(e.fact, placement);
        if (c !== turn) {
          t = `Threat for next move: winning the ${name} on ${e.fact.anchor}.`;
        } else if (engineFirstMoves?.length) {
          const agreed = captures.some((u) => engineFirstMoves.some((m) => m.startsWith(u)));
          t = agreed
            ? `Win material: take the ${name} on ${e.fact.anchor}.`
            : `The ${name} on ${e.fact.anchor} looks free, but the engine won't take it. Work out why before you grab it.`;
          evidence = "engine";
        }
      }
      if (t && !items.some((i) => i.text === t)) items.push({ id: `atk-${e.fact.id}`, side: c, kind: "attack", text: t, fact: e.fact, evidence });
    }
    for (const e of mine.strengths) {
      if (items.filter((i) => i.kind === "use").length >= 2) break;
      const t = strengthText(e);
      if (t && !items.some((i) => i.text === t)) items.push({ id: `use-${e.fact.id}`, side: c, kind: "use", text: t, fact: e.fact, evidence: e.fact.evidence === "engine" ? "engine" : "idea" });
    }
    for (const e of mine.weaknesses.filter((x) => !URGENT.has(x.fact.kind))) {
      if (items.filter((i) => i.kind === "fix").length >= 2) break;
      const t = fixText(e, placement);
      if (t && !items.some((i) => i.text === t)) items.push({ id: `fix-${e.fact.id}`, side: c, kind: "fix", text: t, fact: e.fact, evidence: "idea" });
    }
    out[c] = items.slice(0, 5);
  }
  return out;
}
