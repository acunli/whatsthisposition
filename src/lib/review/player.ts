/**
 * The player whose games this browser last looked up, so that coming back to the site shows their
 * latest games straight away, with the ones played since the last visit marked new and the ones
 * already reviewed here marked as such. Kept in this browser's local storage only: never sent
 * anywhere except to fetch that player's public games, and gone with "Not you?".
 */
import type { Site } from "./importers";

const PLAYER_KEY = "wtp-player";
const REVIEWED_KEY = "wtp-reviewed";
/** How many reviewed games are remembered (the oldest are dropped first). */
const MAX_REVIEWED = 300;

export interface Player {
  site: Site;
  user: string;
  /** When their game list was last shown (epoch ms): games played after it are new. */
  seenAt: number;
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the site just doesn't remember.
  }
}

/** The remembered player, or null. */
export function rememberedPlayer(): Player | null {
  const v = read(PLAYER_KEY);
  if (!v || typeof v !== "object") return null;
  const { site, user, seenAt } = v as Record<string, unknown>;
  if ((site !== "chesscom" && site !== "lichess") || typeof user !== "string" || !/^[A-Za-z0-9_-]{2,30}$/.test(user)) return null;
  return { site, user, seenAt: typeof seenAt === "number" ? seenAt : 0 };
}

/** Remembers the player whose games were just listed, and that the list was seen now. */
export function rememberPlayer(site: Site, user: string, now = Date.now()): void {
  write(PLAYER_KEY, { site, user, seenAt: now });
}

/** "Not you?": forgets the player and the games reviewed. */
export function forgetPlayer(): void {
  try {
    localStorage.removeItem(PLAYER_KEY);
    localStorage.removeItem(REVIEWED_KEY);
  } catch {
    // Nothing to forget.
  }
}

/** The ids of the games reviewed in this browser (from a player's list). */
export function reviewedGames(): Set<string> {
  const v = read(REVIEWED_KEY);
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
}

/** Marks a game from a player's list as reviewed here. */
export function markReviewed(id: string): void {
  const ids = [...reviewedGames()].filter((x) => x !== id);
  ids.push(id);
  write(REVIEWED_KEY, ids.slice(-MAX_REVIEWED));
}

/** A game is new when it was played after the list was last seen, and isn't reviewed yet. */
export function isNewGame(playedAt: number | undefined, seenAt: number, reviewed: boolean): boolean {
  return !reviewed && seenAt > 0 && !!playedAt && playedAt > seenAt;
}
