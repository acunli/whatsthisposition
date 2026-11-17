/**
 * Runs on Lichess once its user turns Lichess on in the toolbar popup (lichessAccess.ts), or in
 * the one tab where the toolbar button is clicked. When a game ends in front of you (one you
 * play, or watch on its own page), the review card pops up in the bottom-right corner, as on
 * Chess.com (content.ts; the card itself is card.ts). The toolbar button opens the same card for
 * a finished game on request.
 *
 * How it sees a game end, reading as little of the page as it can. It never reads the moves on
 * the page: Lichess renames its move list's tags now and then, on purpose, to stop cheating
 * tools. It looks only at whether the game is over:
 * - A game's page (`lichess.org/{id}`, `/{id}{you}` while you play, `/{id}/black`) draws the
 *   board, players and clocks in `.round__app` (with `.round__app__table` once Lichess's script
 *   has drawn it). When the game is over, the result appears under the moves (`.result-wrap`:
 *   "1-0", or nothing for an aborted game) and the buttons for after a game (`.follow-up`). A game
 *   first seen without them is being played here; one showing them from the start was opened
 *   finished, and gets the card by itself only if it ended in the last 10 minutes.
 * - Once the page shows the end, the game comes from Lichess's own export
 *   (`/game/export/{id}`: JSON with the PGN), the same the website asks for.
 *
 * Never during a game: nothing is asked of Lichess about a game until its page shows that it is
 * over, the export is used only once it says the game is finished, and nothing is analysed until
 * you press Analyze.
 */
import type { Color } from "@/lib/chess/types";
import { readResult } from "@/lib/review/chesscomPage";
import { lichessExportUrl, lichessGameId, validUsername, type LichessGame } from "@/lib/review/importers";
import { gameFromLichess, lichessState, type LichessFinished } from "@/lib/review/lichessGame";
import { autoOpen, log, openCard, remember, shownBefore, sleep, startWatching, type FindReply } from "./card";

/** After the page shows the end, until Lichess's export says the game is over (it's usually at once). */
const ENDED_RETRY_MS = [500, 1000, 1500, 2000, 3000, 5000, 8000, 10_000];
const MAX_RETRIES = 20;
const RATE_LIMITED_MS = 60_000;
/** A game opened within this long of its end (a reload after the end, say) counts as just finished. */
const FRESH_MS = 10 * 60_000;
/** How long an open card waits for the game before saying it couldn't be read. */
const GAME_WAIT_MS = 45_000;
/** A variant on the board (`.round__app.variant-crazyhouse`): only standard chess, or from a set position, is reviewed. */
const VARIANT = /\bvariant-(?!standard\b|fromPosition\b)[A-Za-z0-9]+/;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

// ---- The page ---------------------------------------------------------------------------

/** The board of a game being played or just finished, once Lichess's script has drawn it. */
function roundApp(): Element | null {
  const app = document.querySelector(".round__app");
  return app?.querySelector(".round__app__table") ? app : null;
}

/** What the page says about the end: a result, an aborted game, over (buttons only), or nothing yet. */
type End = "result" | "aborted" | "over" | null;

function endOnPage(app: Element): End {
  const wrap = app.querySelector(".result-wrap");
  if (wrap) {
    const result = wrap.querySelector(".result");
    if (result && !result.textContent?.trim()) return "aborted";
    return readResult(result?.textContent) ? "result" : "over";
  }
  return app.querySelector(".follow-up") ? "over" : null;
}

/** The colour at the bottom of the board (on your own game: yours). */
function bottomColour(): Color {
  const board = document.querySelector(".main-board .cg-wrap") ?? document.querySelector(".cg-wrap");
  if (board?.classList.contains("orientation-black")) return "b";
  if (board?.classList.contains("orientation-white")) return "w";
  return /^\/[A-Za-z0-9]{8,12}\/black(?:\/|$)/.test(location.pathname) ? "b" : "w";
}

