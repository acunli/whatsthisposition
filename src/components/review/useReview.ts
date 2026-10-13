"use client";

import { useEffect, useMemo, useState } from "react";
import { createEnginePool } from "@/lib/engine/pool";
import { gameAccuracy } from "@/lib/review/accuracy";
import { loadBook, type OpeningBook } from "@/lib/review/book";
import type { PositionAnalysis } from "@/lib/review/classify";
import type { ParsedGame } from "@/lib/review/pgn";
import { classifyGame, runReview, type ClassifyCache } from "@/lib/review/review";

export { DEFAULT_REVIEW_DEPTH, REVIEW_DEPTHS, VERIFY_EXTRA } from "@/lib/review/depths";
import { VERIFY_EXTRA } from "@/lib/review/depths";

export type ReviewStatus = "loading" | "running" | "verifying" | "done" | "error";


/**
 * Runs a full-game review in the browser: a pool of Stockfish workers analyses
 * every position, moves are classified as soon as both sides of them are known,
 * and then the positions behind tactical labels are re-searched deeper.
 */
/** A review already done elsewhere (the browser extension): used as is, no engine needed. */
export interface FinishedReview {
  depth: number;
  positions: (PositionAnalysis | null)[];
}

export function useReview(game: ParsedGame, depth: number, run = 0, finished?: FinishedReview) {
  // A finished review counts only for the depth it was searched at, before any re-run.
  const ready = finished && finished.depth === depth && run === 0 && finished.positions.length === game.moves.length + 1 ? finished.positions : null;
  const [positions, setPositions] = useState<(PositionAnalysis | null)[]>(() => ready ?? Array(game.moves.length + 1).fill(null));
  const [book, setBook] = useState<OpeningBook | null>(null);
  const [status, setStatus] = useState<ReviewStatus>(ready ? "done" : "loading");
  const [error, setError] = useState<string | null>(null);
  const [engines, setEngines] = useState(0);
  const [verify, setVerify] = useState({ done: 0, total: 0 });
  // Both passes as one estimated share of the work (runReview), never going backwards when a new
  // sharp moment turns up.
  const [share, setShare] = useState(0);
  // Classified prefix of this run; a new game, depth or book means classifying from scratch.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the deps exist to reset the cache
  const cache = useMemo((): ClassifyCache => new Map(), [game, depth, run, book]);

  useEffect(() => {
    let alive = true;
    loadBook().then(
      (b) => alive && setBook(b),
      () => undefined, // no book: moves are still classified, just never as "Book"
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    let pool: ReturnType<typeof createEnginePool> | null = null;
    // Updates are batched per frame so a fast pool doesn't re-render per position.
    let pending: [number, PositionAnalysis][] = [];
    let frame = 0;
    const flush = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      const batch = pending;
      pending = [];
      if (batch.length)
        setPositions((cur) => {
          const next = cur.slice();
          for (const [i, pa] of batch) next[i] = pa;
          return next;
        });
    };
    const push = (i: number, pa: PositionAnalysis) => {
      pending.push([i, pa]);
      if (!frame) frame = requestAnimationFrame(flush);
    };

    const work = async () => {
      if (ready) {
        setPositions(ready);
        setStatus("done");
        return;
      }
      setPositions(Array(game.moves.length + 1).fill(null));
      setStatus("running");
      setError(null);
      setVerify({ done: 0, total: 0 });
      setShare(0);
      pool = createEnginePool();
      setEngines(pool.size);
      // One queue for both passes: the deeper checks start as soon as an engine is free and a
      // sharp move is known, instead of waiting for the slowest first-pass search to finish.
      await runReview(game, pool.searchers, {
        depth,
        verifyDepth: depth + VERIFY_EXTRA,
        book: loadBook().catch(() => null),
        signal,
        onPosition: push,
        onProgress: (p) => {
          setVerify({ done: p.verified, total: p.toVerify });
          setShare((s) => Math.max(s, p.share));
          if (p.analysed >= p.total && p.verified < p.toVerify) setStatus("verifying");
        },
      });
      if (signal.cancelled) return;
      flush();
      setStatus("done");
    };

    queueMicrotask(() => {
      if (signal.cancelled) return;
      work().then(
        () => pool?.dispose(),
        (e) => {
          pool?.dispose();
          if (signal.cancelled) return;
          setStatus("error");
          setError(e instanceof Error ? e.message : "The engine stopped.");
        },
      );
    });
    return () => {
      signal.cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      pool?.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ready` only matters for the first run
  }, [game, depth, run]);

  const review = useMemo(() => classifyGame(game, positions, book, cache), [game, positions, book, cache]);
  const accuracy = useMemo(() => (status === "done" ? gameAccuracy(review.moves) : null), [status, review]);
  const analysed = positions.filter(Boolean).length;

  return { positions, review, book, accuracy, status, error, engines, verify, progress: status === "done" ? 1 : share, analysed, total: positions.length };
}
