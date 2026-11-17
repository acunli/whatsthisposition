/**
 * What the page scripts for both sites share (content.ts on Chess.com, lichess.ts on Lichess):
 * the review card (panel.html in an iframe in the bottom-right corner), the toolbar popup's
 * questions ("wtp:find", "wtp:open", "wtp:status"), whether the extension watches this site's games
 * (the popup's tick for the site), the games whose card has opened already, and stopping when a
 * newer copy of the script arrives (after the extension is installed, updated or reloaded, the
 * service worker adds the script to open tabs).
 */
import type { FinishedGame } from "@/lib/review/finishedGame";

export type FindReply = { ok: true; game: FinishedGame } | { ok: false; message: string };
export type StatusReply = { on: boolean; watching: string };

/** The sites a page script runs on. */
export type Site = "chesscom" | "lichess";

/**
 * Whether the card opens by itself on Chess.com: the popup's Chess.com tick, on unless its user
 * took it off. Before it there was one switch for both sites (`auto`), which still counts until
 * the tick is first changed.
 */
export const chessComOn = (v: { chesscom?: unknown; auto?: unknown }) => (typeof v.chesscom === "boolean" ? v.chesscom : v.auto !== false);

/** A site's page script, as the card sees it. */
export interface PageWatcher {
  /** Looks at the page: twice a second, and when the tab comes back into view. */
  tick(): void;
  /** The finished game on the page for the toolbar button, or why there isn't one. */
  find(): Promise<FindReply>;
  /** What it is doing, for the popup ("Watching this game: the card opens when it ends."). */
  watching(): string;
  /** The toolbar button opened the card for the game on the page. */
  opened(): void;
}

/** How often the page is looked at. */
const TICK_MS = 500;
/** Games whose card has opened, so a reload doesn't open it again. */
const SHOWN_MAX = 60;

const PANEL = chrome.runtime.getURL("panel.html");
const PANEL_ORIGIN = new URL(PANEL).origin;
const TAKEOVER = "whatsthisposition:takeover";

const CSS = `
:host { all: initial; }
.wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.card { width: 360px; max-width: calc(100vw - 36px); border-radius: 18px; overflow: hidden; box-shadow: 0 18px 50px rgb(0 0 0 / 0.55); background: #0c110f; animation: rise 0.28s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
iframe { display: block; width: 100%; height: 230px; border: 0; transition: height 0.24s cubic-bezier(0.4, 0, 0.2, 1); }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) { .card { animation: none; } iframe { transition: none; } }
`;

export const log = (...args: unknown[]) => console.debug("[what’sthisposition]", ...args);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** False once the extension has been reloaded or removed: this copy is cut off and must stop. */
function alive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

let watcher: PageWatcher | null = null;
let site: Site = "chesscom";
/**
 * Whether this site's games are watched, so the card opens by itself when one ends. Lichess's
 * tick is the browser's permission for lichess.org (lichessAccess.ts): with it this script runs
 * there; Chess.com's is a setting, since the extension always may run there. Off, the page is
 * left alone, though the toolbar button still opens the card for the game on it.
 */
let on = true;
const shown = new Set<string>();

let host: HTMLElement | null = null;
let frame: HTMLIFrameElement | null = null;
let panelReady = false;
let game: FinishedGame | null = null;
let failure: string | null = null;
/** Counts the cards opened, so a game read for an earlier card isn't sent to a later one. */
let opens = 0;

/** Whether the card opens by itself when a game ends on this site (the popup's tick for it). */
export const autoOpen = () => on;

/** True if a card has opened before for any of these keys (a game's id, its moves). */
export const shownBefore = (keys: string[]) => keys.some((k) => shown.has(k));

/** Remembers that these keys' game has had its card, also across reloads. */
export function remember(keys: string[]) {
  for (const k of keys) shown.add(k);
  try {
    void chrome.storage.local.set({ shown: [...shown].slice(-SHOWN_MAX) });
  } catch {
    /* cut off from the extension: nothing to remember it in */
  }
}

/**
 * Opens the card now. The game follows when it has been read: the game, why it couldn't be read
 * (a string, shown in the card), or null when it no longer matters (another game started).
 */
export function openCard(next: FinishedGame | Promise<FinishedGame | string | null>) {
  const n = ++opens;
  game = null;
  failure = null;
  showCard();
  if (!(next instanceof Promise)) {
    game = next;
    return;
  }
  void next.then((r) => {
    if (n !== opens || frame === null || r === null) return;
    if (typeof r === "string") failure = r;
    else game = r;
    sendToPanel();
  });
}

