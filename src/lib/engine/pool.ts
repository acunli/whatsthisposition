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

/**
 * One engine per spare core: up to 7 on a computer (8 cores, 2026-10-13: a 38-move review took
 * 63 s with 4 engines, 55 s with 6 and 50 s with 7), but at most 4 on phones and small-memory
 * devices, where more workers mean more heat and a tab that gets killed in the background.
 */
export function poolSize(): number {
  if (typeof navigator === "undefined") return 2;
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const touch = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const cap = touch || (memory !== undefined && memory < 8) ? 4 : 7;
  return Math.max(1, Math.min(cap, cores - 1));
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
