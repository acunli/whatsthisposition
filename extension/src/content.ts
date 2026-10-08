/**
 * Runs on Chess.com and waits to be asked. The toolbar button (popup.ts) asks which
 * game is on screen ("wtp:find") and then to open its review ("wtp:open"): a card in the
 * bottom-right corner, an extension page in an iframe (panel.html), with Stockfish in
 * the extension's hidden engine page, on your computer.
 *
 * Nothing runs on its own and nothing is analysed during a game: Chess.com's own game
 * data says whether the game is over (`isFinished`).
 */
import { chessComGameRef, gameFromCallback, type ChessComCallback, type ChessComGame } from "@/lib/review/chesscomGame";

type Ref = { id: number; kind: "live" | "daily" };
export type FindReply = { ok: true; game: ChessComGame } | { ok: false; message: string };

const PANEL = chrome.runtime.getURL("panel.html");
const PANEL_ORIGIN = new URL(PANEL).origin;

const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { width: 360px; max-width: calc(100vw - 36px); border-radius: 18px; overflow: hidden; box-shadow: 0 18px 50px rgb(0 0 0 / 0.55); background: #0c110f; animation: rise 0.28s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
iframe { display: block; width: 100%; height: 230px; border: 0; transition: height 0.24s cubic-bezier(0.4, 0, 0.2, 1); }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } iframe { transition: none; } }
`;

let host: HTMLElement | null = null;
let frame: HTMLIFrameElement | null = null;
let game: ChessComGame | null = null;

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The game on screen, from the first of these that names one: the URL (`/game/live/123`,
 * `/game/123`); Chess.com's Game Review button, a link to `/analysis/game/live/123?tab=review`
 * (in the result box and the side panel); the newest game linked elsewhere on the page.
 */
function gameOnPage(): Ref | null {
  const fromUrl = chessComGameRef(location.href);
  if (fromUrl) return fromUrl;
  const review = document.querySelector<HTMLAnchorElement>('a.game-over-primary-cta[href], a[href*="/analysis/game/"][href*="review"]');
  const fromButton = review && chessComGameRef(review.href);
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

/** The finished game to review, or why there isn't one. */
async function find(): Promise<FindReply> {
  let ref = gameOnPage();
  if (!ref) {
    const user = signedInUser();
    ref = user ? await newestOwnGame(user).catch(() => null) : null;
  }
  if (!ref) return { ok: false, message: "No game found here. Open one of your games on Chess.com (or finish one), then click again." };
  // Chess.com serves a live game only once it has ended (404 before), sometimes a moment after.
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await readGame(ref);
      if (!r.finished) return { ok: false, message: "This game isn't over yet. Finish it, then click again." };
      if (!r.game) return { ok: false, message: "Only standard chess games can be reviewed." };
      return { ok: true, game: r.game };
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 0;
      if (status === 404 && attempt < 3) {
        await sleep(1500);
        continue;
      }
      if (status === 404) return { ok: false, message: "Chess.com hasn't published this game yet. If it's still being played, finish it first, then click again." };
      if (status === 429) return { ok: false, message: "Chess.com is busy for a moment. Click again in a few seconds." };
      return { ok: false, message: "Couldn't read this game from Chess.com. Check your connection and try again." };
    }
  }
}

function removeUi() {
  host?.remove();
  host = null;
  frame = null;
}

/** The card: the panel page in an iframe, which gets the game once it says it's ready. */
function showCard() {
  removeUi();
  host = document.createElement("div");
  host.id = "whatsthisposition-extension";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="card"><iframe title="what’sthisposition game review" src="${PANEL}"></iframe></div></div>`;
  document.documentElement.appendChild(host);
  frame = root.querySelector("iframe");
}

function onPanelMessage(e: MessageEvent) {
  if (e.origin !== PANEL_ORIGIN || !frame || e.source !== frame.contentWindow) return;
  const msg = e.data as { type?: string; height?: number };
  if (msg?.type === "wtp:ready" && game) frame.contentWindow?.postMessage({ type: "wtp:game", game }, PANEL_ORIGIN);
  else if (msg?.type === "wtp:size" && typeof msg.height === "number") frame.style.height = `${Math.min(Math.max(msg.height, 120), innerHeight - 36)}px`;
  else if (msg?.type === "wtp:close") removeUi();
}

const flag = window as unknown as { __whatsthisposition?: boolean };
if (!flag.__whatsthisposition) {
  flag.__whatsthisposition = true;
  addEventListener("message", onPanelMessage);
  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, reply: (r: FindReply) => void) => {
    if (msg?.type !== "wtp:find" && msg?.type !== "wtp:open") return false;
    void find().then((r) => {
      if (r.ok && msg.type === "wtp:open") {
        game = r.game;
        showCard();
      }
      reply(r);
    });
    return true; // the reply comes later
  });
}
