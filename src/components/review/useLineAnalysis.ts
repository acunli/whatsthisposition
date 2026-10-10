"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EngineLine } from "@/lib/engine/client";
import { createEnginePool, type EnginePool } from "@/lib/engine/pool";
import { terminalEval, type PositionAnalysis } from "@/lib/review/classify";

/** A position a side line needs searched: two lines at `depth`, or (with `quiet`) the best of those moves only. */
export interface LineRequest {
  key: string;
  fen: string;
  depth: number;
  quiet?: string[];
}

export interface LineAnalyses {
  positions: Map<string, PositionAnalysis>;
  /** The best quiet move per position (`PositionAnalysis.quiet`), searched where a sacrifice needs it. */
  quiet: Map<string, EngineLine>;
}

export interface LineAnalysis extends LineAnalyses {
  /** What should be searched now, most wanted first (replaces the previous list). */
  want: (requests: LineRequest[]) => void;
}

/**
 * Searches side-line positions on one engine of their own, in the order asked (the line on the
 * board first), each as deep as asked: the same MultiPV-2 searches with a fresh hash as the
 * game's review, so a line's labels are comparable with the game's. Results are kept by position.
 */
export function useLineAnalysis(enabled: boolean): LineAnalysis {
  const [state, setState] = useState<LineAnalyses>(() => ({ positions: new Map(), quiet: new Map() }));
  const store = useRef(state);
  const wanted = useRef<LineRequest[]>([]);
  const on = useRef(enabled);
  const busy = useRef(false);
  const pool = useRef<EnginePool | null>(null);
  // Searches that came back empty, so they aren't asked again and again.
  const tried = useRef(new Set<string>());

  useEffect(() => {
    on.current = enabled;
  });

  useEffect(
    () => () => {
      pool.current?.dispose();
      pool.current = null;
    },
    [],
  );

  const needs = (r: LineRequest) => {
    const id = `${r.key}|${r.depth}|${r.quiet ? "q" : "l"}`;
    if (tried.current.has(id)) return false;
    if (r.quiet) return (store.current.quiet.get(r.key)?.depth ?? -1) < r.depth;
    const have = store.current.positions.get(r.key);
    return !have || (have.lines.length > 0 && have.depth < r.depth);
  };

  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (;;) {
        if (!on.current) break;
        const r = wanted.current.find(needs);
        if (!r) break;
        const id = `${r.key}|${r.depth}|${r.quiet ? "q" : "l"}`;
        const terminal = terminalEval(r.fen);
        if (terminal && !r.quiet) {
          store.current = { ...store.current, positions: new Map(store.current.positions).set(r.key, { lines: [], eval: terminal, depth: 0 }) };
          setState(store.current);
          continue;
        }
        if (r.quiet && !r.quiet.length) {
          tried.current.add(id);
          continue;
        }
        pool.current ??= createEnginePool(1);
        const lines = await pool.current.searchers[0]({ fen: r.fen, depth: r.depth, multipv: r.quiet ? 1 : 2, searchmoves: r.quiet, fresh: true });
        if (!lines.length) {
          tried.current.add(id);
          continue;
        }
        store.current = r.quiet
          ? { ...store.current, quiet: new Map(store.current.quiet).set(r.key, lines[0]) }
          : { ...store.current, positions: new Map(store.current.positions).set(r.key, { lines, eval: lines[0].eval, depth: lines[0].depth }) };
        setState(store.current);
      }
    } catch {
      // The engine went away (the page closed the review); the next request starts a fresh one.
      pool.current?.dispose();
      pool.current = null;
    } finally {
      busy.current = false;
    }
  }, []);

  const want = useCallback(
    (requests: LineRequest[]) => {
      wanted.current = requests;
      if (on.current && requests.length) void pump();
    },
    [pump],
  );

  useEffect(() => {
    if (enabled && wanted.current.length) void pump();
  }, [enabled, pump]);

  return { ...state, want };
}
