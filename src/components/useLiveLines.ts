"use client";

import { useEffect, useState } from "react";
import { Chess } from "chess.js";
import { getLinesEngine } from "@/lib/engine/browser";
import type { EngineLine } from "@/lib/engine/client";

export interface LiveLines {
  /** The position these lines are for. */
  fen: string;
  lines: EngineLine[];
  depth: number;
  done: boolean;
}

/**
 * The engine's top lines for `fen`, updating as the search deepens (like Lichess's
 * local analysis). Runs on its own worker; a new position cancels the old search.
 */
export function useLiveLines(fen: string | null, { enabled = true, multipv = 3, depth = 20 }: { enabled?: boolean; multipv?: number; depth?: number } = {}): LiveLines | null {
  const [state, setState] = useState<LiveLines | null>(null);
  useEffect(() => {
    if (!fen || !enabled) return;
    let over = false;
    try {
      over = new Chess(fen).isGameOver();
    } catch {
      over = true;
    }
    if (over) return;
    let handle: { cancel(): void } | null = null;
    let alive = true;
    // A short wait, so stepping quickly through moves doesn't start a search per move.
    const t = setTimeout(() => {
      try {
        const engine = getLinesEngine();
        const h = engine.analyze({ fen, depth, multipv }, (s) => {
          if (alive && s.lines.length) setState({ fen, lines: s.lines, depth: s.depth, done: false });
        });
        handle = h;
        h.promise.then(
          (s) => alive && !s.cancelled && s.lines.length && setState({ fen, lines: s.lines, depth: s.depth, done: true }),
          () => undefined,
        );
      } catch {
        /* no engine: the panel shows what it has */
      }
    }, 160);
    return () => {
      alive = false;
      clearTimeout(t);
      handle?.cancel();
    };
  }, [fen, enabled, multipv, depth]);
  return state && state.fen === fen ? state : null;
}
