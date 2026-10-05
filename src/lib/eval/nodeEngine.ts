/**
 * The Stockfish build that the browser uses, run in Node for the evaluation tools.
 * Only one instance can be started per process (a second fails with "memory import").
 */
import { createRequire } from "node:module";
import type { Searcher } from "../deep/deep";
import { EngineClient } from "../engine/client";

let cached: Promise<Searcher> | null = null;

export function nodeSearcher(): Promise<Searcher> {
  if (!cached) {
    cached = (async () => {
      const require = createRequire(import.meta.url);
      const init = require("stockfish") as (f: string) => Promise<{ sendCommand(c: string): void; listener?: (l: string) => void }>;
      const e = await init("lite-single");
      const client = new EngineClient({
        post: (c) => e.sendCommand(c),
        onLine: (cb) => {
          e.listener = cb;
        },
        onError: () => undefined,
        terminate: () => undefined,
      });
      await client.ready;
      return (r) => client.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves, fresh: r.fresh }).promise.then((s) => s.lines);
    })();
  }
  return cached;
}

/** A Chess.com PubAPI game, as saved by scripts/eval/fetch-games.mjs. */
export interface SavedGame {
  url: string;
  pgn: string;
  time_class: string;
  accuracies?: { white?: number; black?: number };
}
