"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { AnalysisSnapshot, EngineLine, SearchHandle } from "@/lib/engine/client";
import { getBrowserEngine, resetBrowserEngine } from "@/lib/engine/browser";
import type { Evaluation } from "@/lib/engine/score";
import { analyzeMoveDeep, type DeepMove, type LineInput, type Searcher } from "@/lib/deep/deep";

export type DeepEntry = { status: "pending"; step: string } | { status: "done"; data: DeepMove } | { status: "failed" };

export interface SearchSettings {
  label: string;
  depth?: number;
  movetimeMs?: number;
}

export const SEARCH_PRESETS: SearchSettings[] = [
  { label: "Quick · depth 12", depth: 12 },
  { label: "Standard · depth 16", depth: 16 },
  { label: "Deep · depth 20", depth: 20 },
  { label: "Deeper · depth 24", depth: 24 },
  { label: "Think 5 s", movetimeMs: 5000 },
  { label: "Think 15 s", movetimeMs: 15000 },
];

export const PLY_DEPTH = 12;

export interface PlyEval {
  eval: Evaluation;
  depth: number;
  best: string | null;
  pv: string[];
}

export type MainStatus = "starting" | "running" | "done" | "stopped" | "error";

export interface Threat {
  uci: string;
  pv: string[];
  eval: Evaluation;
  depth: number;
}

function nullMoveFen(fen: string): string | null {
  const parts = fen.split(" ");
  parts[1] = parts[1] === "w" ? "b" : "w";
  parts[3] = "-";
  const f = parts.join(" ");
  try {
    const c = new Chess(fen);
    if (c.inCheck()) return null;
    new Chess(f);
    return f;
  } catch {
    return null;
  }
}