function removeUi() {
  host?.remove();
  host = null;
  frame = null;
  panelReady = false;
}

/** The card: the panel page in an iframe, which gets the game once it says it's ready. */
function showCard() {
  removeUi();
  host = document.createElement("div");
  host.id = "whatsthisposition-extension";
  const root = host.attachShadow({ mode: "open" });
  // The panel talks only to the page it was opened in (Chess.com or Lichess).
  const src = `${PANEL}?host=${encodeURIComponent(location.origin)}`;
  root.innerHTML = `<style>${CSS}</style><div class="wrap"><div class="card"><iframe title="what’sthisposition game review" src="${src}"></iframe></div></div>`;
  document.documentElement.appendChild(host);
  frame = root.querySelector("iframe");
}

function sendToPanel() {
  if (!frame || !panelReady) return;
  if (game) frame.contentWindow?.postMessage({ type: "wtp:game", game }, PANEL_ORIGIN);
  else if (failure) frame.contentWindow?.postMessage({ type: "wtp:error", message: failure }, PANEL_ORIGIN);
}

function onPanelMessage(e: MessageEvent) {
  if (e.origin !== PANEL_ORIGIN || !frame || e.source !== frame.contentWindow) return;
  const msg = e.data as { type?: string; height?: number };
  if (msg?.type === "wtp:ready") {
    panelReady = true;
    sendToPanel();
  } else if (msg?.type === "wtp:size" && typeof msg.height === "number") frame.style.height = `${Math.min(Math.max(msg.height, 120), innerHeight - 36)}px`;
  else if (msg?.type === "wtp:close") removeUi();
}

function onMessage(msg: { type?: string }, _sender: unknown, reply: (r: FindReply | StatusReply) => void): boolean {
  const w = watcher;
  if (!w) return false;
  if (msg?.type === "wtp:status") {
    reply({ on, watching: on ? w.watching() : "" });
    return false;
  }
  if (msg?.type !== "wtp:find" && msg?.type !== "wtp:open") return false;
  void w.find().then((r) => {
    if (r.ok && msg.type === "wtp:open") {
      w.opened();
      openCard(r.game);
    }
    reply(r);
  });
  return true; // the reply comes later
}

function onStorage(changes: Record<string, chrome.storage.StorageChange>, area: string) {
  if (area !== "local" || site !== "chesscom" || !(changes.chesscom || changes.auto)) return;
  void chrome.storage.local
    .get(["chesscom", "auto"])
    .then((v) => {
      on = chessComOn(v);
    })
    .catch(() => undefined);
}

// ---- Start, and stop when a newer copy arrives -----------------------------------------------

let timer = 0;

function tick() {
  if (!alive()) return stop();
  if (host && !host.isConnected) document.documentElement.appendChild(host); // something took the card out of the page
  if (on) watcher?.tick();
}

function stop() {
  clearInterval(timer);
  removeEventListener("message", onPanelMessage);
  document.removeEventListener("visibilitychange", tick);
  document.removeEventListener(TAKEOVER, stop);
  try {
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.storage.onChanged.removeListener(onStorage);
  } catch {
    /* already cut off from the extension */
  }
  removeUi();
  watcher = null;
  log("stopped (a newer copy took over, or the extension was reloaded)");
}

/** Starts the page script on `s`: the card, the popup's questions, and `w` looking at the page. */
export function startWatching(w: PageWatcher, s: Site) {
  watcher = w;
  site = s;
  // A copy from before an update or reload may still be on the page: it stops when it hears this.
  document.dispatchEvent(new Event(TAKEOVER));
  document.getElementById("whatsthisposition-extension")?.remove();
  document.addEventListener(TAKEOVER, stop);
  addEventListener("message", onPanelMessage);
  document.addEventListener("visibilitychange", tick);
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  void chrome.storage.local
    .get(["chesscom", "auto", "shown"])
    .then((v) => {
      on = site === "lichess" || chessComOn(v);
      for (const k of (v.shown as string[]) ?? []) shown.add(k);
    })
    .catch(() => undefined)
    .finally(() => {
      timer = window.setInterval(tick, TICK_MS);
      tick();
    });
  log("watching for finished games");
}
