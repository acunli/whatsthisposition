/**
 * The game on the review page (/review), kept in this tab's session storage so that reloading the
 * page, or coming back to it with the browser's Back button, shows it again. It stays in the
 * browser, is never sent anywhere, and is gone when the tab closes.
 */
import type { Color } from "../chess/types";

const KEY = "wtp-review";

export interface KeptReview {
  pgn: string;
  as?: Color;
  depth?: number;
  /** The finished review, packed (`packReview`). */
  data?: string;
}

/** Keeps the game (and, once it has one, its finished review) for this tab. */
export function keepReview(r: KeptReview): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // Storage full or blocked: a reload starts from the home page instead.
  }
}

/** Changes what's kept about the game with this PGN, if it's the one kept. */
export function updateKeptReview(pgn: string, change: Omit<Partial<KeptReview>, "pgn">): void {
  const r = keptReview();
  if (r?.pgn === pgn) keepReview({ ...r, ...change });
}

/** The game kept for this tab, or null. */
export function keptReview(): KeptReview | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (!v || typeof v !== "object") return null;
    const { pgn, as, depth, data } = v as Record<string, unknown>;
    if (typeof pgn !== "string" || !pgn) return null;
    return {
      pgn,
      ...(as === "w" || as === "b" ? { as } : {}),
      ...(typeof depth === "number" && depth > 0 ? { depth } : {}),
      ...(typeof data === "string" && data ? { data } : {}),
    };
  } catch {
    return null;
  }
}