export function useAnalysis(fen: string, settings: SearchSettings, multipv: number) {
  const [status, setStatus] = useState<MainStatus>("starting");
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [threat, setThreat] = useState<Threat | null>(null);
  const [plyVersion, setPlyVersion] = useState(0);
  const [wanted, setWanted] = useState<string[]>([]);
  const [busyMove, setBusyMove] = useState(false);
  const cache = useRef(new Map<string, PlyEval>());
  const deepCache = useRef(new Map<string, DeepEntry>());
  const [deepVersion, setDeepVersion] = useState(0);
  const mainHandle = useRef<SearchHandle | null>(null);
  const bgHandle = useRef<SearchHandle | null>(null);
  const bgToken = useRef(0);

  // Main multi-line search
  useEffect(() => {
    let engine;
    try {
      engine = runId > 0 && error ? resetBrowserEngine() : getBrowserEngine();
    } catch (e) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reporting a synchronous startup failure
      setError(e instanceof Error ? e.message : "The engine couldn't start.");
      setStatus("error");
      return;
    }
    engine.cancelAll();
    deepCache.current.clear();
    setError(null);
    setStatus("starting");
    setSnapshot(null);
    setThreat(null);
    let alive = true;
    engine.ready.then(() => alive && setStatus((s) => (s === "starting" ? "running" : s)), () => undefined);
    const handle = engine.analyze(
      { fen, multipv, depth: settings.depth, movetimeMs: settings.movetimeMs },
      (s) => {
        if (!alive) return;
        setStatus("running");
        setSnapshot(s);
      },
    );
    mainHandle.current = handle;
    handle.promise.then(
      async (s) => {
        if (!alive) return;
        setSnapshot(s);
        setStatus(s.cancelled ? "stopped" : "done");
        const top = s.lines[0];
        if (top) cache.current.set(fen, { eval: top.eval, depth: top.depth, best: top.pv[0] ?? null, pv: top.pv });
        setPlyVersion((v) => v + 1);
        // What would the opponent do if it were their move? (null-move probe)
        const nf = nullMoveFen(fen);
        if (!nf || s.cancelled) return;
        const t = engine.analyze({ fen: nf, multipv: 1, depth: PLY_DEPTH });
        bgHandle.current = t;
        const res = await t.promise.catch(() => null);
        if (!alive || !res || res.cancelled || !res.lines[0]?.pv.length) return;
        setThreat({ uci: res.lines[0].pv[0], pv: res.lines[0].pv, eval: res.lines[0].eval, depth: res.lines[0].depth });
        setPlyVersion((v) => v + 1);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "The engine stopped unexpectedly.");
        setStatus("error");
      },
    );
    return () => {
      alive = false;
      handle.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `error` only matters when retrying
  }, [fen, settings, multipv, runId]);

  // Background quick evaluations for positions along the selected line
  useEffect(() => {
    if (status !== "done" && status !== "stopped") return;
    const token = ++bgToken.current;
    const todo = wanted.filter((f) => !cache.current.has(f));
    if (!todo.length) return;
    let engine;
    try {
      engine = getBrowserEngine();
    } catch {
      return;
    }
    (async () => {
      for (const f of todo) {
        if (token !== bgToken.current) return;
        if (cache.current.has(f)) continue;
        const h = engine.analyze({ fen: f, multipv: 1, depth: PLY_DEPTH });
        bgHandle.current = h;
        const res = await h.promise.catch(() => null);
        if (token !== bgToken.current || !res || res.cancelled) return;
        const top = res.lines[0];
        if (top) cache.current.set(f, { eval: top.eval, depth: top.depth, best: top.pv[0] ?? null, pv: top.pv });
        setPlyVersion((v) => v + 1);
      }
    })();
    const tokens = bgToken;
    const handles = bgHandle;
    return () => {
      tokens.current++;
      handles.current?.cancel();
    };
  }, [wanted, status, busyMove]);

  const cancel = useCallback(() => mainHandle.current?.cancel(), []);
  const rerun = useCallback(() => setRunId((r) => r + 1), []);

  /** Engine line for one specific move from the root, for "why not this move?". */
  const analyzeMove = useCallback(
    async (uci: string): Promise<EngineLine | null> => {
      let engine;
      try {
        engine = getBrowserEngine();
      } catch {
        return null;
      }
      bgToken.current++;
      bgHandle.current?.cancel();
      setBusyMove(true);
      try {
        const depth = Math.min(settings.depth ?? 16, 18);
        const res = await engine.analyze({ fen, multipv: 1, depth, searchmoves: [uci] }).promise;
        return res.lines[0] ?? null;
      } catch {
        return null;
      } finally {
        setBusyMove(false);
      }
    },
    [fen, settings],
  );

  const plyEval = useCallback((f: string) => cache.current.get(f) ?? null, []);

  /**
   * Deep understanding of one move: extra searches for "what if they take", the threat
   * and the line's key moments. Side searches run at depth 16–20 (shallower searches
   * misjudge sacrifices).
   */
  const requestDeep = useCallback(
    (line: LineInput, opts: { isBest: boolean; alternatives: LineInput[]; bestLine?: LineInput }) => {
      const key = line.pv[0];
      if (!key || deepCache.current.has(key)) return;
      let engine;
      try {
        engine = getBrowserEngine();
      } catch {
        return;
      }
      const set = (e: DeepEntry) => {
        deepCache.current.set(key, e);
        setDeepVersion((v) => v + 1);
      };
      set({ status: "pending", step: "Reading the engine's line" });
      const depth = Math.max(16, Math.min(20, (settings.depth ?? 18) - 1));
      const search: Searcher = (r) =>
        engine.analyze({ fen: r.fen, depth: r.depth, multipv: r.multipv ?? 1, searchmoves: r.searchmoves }).promise.then((snap) => {
          if (snap.cancelled) throw new Error("cancelled");
          return snap.lines;
        });
      analyzeMoveDeep(fen, line, search, { ...opts, depth, onProgress: (step) => set({ status: "pending", step }) }).then(
        (d) => set(d ? { status: "done", data: d } : { status: "failed" }),
        () => set({ status: "failed" }),
      );
    },
    [fen, settings],
  );
  const deepFor = useCallback((uci: string | undefined) => (uci ? (deepCache.current.get(uci) ?? null) : null), []);

  return {
    status,
    snapshot,
    error,
    threat,
    cancel,
    rerun,
    analyzeMove,
    busyMove,
    plyEval,
    plyVersion,
    requestDeep,
    deepFor,
    deepVersion,
    requestPlyEvals: setWanted,
  };
}
