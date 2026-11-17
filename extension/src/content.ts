/**
 * Runs on Chess.com. When a game ends in front of you (one you play or watch), the review
 * card pops up in the bottom-right corner: an extension page in an iframe (panel.html), with
 * Stockfish in the extension's hidden engine page, on your computer. The toolbar button
 * (popup.ts) opens the same card on request ("wtp:find", "wtp:open"), and can turn the
 * automatic card off.
 *
 * How it sees a game end, without touching Chess.com's own scripts (a script in the page
 * reading the board is what cheating tools do, and Chess.com watches for that):
 * 1. The move list on the page: moves are added one by one while a game is played, and the
 *    result ("1-0") appears when it's over (`MoveListWatch`). Instant, and needs no game id.
 * 2. Chess.com's game data, `/callback/live/game/{id}` (the id from the address or the Game
 *    Review link): 404 while a live game is played, `isFinished` once it's over. Asked when
 *    the game is found, the moment the page shows the end, and otherwise rarely, as a backstop
 *    in case Chess.com changes its page.
 *
 * Never during a game: the card opens only once the page shows the result or Chess.com says
 * the game is finished, and the moves are read only then.
 *
 * After the extension is installed, updated or reloaded, the service worker adds this script
 * to Chess.com tabs that are already open; a copy left from before stops itself.
 */
import { chessComGameRef, gameFromCallback, type ChessComCallback, type ChessComGame } from "@/lib/review/chesscomGame";
import { cleanSan, figurineLetter, gameFromPage, MoveListWatch, readResult, type GameResult, type MoveListSighting, type PagePlayer } from "@/lib/review/chesscomPage";
import { autoOpen, log, openCard, remember, shownBefore, sleep, startWatching, type FindReply } from "./card";

type Ref = { id: number; kind: "live" | "daily" };

/** Pages where games are played or watched; the card never opens by itself elsewhere. */
const GAME_PAGES = /^\/(game|play|live)(\/|$)/;
/** Backstop checks of a game Chess.com says is being played: rarer while its move list can be watched. */
const POLL_MS = { watched: 60_000, blind: 30_000 };
/** After the page shows the end, until Chess.com serves the game (it can take a few seconds). */
const ENDED_RETRY_MS = [800, 1200, 1500, 2000, 3000, 4000, 5000, 5000, 8000, 10_000];
const RATE_LIMITED_MS = 60_000;
/** A game opened within this long of its end (from a link, say) counts as just finished. */
const FRESH_MS = 10 * 60_000;
/** How long the card waits for Chess.com's copy of the game (full headers) before using the page's moves. */
const SERVER_WAIT_MS = 4000;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const refKey = (r: Ref) => `${r.kind}/${r.id}`;

// ---- The page ---------------------------------------------------------------------------

/** Chess.com's move list on screen (the visible one with the most moves) and what it shows. */
function readMoveList(): { el: Element; sighting: MoveListSighting } | null {
  let best: { el: Element; plies: number } | null = null;
  for (const el of document.querySelectorAll("wc-simple-move-list, .move-list, [class*='move-list-component']")) {
    if (!el.getClientRects().length) continue;
    const plies = plyNodes(el).length;
    if (!best || plies > best.plies) best = { el, plies };
  }
  if (!best) return null;
  const result = readResult(best.el.querySelector(".game-result")?.textContent);
  return { el: best.el, sighting: { plies: best.plies, result } };
}

function plyNodes(list: Element): Element[] {
  const main = list.querySelectorAll(".node.main-line-ply");
  return [...(main.length ? main : list.querySelectorAll(".node"))];
}

/** A move as the list shows it, with figurine icons turned back into letters. */
function sanOf(node: Element): string {
  const box = node.querySelector(".node-highlight-content") ?? node;
  let raw = "";
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) raw += n.textContent ?? "";
    else if (n instanceof Element) {
      const fig = figurineLetter(n.getAttribute("data-figurine"), typeof n.className === "string" ? n.className : "");
      if (fig) raw += fig;
      else n.childNodes.forEach(walk);
    }
  };
  box.childNodes.forEach(walk);
  return cleanSan(raw);
}

