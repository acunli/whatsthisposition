/**
 * Reviewed games published as pages (/games/[slug]): strong players' recent games, reviewed
 * by the same engine, rules and explanations as anyone's game on the site, then written to
 * content/games/<slug>.json by the daily job (src/lib/content/publish.test.ts,
 * .github/workflows/content.yml). Nothing here is written by hand about a game: which games
 * are picked follows general rules (src/lib/content/sources.ts) and every sentence comes from
 * the review's explanations.
 */
import type { Color } from "../chess/types";
import type { ClassifiedMove, MoveClass } from "../review/classify";
import type { ShareSummary } from "../review/shareCard";

export interface GameMoment {
  ply: number;
  /** "23.Rxf7" */
  name: string;
  cls: MoveClass;
  color: Color;
  /** The review card's headline and points, then the reasoning engine's (src/lib/reason). */
  headline: string;
  points: string[];
  /** For a sacrifice: what happens if it's taken, and why not play safe (src/lib/reason/sacrifice.ts). */
  why?: { title: string; text: string }[];
  /** The engine's better move and why, for a mistake. */
  better?: string;
}

export interface GameSource {
  kind: "broadcast" | "chesscom";
  /** Where the moves come from: the broadcast's game page or the Chess.com game. */
  url: string;
  /** "41st European Chess Club Cup 2026 | Open", "Chess.com blitz" */
  event: string;
  round?: string;
  /** "classical", "rapid", "blitz" */
  speed?: string;
}

export interface GameRecord {
  v: 1;
  slug: string;
  source: GameSource;
  /** When the page was made, and when the game was played (YYYY-MM-DD). */
  published: string;
  played?: string;
  pgn: string;
  /** The side the page's card is drawn for. */
  as: Color;
  depth: number;
  /** The finished review, packed (src/lib/review/share.ts). */
  data: string;
  summary: ShareSummary;
  white: string;
  black: string;
  /** The label of every move, in order. */
  labels: MoveClass[];
  moments: GameMoment[];
  opening?: { name: string | null; eco: string | null; points: string[] };
}

/** "Giri, Anish" (how broadcasts write names) reads "Anish Giri"; usernames stay as they are. */
export function displayName(name: string): string {
  const parts = name.split(",").map((p) => p.trim());
  return parts.length === 2 && parts[0] && parts[1] ? `${parts[1]} ${parts[0]}` : name.trim();
}

/** Lower-case ASCII words joined by "-", at most 90 characters. */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90)
    .replace(/-+$/, "");
}

/** The page's address: the players and the date ("anish-giri-vs-sergei-movsesian-2026-10-19"), then the event if that's taken, then a number. */
export function gameSlug(white: string, black: string, event: string, played: string | undefined, taken: Set<string>): string {
  const players = slugify(`${white} vs ${black}`).slice(0, 60).replace(/-+$/, "");
  const base = [players, played].filter(Boolean).join("-");
  if (!taken.has(base)) return base;
  const withEvent = [players, slugify(event).slice(0, 40).replace(/-+$/, ""), played].filter(Boolean).join("-");
  let slug = withEvent;
  for (let n = 2; taken.has(slug); n++) slug = `${withEvent}-${n}`;
  return slug;
}

/** The labels a page tells as key moments, most telling first. */
const MOMENT_ORDER: MoveClass[] = ["brilliant", "great", "blunder", "miss", "mistake"];

/** The moves worth a section of their own: every Brilliant and Great move, then the costliest errors, at most `max`, in game order. */
export function pickMoments(moves: ClassifiedMove[], max = 8): ClassifiedMove[] {
  const ranked = moves
    .filter((m) => MOMENT_ORDER.includes(m.cls))
    .sort((a, b) => MOMENT_ORDER.indexOf(a.cls) - MOMENT_ORDER.indexOf(b.cls) || b.loss - a.loss);
  return ranked.slice(0, max).sort((a, b) => a.move.ply - b.move.ply);
}

/** The side a page is drawn for: whoever played a Brilliant (else a Great) move first, else the winner, else White. */
export function pageSide(moves: ClassifiedMove[], result: string): Color {
  for (const cls of ["brilliant", "great"] as const) {
    const m = moves.find((x) => x.cls === cls);
    if (m) return m.move.color;
  }
  return result === "0-1" ? "b" : "w";
}

/** "19 October 2026" from "2026-10-19". */
export function longDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The result in words: "White won", "Black won", "Drawn". */
export function resultWords(result: string, white: string, black: string): string {
  if (result === "1-0") return `${white} won`;
  if (result === "0-1") return `${black} won`;
  if (result === "1/2-1/2") return "Drawn";
  return "Unfinished";
}
