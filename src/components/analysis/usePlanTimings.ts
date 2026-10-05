"use client";

import { useEffect, useRef, useState } from "react";
import type { Searcher } from "@/lib/deep/deep";
import { getBrowserEngine } from "@/lib/engine/browser";
import type { PlanCard } from "@/lib/plans/cards";
import { planTiming, type PlanTiming } from "@/lib/plans/timing";
import { findThreat, type LineInput, type ThreatInfo } from "@/lib/reason/reason";

export type TimingEntry = PlanTiming | "pending";

const DEPTH = 13;

/** Engine-checks the side to move's plans once the main search has settled (one search per plan). */
export function usePlanTimings(fen: string, cards: PlanCard[], best: LineInput | undefined, enabled: boolean): { timings: Record<string, TimingEntry>; threat: ThreatInfo | null } {
  const [timings, setTimings] = useState<Record<string, TimingEntry>>({});
  const [threat, setThreat] = useState<{ fen: string; t: ThreatInfo | null } | null>(null);
  const started = useRef(new Set<string>());
  const bestKey = best ? `${best.pv[0]}:${best.depth}` : "";

  useEffect(() => {
    if (!enabled || !best) return;
    const begun = started.current;
    const todo = cards.filter((c) => !begun.has(`${fen}|${c.id}|${bestKey}`));
    if (!todo.length) return;
    const keyOf = (c: PlanCard) => `${fen}|${c.id}|${bestKey}`;
    for (const c of todo) begun.add(keyOf(c));
    const finished = new Set<string>();
    let alive = true;
    queueMicrotask(async () => {
      setTimings((t) => ({ ...t, ...Object.fromEntries(todo.map((c) => [c.id, "pending" as const])) }));
      const engine = getBrowserEngine();
      const search: Searcher = (r) =>
        engine.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves }).promise.then((s) => {
          if (s.cancelled) throw new Error("cancelled");
          return s.lines;
        });
      const threat = await findThreat(fen, search, DEPTH - 2, best.eval).catch(() => null);
      if (alive) setThreat({ fen, t: threat });
      for (const c of todo) {
        if (!alive) return;
        try {
          const t = await planTiming(fen, c, best, search, DEPTH, threat);
          if (alive) {
            finished.add(keyOf(c));
            setTimings((x) => ({ ...x, [c.id]: t }));
          }
        } catch {
          if (alive) setTimings((x) => ({ ...x, [c.id]: { verdict: "later", text: "The engine check didn't finish.", marks: { squares: [], arrows: [], badges: [] } } }));
        }
      }
    });
    return () => {
      alive = false;
      // Unfinished checks start again next time the tab is open.
      for (const c of todo) if (!finished.has(keyOf(c))) begun.delete(keyOf(c));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bestKey stands in for `best`
  }, [fen, cards, bestKey, enabled]);

  return { timings, threat: threat?.fen === fen ? threat.t : null };
}
