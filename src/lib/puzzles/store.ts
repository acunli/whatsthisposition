/**
 * The last puzzle set and how far the player got with it, kept in this browser's local
 * storage so coming back picks up where they stopped. Nothing is sent anywhere. Every
 * function fails safe: a browser that blocks storage simply starts fresh each time.
 */
import type { Outcome, PuzzleSet } from "./types";

const KEY = "wtp-puzzles";

export interface KeptPuzzles {
  set: PuzzleSet;
  /** How each puzzle went, by id. */
  done: Record<string, Outcome>;
  /** The puzzle the player was on. */
  at: number;
}

const isSet = (x: unknown): x is PuzzleSet => {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return s.v === 1 && Array.isArray(s.puzzles) && Array.isArray(s.weaknesses) && Array.isArray(s.slips) && typeof s.made === "number";
};

export function keptPuzzles(storage: Pick<Storage, "getItem"> | null = safeStorage()): KeptPuzzles | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const x = JSON.parse(raw) as Partial<KeptPuzzles>;
    if (!isSet(x.set)) return null;
    const done = x.done && typeof x.done === "object" ? x.done : {};
    const at = typeof x.at === "number" && x.at >= 0 && x.at < Math.max(1, x.set.puzzles.length) ? x.at : 0;
    return { set: x.set, done, at };
  } catch {
    return null;
  }
}

export function keepPuzzles(kept: KeptPuzzles, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(kept));
  } catch {
    // Full or blocked: the set stays on the page for this visit.
  }
}

export function forgetPuzzles(storage: Pick<Storage, "removeItem"> | null = safeStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing to forget, then.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