function readPlayer(where: "top" | "bottom"): PagePlayer {
  const box = document.querySelector(`#board-layout-player-${where}`) ?? document.querySelector(`.player-component.player-${where}`);
  const name = box?.querySelector('[data-test-element="user-tagline-username"], [class*="user-username"]')?.textContent?.trim() || null;
  // After the game the box shows the new rating and the change; the game was played at the old one.
  const now = Number(box?.querySelector(".rating-score-rating")?.textContent?.replace(/[^\d]/g, ""));
  const change = Number(box?.querySelector(".rating-score-change")?.textContent?.replace(/[^\d+-]/g, "") || 0);
  const during = Number(/\d{3,4}/.exec(box?.querySelector('[class*="user-rating"]')?.textContent ?? "")?.[0]);
  const rating = now > 0 ? now - (Number.isFinite(change) ? change : 0) : during > 0 ? during : null;
  return { name, rating };
}

function bottomColour(): "w" | "b" {
  if (document.querySelector(".clock-bottom.clock-black")) return "b";
  if (document.querySelector(".clock-bottom.clock-white")) return "w";
  return document.querySelector("wc-chess-board.flipped, chess-board.flipped") ? "b" : "w";
}

/** The finished game from the page's own move list, or null if it doesn't make a legal game. */
function pageGame(list: Element, result: GameResult, ref: Ref | null): ChessComGame | null {
  const bottom = bottomColour();
  const [top, below] = [readPlayer("top"), readPlayer("bottom")];
  return gameFromPage({
    sans: plyNodes(list).map(sanOf),
    result,
    white: bottom === "w" ? below : top,
    black: bottom === "w" ? top : below,
    bottom,
    how: document.querySelector('[class*="game-over-modal-subtitle"]')?.textContent,
    ref,
    url: location.href,
  });
}

/** Chess.com's result box (it opens over the board when a game ends). */
const resultBoxOnPage = () => !!document.querySelector('[class*="game-over-modal"], [class*="game-over-header"]');

/** The game named by Chess.com's Game Review button (in the result box and the side panel). */
function reviewButtonRef(): Ref | null {
  const a = document.querySelector<HTMLAnchorElement>('a[class*="game-over-primary-cta"][href], a[href*="/analysis/game/"][href*="review"]');
  return a ? chessComGameRef(a.href) : null;
}

/**
 * The game on screen, for the toolbar button, from the first of these that names one: the
 * address (`/game/live/123`, `/game/123`); Chess.com's Game Review button; the newest game
 * linked elsewhere on the page.
 */
function gameOnPage(): Ref | null {
  const fromUrl = chessComGameRef(location.href);
  if (fromUrl) return fromUrl;
  const fromButton = reviewButtonRef();
  if (fromButton) return fromButton;
  let newest: Ref | null = null;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('a[href*="/game/live/"], a[href*="/game/daily/"], a[href*="/analysis/game/"]')) {
    const r = chessComGameRef(a.href);
    if (r && (!newest || r.id > newest.id)) newest = r;
  }
  return newest;
}

/** Who is signed in: from Chess.com's page context, or the sidebar's link to your profile. */
function signedInUser(): string | null {
  for (const s of document.querySelectorAll("script:not([src])")) {
    const t = s.textContent ?? "";
    const at = t.indexOf('"user":{');
    if (at < 0) continue;
    const m = /"username"\s*:\s*"([A-Za-z0-9_-]{3,25})"/.exec(t.slice(at, at + 4000));
    if (m) return m[1];
  }
  const link = document.querySelector<HTMLAnchorElement>('nav a[href*="/member/"], [class*="sidebar"] a[href*="/member/"], [class*="nav"] a[href*="/member/"]');
  return (link && /\/member\/([A-Za-z0-9_-]{3,25})/.exec(link.href)?.[1]) ?? null;
}

// ---- Chess.com's game data ----------------------------------------------------------------

/** Your newest finished game, from Chess.com's public game list (it appears there about a minute after the end). */
async function newestOwnGame(user: string): Promise<Ref | null> {
  const d = new Date();
  const month = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const res = await fetch(`https://api.chess.com/pub/player/${user.toLowerCase()}/games/${month}`, { cache: "no-store" });
  if (!res.ok) return null;
  const { games = [] } = (await res.json()) as { games?: { url: string; end_time: number }[] };
  const last = games.reduce<{ url: string; end_time: number } | null>((a, g) => (!a || g.end_time > a.end_time ? g : a), null);
  return last ? chessComGameRef(last.url) : null;
}

async function readGame(ref: Ref): Promise<{ finished: boolean; game: ChessComGame | null }> {
  const res = await fetch(`/callback/${ref.kind}/game/${ref.id}`, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) throw new HttpError(res.status);
  const cb = (await res.json()) as ChessComCallback;
  return { finished: !!cb.game?.isFinished, game: gameFromCallback(cb, ref.kind) };
}

