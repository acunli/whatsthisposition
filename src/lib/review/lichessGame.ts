/**
 * A finished Lichess game for the browser extension's review card, from Lichess's own game
 * export (`/game/export/{id}`: JSON with the PGN, headers and clocks), which the extension asks
 * for from the Lichess tab once the page shows that the game is over. The page itself is never
 * read for moves: Lichess renames its move list's tags now and then on purpose, to stop cheating
 * tools, and the export has everything.
 */
import type { Color } from "../chess/types";
import type { FinishedGame } from "./finishedGame";
import { fromLichess, type LichessGame } from "./importers";

export interface LichessFinished extends FinishedGame {
  id: string;
}

/**
 * Where a game stands: still to be played or being played, never played (aborted), over but
 * not standard chess (a variant: no review), or over.
 */
export type LichessState = "playing" | "aborted" | "variant" | "over";

export function lichessState(g: LichessGame): LichessState {
  if (!g.status || g.status === "created" || g.status === "started") return "playing";
  if (g.status === "aborted" || g.status === "noStart") return "aborted";
  if (g.variant && g.variant !== "standard" && g.variant !== "fromPosition") return "variant";
  return "over";
}

/** How the game ended, after Lichess's `status`, in the card's words. */
const HOW: Record<string, string> = {
  mate: "by checkmate",
  resign: "by resignation",
  outoftime: "on time",
  timeout: "by abandonment",
  stalemate: "by stalemate",
  insufficientMaterialClaim: "by insufficient material",
};

/** "HowellHub won by resignation", "Draw by stalemate", "Draw". */
export function lichessMessage(status: string | undefined, winner: "white" | "black" | undefined, white: string, black: string): string {
  const name = winner === "white" ? white : winner === "black" ? black : null;
  const how = HOW[status ?? ""];
  return `${name ? `${name} won` : "Draw"}${how ? ` ${how}` : ""}`;
}

/** The finished standard game for the card, or null if it isn't one (still on, aborted, a variant, no moves). */
export function gameFromLichess(g: LichessGame, bottom: Color): LichessFinished | null {
  if (lichessState(g) !== "over") return null;
  const summary = fromLichess(g);
  const plies = g.moves?.split(" ").filter(Boolean).length ?? 0;
  if (!summary || !plies) return null;
  return {
    id: g.id,
    pgn: summary.pgn,
    white: summary.white,
    black: summary.black,
    result: summary.result,
    message: lichessMessage(g.status, g.winner, summary.white, summary.black),
    bottom,
    url: summary.url,
    endedAt: g.lastMoveAt ?? null,
    plies,
  };
}
