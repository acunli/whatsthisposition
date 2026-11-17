/**
 * Gets a review's downloads going before the review starts: the engine (about 1.8 MB) and the
 * opening book (about 2.8 MB). On a first visit they otherwise download inside the review's own
 * time, seconds on a phone's connection, and the deeper second pass waits for the book. Called once
 * a player's game list is on screen, so only people about to pick a game download them early.
 */
import { loadBook } from "./book";

/** The engine's files, as the review's workers load them (scripts/copy-engine.mjs). */
const ENGINE_FILES = ["/engine/stockfish.js", "/engine/stockfish.wasm"];

let warmed = false;

export function warmReview(): void {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  const go = () => {
    // The book is fetched and read once; the review gets the same promise.
    void loadBook().catch(() => undefined);
    // Into the HTTP cache, where the workers' own requests find them.
    for (const url of ENGINE_FILES) void fetch(url).catch(() => undefined);
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(go, { timeout: 1500 });
  else setTimeout(go, 200);
}