// ---- Watching for the end of a game -------------------------------------------------------

interface Session {
  watch: MoveListWatch;
  /** The game's id, once the page names it. */
  ref: Ref | null;
  /** The id came from the address, so it is this game for sure (a link could be another one). */
  refFromUrl: boolean;
  /** Chess.com said the game is being played (404, or not finished), so it ends in front of us. */
  serverLive: boolean;
  /** The finished game from Chess.com. */
  server: ChessComGame | null;
  /** When to ask Chess.com next, and how many times since the page showed the end. */
  nextCheck: number;
  retries: number;
  /** The page shows the game is over (its result, or the result box). */
  endShown: boolean;
  /** The card has opened (or was skipped) for this game. */
  popped: boolean;
}

const newSession = (): Session => ({ watch: new MoveListWatch(), ref: null, refFromUrl: false, serverLive: false, server: null, nextCheck: 0, retries: 0, endShown: false, popped: false });

let session = newSession();
let checking = false;

/** Whether Chess.com's copy is the game on the page: certain from the address, else the move counts must agree. */
function serverIsThisGame(s: Session, plies: number | null): boolean {
  if (!s.server) return false;
  return s.refFromUrl || plies === null || plies === 0 || s.server.plies === plies;
}

const fresh = (endedAt: number | null) => endedAt !== null && Date.now() - endedAt < FRESH_MS;

async function checkServer() {
  const s = session;
  const ref = s.ref;
  if (!ref || checking || s.server) return;
  checking = true;
  let wait = POLL_MS.blind;
  try {
    const r = await readGame(ref);
    if (s !== session) return;
    if (r.finished) {
      s.server = r.game;
      log(`Chess.com: game ${refKey(ref)} is over`, r.game ? `(${r.game.plies} plies, ended ${Math.round((Date.now() - (r.game.endedAt ?? Date.now())) / 1000)} s ago)` : "(not standard chess: no review)");
      if (!r.game) s.popped = true;
      return;
    }
    if (!s.endShown) s.serverLive = true;
    log(`Chess.com: game ${refKey(ref)} is being played`);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 0;
    if (s !== session) return;
    // 404: a live game Chess.com doesn't serve yet: one being played (or one that ended a moment ago).
    if (status === 404) s.serverLive = true;
    if (status === 429) wait = RATE_LIMITED_MS;
    log(`Chess.com: game ${refKey(ref)} answered ${status || "with an error"}`);
  } finally {
    checking = false;
    if (s === session && !s.server) {
      if (s.endShown && wait !== RATE_LIMITED_MS) wait = ENDED_RETRY_MS[Math.min(s.retries++, ENDED_RETRY_MS.length - 1)];
      else if (wait !== RATE_LIMITED_MS && readMoveList()) wait = POLL_MS.watched;
      s.nextCheck = Date.now() + wait;
    }
  }
}

function tick() {
  if (!GAME_PAGES.test(location.pathname)) return;
  let s = session;

  const urlRef = chessComGameRef(location.href);
  if (urlRef && s.ref && s.refFromUrl && refKey(urlRef) !== refKey(s.ref)) {
    log(`another game in the address: ${refKey(urlRef)}`);
    s = session = newSession();
  }

  const list = readMoveList();
  const change = s.watch.see(list?.sighting ?? null, Date.now());
  if (change === "new") {
    log("a new game started in the move list");
    const watch = s.watch;
    s = session = newSession();
    s.watch = watch;
  } else if (change === "ended") log(`the game ended on the page: ${s.watch.result}`);

  const endShown = !!s.watch.result || resultBoxOnPage();
  if (endShown && !s.endShown) {
    s.endShown = true;
    s.nextCheck = 0; // ask Chess.com now
    s.retries = 0;
  }

  // Learn the game's id: the address names it during the game; the Game Review button once it's over.
  if (!s.ref || (!s.refFromUrl && urlRef)) {
    const ref = urlRef ?? (endShown ? reviewButtonRef() : null);
    if (ref && (!s.ref || refKey(ref) !== refKey(s.ref))) {
      s.ref = ref;
      s.refFromUrl = !!urlRef;
      s.nextCheck = 0;
      log(`game ${refKey(ref)} (from the ${urlRef ? "address" : "Game Review button"})`);
      if (s.popped) remember([refKey(ref)]);
    }
  }
  if (s.ref && !s.server && !checking && Date.now() >= s.nextCheck) void checkServer();

  if (s.popped || !autoOpen()) return;
  const plies = list?.sighting.plies ?? null;
  const serverMatches = serverIsThisGame(s, plies);
  const serverEnded = serverMatches && (s.serverLive || fresh(s.server!.endedAt));
  // Chess.com says this game ended long ago and it was never seen being played: it was opened, not played.
  const stale = serverMatches && !s.serverLive && !fresh(s.server!.endedAt);
  if (serverEnded || (s.watch.ended && !stale)) pop(serverEnded ? "Chess.com's game data" : "the move list");
}

