"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createEnginePool, type EnginePool } from "@/lib/engine/pool";
import { fromGame, sideOf } from "@/lib/puzzles/build";
import { makeSet } from "@/lib/puzzles/profile";
import type { PuzzleSet } from "@/lib/puzzles/types";
import { loadBook } from "@/lib/review/book";
import { parseGame, type ParsedGame } from "@/lib/review/pgn";
import { classifyGame, runReview } from "@/lib/review/review";
import { VERIFY_EXTRA } from "../review/useReview";

/** The review's Fast depth: mistakes are found there, and the sharp ones are searched four plies deeper anyway. */
export const PUZZLE_DEPTH = 12;
/** A game shorter than this has nothing to learn from. */
const MIN_PLIES = 12;

export interface MakerGame {
  pgn: string;
  url?: string;
}

export type MakerState =
  | { status: "idle" }
  | { status: "working"; game: number; games: number; share: number; engines: number; label: string }
  | { status: "done"; set: PuzzleSet; skipped: number }
  | { status: "error"; message: string };

/**
 * Reviews the chosen games one after another on the engine pool (the same review the
 * review page runs) and turns the named player's mistakes into a puzzle set
 * (lib/puzzles). Everything happens in this browser.
 */
export function usePuzzleMaker() {
  const [state, setState] = useState<MakerState>({ status: "idle" });
  const run = useRef<{ signal: { cancelled: boolean }; pool: EnginePool } | null>(null);

  const stop = useCallback(() => {
    const r = run.current;
    run.current = null;
    if (!r) return;
    r.signal.cancelled = true;
    r.pool.dispose();
  }, []);

  const cancel = useCallback(() => {
    stop();
    setState({ status: "idle" });
  }, [stop]);

  const start = useCallback(
    (games: MakerGame[], player: string) => {
      stop();
      const signal = { cancelled: false };
      const pool = createEnginePool();
      run.current = { signal, pool };
      setState({ status: "working", game: 0, games: games.length, share: 0, engines: pool.size, label: "" });
      const work = async () => {
        const book = await loadBook().catch(() => null);
        const parts: ReturnType<typeof fromGame>[] = [];
        let skipped = 0;
        for (let i = 0; i < games.length; i++) {
          if (signal.cancelled) return;
          let g: ParsedGame;
          try {
            g = parseGame(games[i].pgn);
          } catch {
            skipped++;
            continue;
          }
          const side = sideOf(g, player);
          if (!side || g.moves.length < MIN_PLIES) {
            skipped++;
            continue;
          }
          setState({ status: "working", game: i, games: games.length, share: 0, engines: pool.size, label: `${g.white} vs ${g.black}` });
          const positions = await runReview(g, pool.searchers, {
            depth: PUZZLE_DEPTH,
            verifyDepth: PUZZLE_DEPTH + VERIFY_EXTRA,
            book: Promise.resolve(book),
            signal,
            onProgress: (p) => setState((s) => (s.status === "working" && s.game === i ? { ...s, share: Math.max(s.share, p.share) } : s)),
          });
          if (signal.cancelled) return;
          parts.push(fromGame({ game: g, review: classifyGame(g, positions, book), positions, player: side, index: parts.length, url: games[i].url }));
        }
        if (signal.cancelled) return;
        pool.dispose();
        run.current = null;
        if (!parts.length) setState({ status: "error", message: `None of those games could be used: ${player} has to be one of the players, and a game needs at least six moves.` });
        else setState({ status: "done", set: makeSet(parts, player, Date.now()), skipped });
      };
      work().catch((e) => {
        if (signal.cancelled) return;
        pool.dispose();
        run.current = null;
        setState({ status: "error", message: e instanceof Error ? e.message : "The engine stopped." });
      });
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { state, start, cancel };
}
