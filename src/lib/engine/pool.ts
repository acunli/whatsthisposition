"use client";

/**
 * A small pool of engine workers for game review: each worker analyses its own
 * positions, so a 40-move game finishes several times faster than with one engine.
 * Separate from the single analysis engine in browser.ts, and torn down after use.
 */
import type { Searcher } from "../deep/deep";
import { EngineClient, createWorkerTransport } from "./client";

export interface EnginePool {
  searchers: Searcher[];
  size: number;
  /** Stops every search and terminates the workers. */
  dispose(): void;
}

export function poolSize(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(4, cores - 1));
}

export function createEnginePool(size = poolSize()): EnginePool {
  const clients: EngineClient[] = [];
  for (let i = 0; i < size; i++) clients.push(new EngineClient(createWorkerTransport("/engine/stockfish.js")));
  const searchers: Searcher[] = clients.map(
    (engine) => (r) =>
      engine.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves, fresh: r.fresh }).promise.then((snap) => {
        if (snap.cancelled) throw new Error("cancelled");
        return snap.lines;
      }),
  );
  return {
    searchers,
    size,
    dispose() {
      for (const c of clients) {
        try {
          c.cancelAll();
          c.terminate();
        } catch {
          /* already gone */
        }
      }
    },
  };
}
