/**
 * Runs on Chess.com. When a game ends while you watch, a card pops up in the corner
 * with an "Analyze" button; on a game that was already over, a small button offers the
 * same. The card is an extension page in an iframe (panel.html), so the analysis runs
 * on your computer, apart from the page.
 *
 * It only ever acts on finished games: Chess.com's own game data (`isFinished`) decides,
 * so nothing is shown or analysed while a game is being played.
 */
import { chessComGameRef, gameFromCallback, type ChessComCallback, type ChessComGame } from "@/lib/review/chesscomGame";
import { markSvg } from "@/lib/logoPaths";

declare const chrome: { runtime: { getURL(path: string): string } };

type Ref = { id: number; kind: "live" | "daily" };

const PANEL = chrome.runtime.getURL("panel.html");
const PANEL_ORIGIN = new URL(PANEL).origin;
/** How often an unfinished game is checked: live games end fast, daily games slowly. */
const POLL_MS = { live: 3000, daily: 30000 };
const WATCH_MS = 1500;

const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.pill { display: inline-flex; align-items: center; gap: 9px; height: 44px; padding: 0 16px 0 9px; border-radius: 999px; border: 1px solid #2b3a33; background: #0c110f; color: #f1ede2; font: 600 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif; cursor: pointer; box-shadow: 0 10px 30px rgb(0 0 0 / 0.45); }
.pill:hover { border-color: #ff7629; }
.pill b { color: #ff7629; font-weight: 800; }
.card { width: 360px; max-width: calc(100vw - 36px); border-radius: 18px; overflow: hidden; box-shadow: 0 18px 50px rgb(0 0 0 / 0.55); background: #0c110f; animation: rise 0.28s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
iframe { display: block; width: 100%; height: 230px; border: 0; transition: height 0.24s cubic-bezier(0.4, 0, 0.2, 1); }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } iframe { transition: none; } }
`;

let current: { key: string; ref: Ref; seenPlaying: boolean; settled: boolean } | null = null;
let host: HTMLElement | null = null;
let frame: HTMLIFrameElement | null = null;
let game: ChessComGame | null = null;

/** The game on screen: from the URL, or on the play page, from the links in its result box. */
function currentRef(): Ref | null {
  const fromUrl = chessComGameRef(location.href);
  if (fromUrl) return fromUrl;
  if (!location.pathname.startsWith("/play")) return null;
  const links = document.querySelectorAll<HTMLAnchorElement>('[class*="game-over"] a[href*="/game/"], [class*="modal"] a[href*="/game/"]');
  for (let i = links.length - 1; i >= 0; i--) {
    const r = chessComGameRef(links[i].href);
    if (r) return r;
  }
  return null;
}

async function readGame(ref: Ref): Promise<{ finished: boolean; game: ChessComGame | null }> {
  const res = await fetch(`/callback/${ref.kind}/game/${ref.id}`, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const cb = (await res.json()) as ChessComCallback;
  return { finished: !!cb.game?.isFinished, game: gameFromCallback(cb, ref.kind) };
}

function removeUi() {
  host?.remove();
  host = null;
  frame = null;
}

function mount(): ShadowRoot {
  removeUi();
  host = document.createElement("div");
  host.id = "whatsthisposition-extension";
  const root = host.attachShadow({ mode: "open" });
  document.documentElement.appendChild(host);
  return root;
}

/** The small button for a game that was already over. */
function showPill() {
  const root = mount();
  root.innerHTML = `<style>${CSS}</style><div class="wrap"><button class="pill" type="button" aria-label="Review this game with what’sthisposition">${markSvg(26)}<span>Review with <b>what’sthisposition</b></span></button></div>`;
  root.querySelector("button")!.addEventListener("click", showCard);
}

/** The card: the panel page in an iframe, which gets the game once it says it's ready. */
function showCard() {
  const root = mount();
  root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="card"><iframe title="what’sthisposition game review" src="${PANEL}"></iframe></div></div>`;
  frame = root.querySelector("iframe");
}

function onMessage(e: MessageEvent) {
  if (e.origin !== PANEL_ORIGIN || !frame || e.source !== frame.contentWindow) return;
  const msg = e.data as { type?: string; height?: number };
  if (msg?.type === "wtp:ready" && game) frame.contentWindow?.postMessage({ type: "wtp:game", game }, PANEL_ORIGIN);
  else if (msg?.type === "wtp:size" && typeof msg.height === "number") frame.style.height = `${Math.min(Math.max(msg.height, 120), innerHeight - 36)}px`;
  else if (msg?.type === "wtp:close") showPill();
}

async function tick() {
  const ref = currentRef();
  const key = ref ? `${ref.kind}/${ref.id}` : "";
  if (!ref) {
    if (current) {
      current = null;
      game = null;
      removeUi();
    }
    return void setTimeout(tick, WATCH_MS);
  }
  if (current?.key !== key) {
    current = { key, ref, seenPlaying: false, settled: false };
    game = null;
    removeUi();
  }
  // Settled (shown, or not a game we can review): only watch for the next game.
  if (current.settled) return void setTimeout(tick, WATCH_MS);
  try {
    const r = await readGame(ref);
    if (current?.key !== key) return void setTimeout(tick, 0);
    if (!r.finished) {
      current.seenPlaying = true;
      return void setTimeout(tick, POLL_MS[ref.kind]);
    }
    current.settled = true;
    game = r.game;
    // It ended while you watched: offer the review at once. An old game: just the button.
    if (game) (current.seenPlaying ? showCard : showPill)();
  } catch {
    current.settled = true;
  }
  setTimeout(tick, WATCH_MS);
}

const flag = window as unknown as { __whatsthisposition?: boolean };
if (!flag.__whatsthisposition) {
  flag.__whatsthisposition = true;
  addEventListener("message", onMessage);
  void tick();
}
