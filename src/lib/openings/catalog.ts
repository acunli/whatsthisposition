/**
 * The opening pages (/openings): one per named opening of the Lichess chess-openings dataset
 * (src/data/opening-lines.json) that strong players reach often enough to say something about,
 * from the master book (src/lib/review/masters.ts): how the opening scores, what is played next
 * and where that leads, the opening it branches from and the ones that branch from it. Nothing
 * is written per opening: every page says the same things, from the data.
 */
import { Chess } from "chess.js";
import type { MastersBook } from "../review/masters";
import { bookKey } from "../review/positionKey";

/** A catalogued line: ECO code, name, moves in SAN separated by spaces. */
export type OpeningLine = [eco: string, name: string, moves: string];

/** Results in percent, from White's side. */
export interface Score {
  white: number;
  draw: number;
  black: number;
}

export interface NextMove extends Score {
  san: string;
  /** Share of the games that reached the position, in percent. */
  share: number;
  games: number;
  /** The opening page this move leads to, if it reaches one. */
  to?: string;
}

export interface Opening {
  slug: string;
  name: string;
  /** The name before its colon ("Sicilian Defense"), which the openings are grouped by. */
  family: string;
  eco: string;
  sans: string[];
  /** The position after the line. */
  fen: string;
  /** Games between strong players that reached the position. */
  games: number;
  score: Score;
  next: NextMove[];
  /** The named opening this one branches from, if it has a page. */
  parent?: string;
  /** The openings that branch from this one, most played first. */
  children: string[];
}

export interface Catalog {
  all: Opening[];
  bySlug: Map<string, Opening>;
  /** Families, most played first, each with its openings (most played first). */
  families: { name: string; games: number; openings: Opening[] }[];
}

/** An opening gets a page when at least this many strong players' games reached it. */
export const MIN_GAMES = 50;
/** How many of the moves played next a page lists. */
const NEXT_MOVES = 6;

/** "Sicilian Defense: Najdorf Variation, English Attack" → "sicilian-defense-najdorf-variation-english-attack". */
export function openingSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const familyOf = (name: string) => name.split(":")[0].trim();

/** Plays a line, giving the position after each move (index 0: the start). */
function positions(sans: string[]): string[] | null {
  const c = new Chess();
  const out = [c.fen()];
  try {
    for (const s of sans) {
      c.move(s);
      out.push(c.fen());
    }
  } catch {
    return null;
  }
  return out;
}

const round = (x: number) => Math.round(x * 10) / 10;

export function buildCatalog(lines: OpeningLine[], book: MastersBook, minGames = MIN_GAMES): Catalog {
  // Each name's line: the one whose position strong players reached most (a name can have several move orders).
  const chosen = new Map<string, { eco: string; sans: string[]; fens: string[]; games: number }>();
  for (const [eco, name, moves] of lines) {
    const sans = moves.split(" ");
    const fens = positions(sans);
    if (!fens) continue;
    const games = book.get(fens.at(-1)!)?.total ?? 0;
    const had = chosen.get(name);
    if (!had || games > had.games || (games === had.games && sans.length < had.sans.length)) chosen.set(name, { eco, sans, fens, games });
  }

  const slugs = new Map<string, string>(); // name → slug, for the names with a page
  for (const [name, c] of chosen) if (c.games >= minGames) slugs.set(name, openingSlug(name));
  // A position → the page of the opening it is (a position named twice keeps its most played name).
  const pageAt = new Map<string, string>();
  for (const [name, c] of [...chosen].sort((a, b) => a[1].games - b[1].games)) {
    const slug = slugs.get(name);
    if (slug) pageAt.set(bookKey(c.fens.at(-1)!), slug);
  }

  const all: Opening[] = [];
  for (const [name, c] of chosen) {
    const slug = slugs.get(name);
    if (!slug) continue;
    const fen = c.fens.at(-1)!;
    const entry = book.get(fen)!;
    const counted = entry.moves.reduce((s, m) => s + m.count, 0) || 1;
    const score: Score = {
      white: round(entry.moves.reduce((s, m) => s + m.white * m.count, 0) / counted),
      draw: round(entry.moves.reduce((s, m) => s + m.draw * m.count, 0) / counted),
      black: round(entry.moves.reduce((s, m) => s + m.black * m.count, 0) / counted),
    };
    const next: NextMove[] = [];
    for (const m of entry.moves.slice(0, NEXT_MOVES)) {
      const board = new Chess(fen);
      try {
        const mv = board.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
        const to = pageAt.get(bookKey(board.fen()));
        next.push({ san: mv.san, share: round((m.count / entry.total) * 100), games: m.count, white: m.white, draw: m.draw, black: m.black, ...(to && to !== slug ? { to } : {}) });
      } catch {
        // a move the book has that doesn't fit the position (a hash collision): left out
      }
    }
    let parent: string | undefined;
    for (let k = c.fens.length - 2; k >= 1 && !parent; k--) {
      const p = pageAt.get(bookKey(c.fens[k]));
      if (p && p !== slug) parent = p;
    }
    all.push({ slug, name, family: familyOf(name), eco: c.eco, sans: c.sans, fen, games: entry.total, score, next, ...(parent ? { parent } : {}), children: [] });
  }
  all.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const bySlug = new Map(all.map((o) => [o.slug, o]));
  for (const o of all) if (o.parent) bySlug.get(o.parent)!.children.push(o.slug);

  const groups = new Map<string, Opening[]>();
  for (const o of all) groups.set(o.family, [...(groups.get(o.family) ?? []), o]);
  const families = [...groups].map(([name, openings]) => ({ name, games: Math.max(...openings.map((o) => o.games)), openings })).sort((a, b) => b.games - a.games);
  return { all, bySlug, families };
}

/** "1.e4 c5 2.Nf3 d6": a line's moves with their numbers, from the start position. */
export function numbered(sans: string[]): string {
  return sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(" ");
}

/** "47%" */
export const pct = (x: number) => `${Math.round(x)}%`;

/** One sentence on how an opening scores and what strong players play next, for its page and description. */
export function openingSummary(o: Opening): string {
  const top = o.next[0];
  const plyNext = o.sans.length;
  const moveNo = `${Math.floor(plyNext / 2) + 1}${plyNext % 2 === 0 ? "." : "…"}`;
  const games = o.games.toLocaleString("en-US");
  const scores = `White wins ${pct(o.score.white)}, ${pct(o.score.draw)} are drawn and Black wins ${pct(o.score.black)}`;
  return `${o.name} (${o.eco}) starts ${numbered(o.sans)}. In ${games} games between strong players, ${scores}${top ? `; the most played move is ${moveNo}${top.san} (${pct(top.share)})` : ""}.`;
}
