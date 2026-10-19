/**
 * What a shared review link shows before it's opened: the players, both accuracies, how many
 * moves of each kind each side played, and the moment worth showing (the sharer's first
 * Brilliant, else their first Great move). It is made in the browser from the finished review
 * and checked again on the server (`readSummary`), which stores it with the game (/api/share).
 * The preview card (/r/[id]/opengraph-image) and the page's title are drawn from it.
 */
import type { Color, Square } from "../chess/types";
import { CLASS_INFO, type ClassifiedMove, type MoveClass } from "./classify";
import type { ParsedGame } from "./pgn";

/** The labels a card counts, in the order it shows them. */
export const CARD_CLASSES = ["brilliant", "great", "best", "mistake", "miss", "blunder"] as const satisfies readonly MoveClass[];
export type CardClass = (typeof CARD_CLASSES)[number];

export interface ShareMoment {
  /** As the review names it: "16…Rxa3". */
  name: string;
  cls: "brilliant" | "great";
  color: Color;
  /** The position after the move, and the move's squares (highlighted on the card). */
  fen: string;
  from: Square;
  to: Square;
}

export interface ShareSummary {
  white: string;
  black: string;
  whiteElo?: string;
  blackElo?: string;
  result: string;
  opening?: string;
  /** The side the review was shared from (the board's bottom). */
  as: Color;
  accuracy: Record<Color, number | null>;
  counts: Record<Color, Partial<Record<CardClass, number>>>;
  moment?: ShareMoment;
  /** The final position, shown when there's no moment. */
  finalFen: string;
}

const moveName = (m: { moveNumber: number; color: Color; san: string }) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;

/** The summary of a finished review, shared from `as`'s side. */
export function summarize(game: ParsedGame, moves: ClassifiedMove[], accuracy: Record<Color, number | null> | null, as: Color, opening?: string): ShareSummary {
  const counts: ShareSummary["counts"] = { w: {}, b: {} };
  for (const m of moves) if ((CARD_CLASSES as readonly string[]).includes(m.cls)) counts[m.move.color][m.cls as CardClass] = (counts[m.move.color][m.cls as CardClass] ?? 0) + 1;
  const pick = (cls: "brilliant" | "great") => moves.find((m) => m.cls === cls && m.move.color === as);
  const best = pick("brilliant") ?? pick("great");
  const last = game.moves.at(-1);
  return {
    white: game.white,
    black: game.black,
    ...(game.whiteElo ? { whiteElo: game.whiteElo } : {}),
    ...(game.blackElo ? { blackElo: game.blackElo } : {}),
    result: game.result,
    ...((opening ?? game.opening) ? { opening: opening ?? game.opening } : {}),
    as,
    accuracy: { w: accuracy?.w ?? null, b: accuracy?.b ?? null },
    counts,
    ...(best ? { moment: { name: moveName(best.move), cls: best.cls as "brilliant" | "great", color: best.move.color, fen: best.move.fenAfter, from: best.move.from, to: best.move.to } } : {}),
    finalFen: last ? last.fenAfter : game.startFen,
  };
}

const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const SQUARE = /^[a-h][1-8]$/;
const PLACEMENT = /^[pnbrqkPNBRQK1-8/]{15,90}$/;
const fenOk = (v: unknown): v is string => typeof v === "string" && v.length < 100 && PLACEMENT.test(v.split(" ")[0]) && v.split(" ")[0].split("/").length === 8;
const colorOk = (v: unknown): v is Color => v === "w" || v === "b";
const accOk = (v: unknown) => (typeof v === "number" && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null);

/** A summary sent by a browser, kept only if every field is the right kind and size, or null. */
export function readSummary(raw: unknown): ShareSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const white = str(r.white, 40);
  const black = str(r.black, 40);
  const result = str(r.result, 7);
  if (!white || !black || !result || !colorOk(r.as) || !fenOk(r.finalFen)) return null;
  const acc = (r.accuracy ?? {}) as Record<string, unknown>;
  const countsIn = (r.counts ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const counts: ShareSummary["counts"] = { w: {}, b: {} };
  for (const c of ["w", "b"] as const)
    for (const cls of CARD_CLASSES) {
      const n = countsIn[c]?.[cls];
      if (typeof n === "number" && Number.isInteger(n) && n > 0 && n < 1000) counts[c][cls] = n;
    }
  const m = r.moment as Record<string, unknown> | undefined;
  const moment: ShareMoment | undefined =
    m && (m.cls === "brilliant" || m.cls === "great") && colorOk(m.color) && fenOk(m.fen) && typeof m.from === "string" && SQUARE.test(m.from) && typeof m.to === "string" && SQUARE.test(m.to) && str(m.name, 16)
      ? { name: str(m.name, 16)!, cls: m.cls, color: m.color, fen: m.fen, from: m.from as Square, to: m.to as Square }
      : undefined;
  const elo = (v: unknown) => (typeof v === "string" && /^\d{1,4}$/.test(v) ? v : undefined);
  const whiteElo = elo(r.whiteElo);
  const blackElo = elo(r.blackElo);
  const opening = str(r.opening, 80);
  return {
    white,
    black,
    ...(whiteElo ? { whiteElo } : {}),
    ...(blackElo ? { blackElo } : {}),
    result,
    ...(opening ? { opening } : {}),
    as: r.as,
    accuracy: { w: accOk(acc.w), b: accOk(acc.b) },
    counts,
    ...(moment ? { moment } : {}),
    finalFen: r.finalFen,
  };
}

/** The sharer and their opponent, as the card and the page title name them. */
export const sides = (s: ShareSummary) => {
  const name = (c: Color) => (c === "w" ? s.white : s.black);
  return { me: name(s.as), them: name(s.as === "w" ? "b" : "w") };
};

/** One line for titles and descriptions: "16…Rxa3, a Brilliant move" or the sharer's accuracy. */
export function headline(s: ShareSummary): string {
  if (s.moment) return `${s.moment.name}, ${s.moment.cls === "brilliant" ? "a Brilliant move" : "a Great move"}`;
  const acc = s.accuracy[s.as];
  return acc != null ? `${acc.toFixed(1)} accuracy` : "every move explained";
}

/** "1 Brilliant move", "2 Great moves", "3 Inaccuracies", "1 Miss", "5 Blunders". */
export function countWords(cls: MoveClass, n: number): string {
  const label = CLASS_INFO[cls].label;
  if (["brilliant", "great", "best", "excellent", "good", "book", "forced"].includes(cls)) return `${n} ${label} move${n === 1 ? "" : "s"}`;
  if (n === 1) return `1 ${label}`;
  return `${n} ${cls === "inaccuracy" ? "Inaccuracies" : cls === "miss" ? "Misses" : `${label}s`}`;
}

/** The link's description: both accuracies and the sharer's notable moves. */
export function describe(s: ShareSummary): string {
  const acc = (c: Color) => (s.accuracy[c] != null ? s.accuracy[c]!.toFixed(1) : "–");
  const mine = CARD_CLASSES.filter((c) => s.counts[s.as][c])
    .map((c) => countWords(c, s.counts[s.as][c]!))
    .join(", ");
  return `Accuracy: ${s.white} ${acc("w")}, ${s.black} ${acc("b")}${s.opening ? `, in the ${s.opening}` : ""}. ${sides(s).me}: ${mine || "no labelled moves"}. Every move labelled and explained by Stockfish 19, free.`;
}
