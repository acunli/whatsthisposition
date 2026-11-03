/**
 * Firefox's background: an event page rather than a service worker, so it can start Stockfish's
 * workers itself, and Firefox has no offscreen documents. The engine page's code (engine.ts) runs
 * here, and a card's request to open the engine is answered at once.
 *
 * After an install, update or reload it also adds the page script to the Chess.com tabs that
 * are already open (reinject.ts).
 */
import { reinjectOnInstall } from "./reinject";
import "./engine";

reinjectOnInstall();

chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, reply) => {
  if (msg?.type === "wtp:engine-open") reply({ ok: true });
  return false;
});
