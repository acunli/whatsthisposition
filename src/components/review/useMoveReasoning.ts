"use client";

import { useEffect, useRef, useState } from "react";
import type { Searcher } from "@/lib/deep/deep";
import { getBrowserEngine } from "@/lib/engine/browser";
import { findThreat, reasonMove } from "@/lib/reason/reason";
import type { MoveReasoning } from "@/lib/reason/types";
import type { ClassifiedMove } from "@/lib/review/classify";

export interface ReviewReasoning {
  played: MoveReasoning | null;
  /** The engine's move, explained, when the game move wasn't it. */
  better: MoveReasoning | null;
}

export type ReasoningEntry = { status: "pending" } | { status: "done"; data: ReviewReasoning } | { status: "failed" };

const DEPTH = 14;

/**
 * Explains the selected review move with targeted engine probes (its threat, the
 * opponent's threat, the refutation) on the page's analysis engine. Results are
 * cached per move; switching moves stops a stale explanation between probes.
 */
export function useMoveReasoning(cm: ClassifiedMove | undefined, enabled: boolean): ReasoningEntry | null {
  const [entries, setEntries] = useState<Record<string, ReasoningEntry>>({});
  const started = useRef(new Set<string>());
  const current = useRef<string | null>(null);
  const key = cm && cm.cls !== "book" && cm.cls !== "forced" ? `${cm.move.ply}:${cm.move.uci}:${cm.bestUci}:${cm.replyLine?.depth ?? 0}` : null;

  useEffect(() => {
    current.current = key;
    if (!key || !cm || !enabled || started.current.has(key)) return;
    started.current.add(key);
    const set = (e: ReasoningEntry) => setEntries((x) => ({ ...x, [key]: e }));
    const stale = () => current.current !== key;
    queueMicrotask(async () => {
      set({ status: "pending" });
      try {
        const engine = getBrowserEngine();
        const search: Searcher = (r) =>
          stale()
            ? Promise.reject(new Error("stale"))
            : engine.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves }).promise.then((s) => {
                if (s.cancelled) throw new Error("cancelled");
                return s.lines;
              });
        const m = cm.move;
        const threatBefore = await findThreat(m.fenBefore, search, DEPTH - 2, cm.bestLine?.eval ?? cm.evalBefore);
        const played = await reasonMove({
          fen: m.fenBefore,
          uci: m.uci,
          line: cm.replyLine ? { pv: [m.uci, ...cm.replyLine.pv], eval: cm.evalAfter, depth: cm.replyLine.depth } : undefined,
          best: cm.bestLine ?? undefined,
          second: cm.secondLine ?? undefined,
          search,
          depth: DEPTH,
          threatBefore,
        });
        let better: MoveReasoning | null = null;
        if (cm.bestUci && cm.bestUci !== m.uci && cm.bestLine) {
          better = await reasonMove({ fen: m.fenBefore, uci: cm.bestUci, line: cm.bestLine, best: cm.bestLine, second: cm.secondLine ?? undefined, search, depth: DEPTH, threatBefore });
        }
        set({ status: "done", data: { played, better } });
      } catch {
        // A stale request is simply dropped; it will restart if the move is selected again.
        started.current.delete(key);
        if (!stale()) set({ status: "failed" });
      }
    });
  }, [key, cm, enabled]);

  return key ? (entries[key] ?? null) : null;
}
