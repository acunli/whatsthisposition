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

/** The fastest the panel updates while a search deepens, so the numbers can be read. */
const UPDATE_MS = 250;

/**
 * The engine's top lines for `fen`, updating as the search deepens (like Lichess's
 * local analysis). Runs on its own worker; a new position cancels the old search.
 *
 * Only complete sets are reported: mid-search Stockfish sends its lines one at a time,
 * and passing on a set of one or two would make the panel flicker between counts.
 */
export function useLiveLines(fen: string | null, { enabled = true, multipv = 3, depth = 20 }: { enabled?: boolean; multipv?: number; depth?: number } = {}): LiveLines | null {
  const [state, setState] = useState<LiveLines | null>(null);
  useEffect(() => {
    if (!fen || !enabled) return;
    let want = multipv;
    try {
      const c = new Chess(fen);
      if (c.isGameOver()) return;
      want = Math.min(multipv, c.moves().length);
    } catch {
      return;
    }
    let handle: { cancel(): void } | null = null;
    let alive = true;
    let lastAt = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const publish = (lines: EngineLine[], d: number, done: boolean) => {
      if (!alive) return;
      if (trailing) clearTimeout(trailing);
      trailing = null;
      const wait = done ? 0 : lastAt + UPDATE_MS - performance.now();
      if (wait > 0) {
        trailing = setTimeout(() => publish(lines, d, done), wait);
        return;
      }
      lastAt = performance.now();
      setState({ fen, lines, depth: d, done });
    };
    // A short wait, so stepping quickly through moves doesn't start a search per move.
    const t = setTimeout(() => {
      try {
        const engine = getLinesEngine();
        const h = engine.analyze({ fen, depth, multipv }, (s) => {
          if (s.lines.length >= want) publish(s.lines, s.depth, false);
        });
        handle = h;
        h.promise.then(
          (s) => !s.cancelled && s.lines.length && publish(s.lines, s.depth, true),
          () => undefined,
        );
      } catch {
        /* no engine: the panel shows what it has */
      }
    }, 160);
    return () => {
      alive = false;
      clearTimeout(t);
      if (trailing) clearTimeout(trailing);
      handle?.cancel();
    };
  }, [fen, enabled, multipv, depth]);
  return state && state.fen === fen ? state : null;
}