/** The game named by the analysis button a finished game shows (on pages whose address names none). */
function analysisLinkId(): string | null {
  const a = document.querySelector<HTMLAnchorElement>(".round__app a.fbt.analysis[href]");
  return a ? lichessGameId(a.href) : null;
}

/** Who is signed in (Lichess puts it on the page's body). */
function signedInUser(): string | null {
  const name = document.body?.dataset.username ?? document.body?.dataset.user;
  return name && validUsername(name) ? name : null;
}

// ---- Lichess's game data ---------------------------------------------------------------------

async function readGame(id: string): Promise<LichessGame> {
  const res = await fetch(lichessExportUrl(id), { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as LichessGame;
}

/** Your newest finished game, from your public game list (only finished games are listed). */
async function newestOwnGame(user: string): Promise<string | null> {
  const res = await fetch(`/api/games/user/${encodeURIComponent(user)}?max=1&moves=false`, { headers: { Accept: "application/x-ndjson" }, cache: "no-store" });
  if (!res.ok) return null;
  const line = (await res.text()).split("\n").find((l) => l.trim());
  return line ? ((JSON.parse(line) as { id?: string }).id ?? null) : null;
}

const NO_REVIEW: Record<"playing" | "aborted" | "variant", string> = {
  playing: "This game isn't over yet. Finish it, then click again.",
  aborted: "This game was aborted: there's nothing to review.",
  variant: "Only standard chess games can be reviewed.",
};

// ---- Watching for the end of a game -------------------------------------------------------

interface Session {
  /** The game's id, from the address. */
  id: string | null;
  /** The board has been seen (once Lichess's script drew it). */
  seen: boolean;
  /** It was first seen without its end: it is being played (or watched) here. */
  live: boolean;
  /** The page shows the game is over. */
  endShown: boolean;
  /** Lichess has said how the game ended: `game` to review, or `reason` there's none. */
  settled: boolean;
  game: LichessFinished | null;
  reason: string | null;
  nextCheck: number;
  retries: number;
  /** The card has opened (or was skipped) for this game. */
  popped: boolean;
}

const newSession = (id: string | null): Session => ({ id, seen: false, live: false, endShown: false, settled: false, game: null, reason: null, nextCheck: 0, retries: 0, popped: false });

let session = newSession(null);
let checking = false;

const fresh = (endedAt: number | null) => endedAt !== null && Date.now() - endedAt < FRESH_MS;

/** Asks Lichess for the game once its page shows the end. */
async function check() {
  const s = session;
  const id = s.id;
  if (!id || checking || s.settled) return;
  checking = true;
  let wait = 0;
  try {
    const g = await readGame(id);
    if (s !== session) return;
    const state = lichessState(g);
    if (state === "playing") return log(`Lichess: game ${id} isn't over yet`);
    s.settled = true;
    s.game = state === "over" ? gameFromLichess(g, bottomColour()) : null;
    s.reason = state === "over" ? (s.game ? null : "This game has no moves to review.") : NO_REVIEW[state];
    const ago = Math.round((Date.now() - (g.lastMoveAt ?? Date.now())) / 1000);
    log(`Lichess: game ${id} is over (${g.status}, ended ${ago} s ago)`, s.game ? `${s.game.plies} plies` : `no review: ${s.reason}`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    if (s !== session) return;
    if (status === 404) {
      s.settled = true;
      s.reason = "Lichess has no game at this address.";
    }
    if (status === 429) wait = RATE_LIMITED_MS;
    log(`Lichess: game ${id} answered ${status || "with an error"}`);
  } finally {
    checking = false;
    if (s === session && !s.settled) {
      if (s.retries >= MAX_RETRIES) {
        s.settled = true;
        s.reason = "Couldn't read this game from Lichess. Open it again, or use the toolbar button.";
      } else s.nextCheck = Date.now() + (wait || ENDED_RETRY_MS[Math.min(s.retries++, ENDED_RETRY_MS.length - 1)]);
    }
  }
}

function tick() {
  const id = lichessGameId(location.href);
  if (id !== session.id) {
    if (id) log(`game ${id} (from the address)`);
    session = newSession(id);
  }
  const s = session;
  const app = id ? roundApp() : null;
  if (!app) return; // not a game's page (or not drawn yet); an analysis page has no automatic card

  const end = endOnPage(app);
  if (!s.seen) {
    s.seen = true;
    s.live = !end;
    log(s.live ? "the game is being played: the card opens when it ends" : "the game was opened finished");
  }
  // No review, so nothing to ask Lichess: a variant, or an aborted game.
  const none = VARIANT.test(app.className) ? "variant" : end === "aborted" ? "aborted" : null;
  if (none) {
    if (!s.settled) log(none === "variant" ? "not standard chess: no review" : "the game was aborted: no review");
    s.popped = s.settled = true;
    s.reason = NO_REVIEW[none];
    return;
  }
  if (end && !s.endShown) {
    s.endShown = true;
    s.nextCheck = 0; // ask Lichess now
    s.retries = 0;
    log(`the game ended on the page (${end})`);
  }
  if (s.endShown && !s.settled && !checking && Date.now() >= s.nextCheck) void check();

  if (s.popped || !autoOpen() || !s.endShown) return;
  if (s.settled && !s.game) {
    s.popped = true;
    return;
  }
  // Played here: open at once when the page shows the result, while the game is fetched.
  // Opened finished: only if Lichess says it ended moments ago.
  if (s.live ? end === "result" || !!s.game : !!s.game && fresh(s.game.endedAt)) pop();
  else if (!s.live && s.game) s.popped = true;
}

/** Opens the card for the game that just ended, once per game. */
function pop() {
  const s = session;
  s.popped = true;
  const keys = [`lichess:${s.id}`];
  if (shownBefore(keys)) return log("the game ended; its card has opened before");
  remember(keys);
  log("the game ended: opening the card");
  openCard(waitForGame(s));
}

/** The game for the card, once Lichess has it (or why there's none). */
async function waitForGame(s: Session): Promise<LichessFinished | string | null> {
  const start = Date.now();
  while (s === session && Date.now() - start < GAME_WAIT_MS) {
    if (s.game) return s.game;
    if (s.settled) return s.reason ?? "This game can't be reviewed.";
    await sleep(250);
  }
  return s === session ? "Couldn't read this game from Lichess. Open it again, or use the toolbar button." : null;
}

function watching(): string {
  const s = session;
  if (!s.id || !s.seen) return "";
  if (s.endShown) return "This game is over.";
  return "Watching this game: the card opens when it ends.";
}

// ---- The toolbar button ---------------------------------------------------------------------

/** The finished game to review, or why there isn't one. */
async function find(): Promise<FindReply> {
  const s = session;
  if (s.game && s.id === lichessGameId(location.href)) return { ok: true, game: s.game };
  // A game being played: nothing is asked of Lichess until it's over.
  const app = roundApp();
  if (app && !endOnPage(app)) return { ok: false, message: NO_REVIEW.playing };
  let id = lichessGameId(location.href) ?? analysisLinkId();
  if (!id) {
    const user = signedInUser();
    id = user ? await newestOwnGame(user).catch(() => null) : null;
  }
  if (!id) return { ok: false, message: "No game found here. Open one of your games on Lichess (or finish one), then click again." };
  try {
    const g = await readGame(id);
    const state = lichessState(g);
    if (state !== "over") return { ok: false, message: NO_REVIEW[state] };
    const game = gameFromLichess(g, bottomColour());
    return game ? { ok: true, game } : { ok: false, message: "This game has no moves to review." };
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    if (status === 404) return { ok: false, message: "Lichess has no game at this address. Open one of your games, then click again." };
    if (status === 429) return { ok: false, message: "Lichess is busy for a moment. Click again in a few seconds." };
    return { ok: false, message: "Couldn't read this game from Lichess. Check your connection and try again." };
  }
}

startWatching({
  tick,
  find,
  watching,
  opened: () => {
    session.popped = true;
  },
});