/** Opens the card for the game that just ended, once per game. */
function pop(source: string) {
  const s = session;
  s.popped = true;
  const list = readMoveList();
  const keys: string[] = [];
  if (s.ref) keys.push(refKey(s.ref));
  if (list?.sighting.result) {
    const sans = plyNodes(list.el).slice(0, 12).map(sanOf).join(" ");
    keys.push(`page:${list.sighting.plies}:${list.sighting.result}:${sans}`);
  }
  if (shownBefore(keys)) return log("the game ended; its card has opened before");
  remember(keys);
  log(`the game ended (seen in ${source}): opening the card`);
  openCard(resolveGame(s).then((g) => (s !== session ? null : (g ?? "Couldn't read this game from Chess.com. Open it again, or use the toolbar button."))));
}

/** The game for the card: Chess.com's copy (full headers) if it comes quickly, else the page's own moves. */
async function resolveGame(s: Session): Promise<ChessComGame | null> {
  const fromPage = () => {
    const list = readMoveList();
    return list?.sighting.result ? pageGame(list.el, list.sighting.result, s.ref) : null;
  };
  const plies = () => readMoveList()?.sighting.plies ?? null;
  const start = Date.now();
  let page: ChessComGame | null = null;
  // Without the page's moves, wait as long as Chess.com may take to serve the game.
  while (s === session) {
    if (s.server && serverIsThisGame(s, plies())) return s.server;
    page ??= fromPage();
    const waited = Date.now() - start;
    if (!s.ref && page) return page;
    if (waited > (page ? SERVER_WAIT_MS : 45_000)) return page;
    await sleep(250);
  }
  return page;
}

function watching(): string {
  if (!GAME_PAGES.test(location.pathname)) return "";
  const s = session;
  if (s.watch.result || s.server) return "This game is over.";
  if (s.watch.live || s.serverLive) return "Watching this game: the card opens when it ends.";
  return "Waiting for a game on this page.";
}

// ---- The toolbar button ---------------------------------------------------------------------

/** The finished game to review, or why there isn't one. */
async function find(): Promise<FindReply> {
  const list = readMoveList();
  const plies = list?.sighting.plies ?? null;
  if (session.server && serverIsThisGame(session, plies)) return { ok: true, game: session.server };
  const fromPage = list?.sighting.result ? pageGame(list.el, list.sighting.result, session.ref) : null;
  let ref = gameOnPage();
  if (!ref && !fromPage) {
    const user = signedInUser();
    ref = user ? await newestOwnGame(user).catch(() => null) : null;
  }
  if (!ref) {
    if (fromPage) return { ok: true, game: fromPage };
    return { ok: false, message: "No game found here. Open one of your games on Chess.com (or finish one), then click again." };
  }
  // Chess.com serves a live game only once it has ended (404 before), sometimes a moment after.
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await readGame(ref);
      if (!r.finished) return fromPage ? { ok: true, game: fromPage } : { ok: false, message: "This game isn't over yet. Finish it, then click again." };
      if (!r.game) return { ok: false, message: "Only standard chess games can be reviewed." };
      // A game linked on the page may be another one than the board shows.
      if (fromPage && r.game.plies !== fromPage.plies && !chessComGameRef(location.href)) return { ok: true, game: fromPage };
      return { ok: true, game: r.game };
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 0;
      if (status === 404 && attempt < 3) {
        await sleep(1500);
        continue;
      }
      if (fromPage) return { ok: true, game: fromPage };
      if (status === 404) return { ok: false, message: "Chess.com hasn't published this game yet. If it's still being played, finish it first, then click again." };
      if (status === 429) return { ok: false, message: "Chess.com is busy for a moment. Click again in a few seconds." };
      return { ok: false, message: "Couldn't read this game from Chess.com. Check your connection and try again." };
    }
  }
}

startWatching({
  tick,
  find,
  watching,
  opened: () => {
    session.popped = true;
  },
}, "chesscom");
