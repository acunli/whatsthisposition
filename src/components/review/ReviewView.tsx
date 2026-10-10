"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EngineLines } from "../EngineLines";
import { SmoothHeight } from "../SmoothHeight";
import { PlayBoard } from "../PlayBoard";
import { useLiveLines } from "../useLiveLines";
import { EvalBar, EvalChip, sideName } from "../analysis/bits";
import { VariationBar } from "../analysis/VariationBar";
import { placementFromFen } from "@/lib/chess/fen";
import { other, type Color, type Square } from "@/lib/chess/types";
import type { Evaluation } from "@/lib/engine/score";
import { emptyMarks, type Marks } from "@/lib/facts/types";
import { ANNOTATION, CLASS_INFO, CLASS_ORDER, type ClassifiedMove, type MoveClass, type PositionAnalysis } from "@/lib/review/classify";
import { explainOpening, explainReviewMove } from "@/lib/review/explain";
import { placeMoves, positionKey, stepSelection, type SideLine } from "@/lib/review/lines";
import type { GameMove, ParsedGame } from "@/lib/review/pgn";
import { classifyLine, lineChecks, quietMoves, tally, type ClassifyCache } from "@/lib/review/review";
import { buildVariation, fenAtPly, moveAtPly, navigate, type NavAction, type Variation } from "@/lib/variation";
import { ClassIcon } from "./ClassIcon";
import { EvalGraph } from "./EvalGraph";
import { PeekOrientation } from "../peek/Peek";
import { MoveInsight } from "./MoveInsight";
import { OpeningCard } from "./OpeningCard";
import { useLineAnalysis, type LineRequest } from "./useLineAnalysis";
import { useMoveReasoning } from "./useMoveReasoning";
import { REVIEW_DEPTHS, VERIFY_EXTRA, useReview, type FinishedReview } from "./useReview";
import { depthIndex } from "@/lib/review/depths";

interface Props {
  game: ParsedGame;
  orientation: Color;
  onOrientation: (c: Color) => void;
  /** Open the single-position analysis for this FEN. */
  onDeep: (fen: string) => void;
  /** False while the review is kept alive behind another screen (no keyboard handling). */
  active: boolean;
  /** The search depth to start at (a link from the extension carries its own); else the default. */
  depth?: number;
  /** A review the extension already ran: shown at once instead of searching again. */
  finished?: FinishedReview;
}

/** A line being previewed on the board (an engine line, or one from an explanation). */
interface LineView {
  title: string;
  variation: Variation;
  ply: number;
  eval: Evaluation;
  /** Where it starts in the game or a side line, so a move played from it becomes a side line. */
  anchor?: { from: number; prefix: string[] };
}

/** The side line on the board: its id and how many of its moves are played (1…length). */
interface SideAt {
  id: number;
  ply: number;
}

const KEY_CLASSES: MoveClass[] = ["brilliant", "great", "miss", "blunder", "mistake"];
const COLOURED: MoveClass[] = [...KEY_CLASSES, "inaccuracy"];
const TABLE: MoveClass[] = CLASS_ORDER.filter((c) => c !== "forced");

const moveName = (m: { moveNumber: number; color: Color; san: string }) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;
const fenOf = (game: ParsedGame, p: number) => (p > 0 ? game.moves[p - 1].fenAfter : game.startFen);
/** A side line's own label cache, made on first use. */
const cacheFor = (caches: Map<number, ClassifyCache>, id: number): ClassifyCache => {
  let c = caches.get(id);
  if (!c) caches.set(id, (c = new Map()));
  return c;
};

function PlayerRow({ game, color, accuracy, active }: { game: ParsedGame; color: Color; accuracy: number | null | undefined; active: boolean }) {
  const name = color === "w" ? game.white : game.black;
  const elo = color === "w" ? game.whiteElo : game.blackElo;
  return (
    <div className={`rv-player ${active ? "rv-player-on" : ""}`}>
      <span className={`side-dot side-${color}`} aria-hidden />
      <b>{name}</b>
      {elo && <span className="muted mono">{elo}</span>}
      {accuracy != null && <span className="rv-player-acc mono">{accuracy.toFixed(1)}</span>}
    </div>
  );
}

export function ReviewView({ game, orientation, onOrientation, onDeep, active, depth, finished }: Props) {
  const [depthIdx, setDepthIdx] = useState(() => depthIndex(depth));
  const [run, setRun] = useState(0);
  const r = useReview(game, REVIEW_DEPTHS[depthIdx].depth, run, finished);
  const n = game.moves.length;
  const [ply, setPly] = useState(0);
  const [line, setLine] = useState<LineView | null>(null);
  // Side lines: moves played on the board instead of the game's, analysed and labelled like the game.
  const [lines, setLines] = useState<SideLine[]>([]);
  const [side, setSide] = useState<SideAt | null>(null);
  const nextId = useRef(1);
  const [hover, setHover] = useState<Marks | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const moves = r.review.moves;
  const cm: ClassifiedMove | undefined = ply > 0 ? moves[ply - 1] : undefined;
  const gm = ply > 0 ? game.moves[ply - 1] : undefined;
  const depthNow = REVIEW_DEPTHS[depthIdx].depth;

  // Side lines: their positions come from their own engine (the game position they start from is
  // the review's), and their moves are labelled by the same rules as the game's.
  const la = useLineAnalysis(active);
  const sideLine = side ? (lines.find((l) => l.id === side.id) ?? null) : null;
  const positionIn = useCallback(
    (l: SideLine) =>
      (k: number): PositionAnalysis | null => {
        const key = positionKey(k === 0 ? fenOf(game, l.from) : l.moves[k - 1].fenAfter);
        const own = la.positions.get(key) ?? null;
        const fromGame = k === 0 ? r.positions[l.from] : null;
        const pa = fromGame && (!own || fromGame.depth >= own.depth) ? fromGame : (own ?? fromGame);
        const quiet = la.quiet.get(key);
        return pa && quiet ? { ...pa, quiet } : pa;
      },
    [game, la.positions, la.quiet, r.positions],
  );
  // Per line, so a longer line doesn't re-label the moves it already had.
  const lineCaches = useMemo(() => new Map<number, ClassifyCache>(), []);
  const lineLabels = useMemo(() => {
    const out = new Map<number, ClassifiedMove[]>();
    for (const l of lines) out.set(l.id, classifyLine(game, l, positionIn(l), r.book, r.review, cacheFor(lineCaches, l.id)));
    return out;
  }, [lines, lineCaches, game, positionIn, r.book, r.review]);
  // What the side lines need from the engine, as the game gets in its two passes: every position at
  // the review's depth, deeper around tactical labels, and the quiet move behind a sacrifice.
  const lineRequests = useMemo((): LineRequest[] => {
    const out: LineRequest[] = [];
    const order = sideLine ? [sideLine, ...lines.filter((l) => l !== sideLine)] : lines;
    for (const l of order) {
      const fenAt = (k: number) => (k === 0 ? fenOf(game, l.from) : l.moves[k - 1].fenAfter);
      for (let k = 1; k <= l.moves.length; k++) out.push({ key: positionKey(fenAt(k)), fen: fenAt(k), depth: depthNow });
      const checks = lineChecks(game, l, lineLabels.get(l.id) ?? [], positionIn(l), r.review, depthNow + VERIFY_EXTRA);
      for (const k of checks.deeper) out.push({ key: positionKey(fenAt(k)), fen: fenAt(k), depth: depthNow + VERIFY_EXTRA });
      for (const k of checks.quiet) {
        const m = l.moves[k];
        const prev: GameMove | null = k > 0 ? l.moves[k - 1] : (game.moves[l.from - 1] ?? null);
        out.push({ key: positionKey(m.fenBefore), fen: m.fenBefore, depth: depthNow + VERIFY_EXTRA, quiet: quietMoves(m, prev) });
      }
    }
    return out;
  }, [lines, sideLine, game, lineLabels, positionIn, r.review, depthNow]);
  const want = la.want;
  useEffect(() => want(lineRequests), [want, lineRequests]);

  // The move the card, stamp and arrows are about: the side line's, else the game's.
  const sideLabels = sideLine ? (lineLabels.get(sideLine.id) ?? []) : [];
  const sideMove = sideLine && side ? sideLine.moves[side.ply - 1] : undefined;
  const shown: ClassifiedMove | undefined = sideLine && side ? sideLabels[side.ply - 1] : cm;
  const shownPrev = sideLine && side ? (side.ply > 1 ? sideLabels[side.ply - 2] : moves[sideLine.from - 1]) : moves[ply - 2];
  const story = useMemo(() => (shown ? explainReviewMove(shown, shownPrev) : null), [shown, shownPrev]);
  // The deeper explanation waits until the review has finished, so it doesn't slow the engines down.
  const reasoning = useMoveReasoning(shown, active && r.status === "done");

  const go = useCallback(
    (p: number) => {
      const next = Math.max(0, Math.min(n, p));
      setPly(next);
      setSide(null);
      setLine(null);
      setHover(null);
      setAnimKey((k) => k + 1);
    },
    [n],
  );

  const navLine = useCallback((a: NavAction) => {
    setLine((l) => (l ? { ...l, ply: navigate(l.variation, l.ply, a) } : l));
    setAnimKey((k) => k + 1);
  }, []);

  /** Shows move `k` of a side line (0: the game position it starts from). */
  const pick = useCallback(
    (id: number, k: number, all = lines) => {
      const l = all.find((x) => x.id === id);
      if (!l) return;
      if (k <= 0) return go(l.from);
      setPly(l.from);
      setSide({ id, ply: Math.min(k, l.moves.length) });
      setLine(null);
      setHover(null);
      setAnimKey((x) => x + 1);
    },
    [lines, go],
  );

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!side) return go(ply + dir);
      const s = stepSelection(game, lines, { line: side.id, ply: side.ply }, dir);
      if (s.line === null) go(s.ply);
      else pick(s.line, s.ply);
    },
    [side, go, ply, game, lines, pick],
  );

  const removeLine = (id: number) => {
    const l = lines.find((x) => x.id === id);
    setLines((ls) => ls.filter((x) => x.id !== id));
    if (l && side?.id === id) go(l.from);
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (line) {
        if (e.key === "ArrowRight") navLine("next");
        else if (e.key === "ArrowLeft") navLine("prev");
        else if (e.key === "Escape") setLine(null);
        else return;
      } else if (side && sideLine) {
        if (e.key === "ArrowRight") step(1);
        else if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "Escape") go(sideLine.from);
        else if (e.key === "Home") go(0);
        else if (e.key === "End") pick(sideLine.id, sideLine.moves.length);
        else return;
      } else if (e.key === "ArrowRight") go(ply + 1);
      else if (e.key === "ArrowLeft") go(ply - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, line, navLine, go, ply, n, side, sideLine, step, pick]);

  // Keep the selected move visible in the move list without scrolling the page.
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(side ? `[data-side="${side.id}-${side.ply}"]` : `[data-ply="${ply}"]`);
    if (!box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop + 8) box.scrollTop = top - 8;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight - 8) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
  }, [ply, side]);

  // What the board shows: a line being previewed, a side line, or the game position.
  const boardFen = line ? fenAtPly(line.variation, line.ply) : sideMove ? sideMove.fenAfter : gm ? gm.fenAfter : game.startFen;
  const boardMove = line ? moveAtPly(line.variation, line.ply) : (sideMove ?? gm);
  const sidePosition = sideLine && side ? positionIn(sideLine)(side.ply) : null;
  const placement = useMemo(() => placementFromFen(boardFen), [boardFen]);
  // Top engine lines for whatever is on the board. During the review the pool's own lines
  // stand in (no extra engine work); afterwards a dedicated engine searches deeper, live.
  const live = useLiveLines(boardFen, { enabled: active && r.status === "done" });
  const gameLines = line ? [] : sideLine ? (sidePosition?.lines ?? []) : (r.positions[ply]?.lines ?? []);
  // The review's own lines stay up until the live search is at least as deep, so the
  // panel doesn't swap deeper lines for shallower ones (or 2 lines for 1) on every move.
  const useLive = !!live?.lines.length && (live.done || !gameLines.length || live.depth >= (gameLines[0]?.depth ?? 0));
  const shownLines = useLive ? live!.lines : gameLines;
  const linesDepth = useLive ? live!.depth : (gameLines[0]?.depth ?? null);
  const shownEval = line ? (live?.lines[0]?.eval ?? line.eval) : sideLine ? (sidePosition?.eval ?? live?.lines[0]?.eval ?? null) : (r.positions[ply]?.eval ?? null);

  /** Where a previewed line starting at `fen` sits in the game (or the side line on the board). */
  const anchorFor = (fen: string): LineView["anchor"] => {
    const key = positionKey(fen);
    if (sideLine && side)
      for (let k = side.ply; k >= 0; k--)
        if (positionKey(k === 0 ? fenOf(game, sideLine.from) : sideLine.moves[k - 1].fenAfter) === key) return { from: sideLine.from, prefix: sideLine.moves.slice(0, k).map((m) => m.uci) };
    for (let p = ply; p >= 0; p--) if (positionKey(fenOf(game, p)) === key) return { from: p, prefix: [] };
    return undefined;
  };

  /**
   * A move played on the board. The game's move follows the game; a move a side line already has
   * steps into it; anything else starts or extends a side line, which then gets analysed and labelled.
   */
  const userMove = (uci: string) => {
    let res;
    if (line) {
      if (!line.anchor) return;
      const played = line.variation.moves.slice(0, line.ply).map((m) => m.uci);
      res = placeMoves(game, lines, { line: null, ply: line.anchor.from }, [...line.anchor.prefix, ...played, uci], nextId.current);
    } else res = placeMoves(game, lines, side ? { line: side.id, ply: side.ply } : { line: null, ply }, [uci], nextId.current);
    if (!res) return;
    nextId.current = res.nextId;
    if (res.lines !== lines) setLines(res.lines);
    if (res.sel.line === null) go(res.sel.ply);
    else pick(res.sel.line, res.sel.ply, res.lines);
  };

  const marks = useMemo((): Marks => {
    if (hover) return hover;
    const m = emptyMarks();
    if (line) {
      const nx = line.variation.moves[line.ply];
      if (nx) m.arrows.push({ from: nx.from, to: nx.to, tone: "info", thin: true, dashed: true });
      return m;
    }
    if (shown && shown.bestUci && shown.bestUci !== shown.move.uci && !["book", "forced", "best", "brilliant", "great"].includes(shown.cls)) {
      m.arrows.push({ from: shown.bestUci.slice(0, 2) as Square, to: shown.bestUci.slice(2, 4) as Square, tone: "opportunity" });
    }
    if (sideLine && side) {
      const nx = sideLine.moves[side.ply];
      if (nx) m.arrows.push({ from: nx.from, to: nx.to, tone: "info", thin: true, dashed: true });
      return m;
    }
    const next = game.moves[ply];
    if (next && !cm) m.arrows.push({ from: next.from, to: next.to, tone: "info", thin: true, dashed: true });
    return m;
  }, [hover, line, shown, sideLine, side, cm, game.moves, ply]);

  const stamp = !line && shown ? { sq: shown.move.to, node: <ClassIcon cls={shown.cls} size={28} />, key: `${side ? `s${side.id}-${side.ply}` : ply}-${shown.cls}` } : null;

  const counts = useMemo(() => tally(moves), [moves]);
  const keyMoments = useMemo(() => moves.filter((m) => KEY_CLASSES.includes(m.cls)), [moves]);
  const jumpTo = (cls: MoveClass, color: Color) => {
    const list = moves.filter((m) => m.cls === cls && m.move.color === color).map((m) => m.move.ply);
    if (!list.length) return;
    go(list.find((p) => p > ply) ?? list[0]);
  };

  const playLine = (title: string, fen: string, pv: string[], e: Evaluation) => {
    const v = buildVariation(fen, pv, 16);
    if (!v.moves.length) return;
    setLine({ title, variation: v, ply: 1, eval: e, anchor: anchorFor(fen) });
    setHover(null);
    setAnimKey((k) => k + 1);
  };

  // Rows of the move list: [move number, white ply index, black ply index].
  const rows = useMemo(() => {
    const out: { num: number; w?: number; b?: number }[] = [];
    game.moves.forEach((m, i) => {
      if (m.color === "w" || !out.length) out.push({ num: m.moveNumber });
      out[out.length - 1][m.color] = i + 1;
    });
    return out;
  }, [game.moves]);

  // Side lines sit under the row of the game move they replace (or after the last row).
  const linesAt = useMemo(() => {
    const out = new Map<number, SideLine[]>();
    for (const l of lines) {
      const row = rows.findIndex((x) => x.w === l.from + 1 || x.b === l.from + 1);
      const at = row < 0 ? rows.length - 1 : row;
      out.set(at, [...(out.get(at) ?? []), l]);
    }
    return out;
  }, [lines, rows]);

  const sideRow = (l: SideLine) => {
    const labels = lineLabels.get(l.id) ?? [];
    const instead = game.moves[l.from];
    return (
      <div key={l.id} className="rv-side" role="group" aria-label={instead ? `Your line instead of ${moveName(instead)}` : "Your line after the game"}>
        <span className="rv-side-moves">
          {l.moves.map((m, k) => {
            const c = labels[k];
            const on = side?.id === l.id && side.ply === k + 1;
            const num = m.color === "w" ? `${m.moveNumber}.` : k === 0 ? `${m.moveNumber}…` : "";
            return (
              <button
                key={k}
                data-side={`${l.id}-${k + 1}`}
                className={`rv-side-move ${on ? "rv-cell-on" : ""} ${c && COLOURED.includes(c.cls) ? "rv-cell-mark" : ""}`}
                style={c ? { ["--cls-c" as string]: CLASS_INFO[c.cls].color } : undefined}
                onClick={() => pick(l.id, k + 1)}
                aria-label={`${moveName(m)}, ${c ? CLASS_INFO[c.cls].label : "being analysed"}`}
              >
                {num && <span className="rv-side-num mono">{num}</span>}
                {c ? <ClassIcon cls={c.cls} size={13} /> : <span className="rv-wait-dot" aria-hidden />}
                <span className="rv-san">
                  {m.san}
                  {c && ANNOTATION[c.cls] && c.cls !== "miss" ? ANNOTATION[c.cls] : ""}
                </span>
              </button>
            );
          })}
        </span>
        <button className="rv-side-x" onClick={() => removeLine(l.id)} aria-label="Remove this line" title="Remove this line">
          ×
        </button>
      </div>
    );
  };

  const turnAt = (boardFen.split(" ")[1] as Color) ?? "w";
  const opening = r.review.opening?.name ?? game.opening;
  // Once the move after the book is classified (or the whole game is), the opening's story is complete.
  const openingStory = moves.length > r.review.bookUntil + 1 || r.status === "done" ? explainOpening(r.review) : null;
  const running = r.status === "running" || r.status === "loading" || r.status === "verifying";
  const verifying = r.status === "verifying";
  const top = other(orientation);

  const cell = (p?: number) => {
    if (!p) return <span className="rv-cell rv-cell-empty">…</span>;
    const m = game.moves[p - 1];
    const c = moves[p - 1];
    return (
      <button
        data-ply={p}
        className={`rv-cell ${ply === p && !side ? "rv-cell-on" : ""} ${!c ? "rv-cell-wait" : COLOURED.includes(c.cls) ? "rv-cell-mark" : ""}`}
        style={c ? { ["--cls-c" as string]: CLASS_INFO[c.cls].color } : undefined}
        onClick={() => go(p)}
        aria-label={c ? `${moveName(m)}, ${CLASS_INFO[c.cls].label}` : moveName(m)}
      >
        {c ? <ClassIcon cls={c.cls} size={15} /> : <span className="rv-wait-dot" aria-hidden />}
        <span className="rv-san">
          {m.san}
          {c && ANNOTATION[c.cls] && c.cls !== "miss" ? ANNOTATION[c.cls] : ""}
        </span>
      </button>
    );
  };

  const view = (
    <main className="review">
      <section className="board-col rv-board" aria-label="Board">
        <PlayerRow game={game} color={top} accuracy={r.accuracy?.[top]} active={turnAt === top} />
        <div className="board-wrap">
          <EvalBar e={shownEval} orientation={orientation} />
          <PlayBoard
            fen={boardFen}
            onMove={userMove}
            placement={placement}
            orientation={orientation}
            marks={marks}
            revealKey={`${ply}-${animKey}`}
            lastMove={boardMove ? { from: boardMove.from, to: boardMove.to } : null}
            animate={boardMove ? { from: boardMove.from, to: boardMove.to, key: `${animKey}` } : null}
            stamp={stamp}
            label={sideMove ? `Your line, after ${moveName(sideMove)}` : `Game position after ${gm ? moveName(gm) : "the start"}`}
            dimPieces={!!hover}
          />
        </div>
        <PlayerRow game={game} color={orientation} accuracy={r.accuracy?.[orientation]} active={turnAt === orientation} />

        {line ? (
          <VariationBar variation={line.variation} ply={line.ply} onNav={navLine} evals={[]} title={line.title} onClose={() => setLine(null)} />
        ) : sideLine && side ? (
          <div className="rv-nav rv-nav-side" role="group" aria-label="Move through your line">
            <button className="step-btn" onClick={() => go(sideLine.from)} aria-label="Back to the game">
              ⏮
            </button>
            <button className="step-btn" onClick={() => step(-1)} aria-label="Previous move">
              ◀
            </button>
            <button className="step-btn step-main" onClick={() => step(1)} disabled={side.ply >= sideLine.moves.length} aria-label="Next move">
              ▶
            </button>
            <button className="step-btn" onClick={() => pick(sideLine.id, sideLine.moves.length)} disabled={side.ply >= sideLine.moves.length} aria-label="End of your line">
              ⏭
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => go(sideLine.from)}>
              Back to the game
            </button>
          </div>
        ) : (
          <div className="rv-nav" role="group" aria-label="Move through the game">
            <button className="step-btn" onClick={() => go(0)} disabled={ply === 0} aria-label="Start of game">
              ⏮
            </button>
            <button className="step-btn" onClick={() => go(ply - 1)} disabled={ply === 0} aria-label="Previous move">
              ◀
            </button>
            <button className="step-btn step-main" onClick={() => go(ply + 1)} disabled={ply === n} aria-label="Next move">
              ▶
            </button>
            <button className="step-btn" onClick={() => go(n)} disabled={ply === n} aria-label="End of game">
              ⏭
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => onOrientation(other(orientation))}>
              Flip ⇅
            </button>
          </div>
        )}
        <EvalGraph positions={r.positions} moves={moves} ply={ply} onPly={go} />
      </section>

      <aside className="desk rv-desk" aria-label="Game review">
        <header className="rv-head">
          <div className="rv-head-top">
            <div>
              <div className="eyebrow">Game review{game.headers.Date && !game.headers.Date.startsWith("?") ? ` · ${game.headers.Date.replace(/\.\?\?/g, "")}` : ""}</div>
              <h2 className="rv-title">
                {game.white} <span className="muted">vs</span> {game.black}
              </h2>
              <p className="rv-sub">
                <span className="mono">{game.result}</span>
                {opening && <> · {opening}</>}
              </p>
            </div>
            <div className="rv-acc" aria-label="Accuracy">
              {(["w", "b"] as Color[]).map((c) => (
                <div key={c} className={`rv-acc-card rv-acc-${c}`} title="Average accuracy per move, on Chess.com's scale (fitted on real Chess.com reviews; usually within about 3–4 points)">
                  <span className="eyebrow">{sideName(c)}</span>
                  <b className="mono">{r.accuracy?.[c] != null ? r.accuracy[c]!.toFixed(1) : "–"}</b>
                  <span className="small muted">accuracy</span>
                </div>
              ))}
            </div>
          </div>
          {running && (
            <div className="rv-progress" aria-live="polite">
              <div className={`rv-progress-bar ${verifying ? "rv-progress-verify" : ""}`}>
                <span style={{ width: `${Math.round((verifying ? r.verify.done / Math.max(1, r.verify.total) : r.progress) * 100)}%` }} />
              </div>
              <span className="small muted">
                {verifying
                  ? `Double-checking ${r.verify.done}/${r.verify.total} critical positions at depth ${REVIEW_DEPTHS[depthIdx].depth + VERIFY_EXTRA}, so sacrifices and blunders aren't misjudged`
                  : `Stockfish is reviewing: ${r.analysed}/${r.total} positions${r.engines > 1 ? ` · ${r.engines} engines in parallel` : ""} · depth ${REVIEW_DEPTHS[depthIdx].depth}`}
              </span>
            </div>
          )}
          {r.status === "error" && (
            <div className="notice notice-error" role="alert">
              <p>
                <b>The review stopped.</b> {r.error}
              </p>
              <button className="btn btn-sm" onClick={() => setRun((x) => x + 1)}>
                Try again
              </button>
            </div>
          )}
          <div className="rv-depth">
            <span className="small muted">Depth</span>
            {REVIEW_DEPTHS.map((d, i) => (
              <button key={d.label} className={`chip chip-sm ${i === depthIdx ? "chip-on" : ""}`} onClick={() => setDepthIdx(i)} title={d.note} aria-pressed={i === depthIdx}>
                {d.label} · {d.depth}
              </button>
            ))}
          </div>
        </header>

        <EngineLines
          fen={boardFen}
          lines={shownLines}
          depth={linesDepth}
          searching={!!live && !live.done}
          onPlay={(pv, upto) => {
            const v = buildVariation(boardFen, pv, 16);
            if (!v.moves.length) return;
            setLine({ title: "Engine line", variation: v, ply: Math.min(upto, v.moves.length), eval: shownLines.find((l) => l.pv === pv)?.eval ?? { kind: "cp", cp: 0 }, anchor: anchorFor(boardFen) });
            setHover(null);
            setAnimKey((k) => k + 1);
          }}
          onHover={setHover}
        />

        <section className={`rv-card ${cm ? `rv-card-${cm.cls}` : ""}`} aria-live="polite" style={cm ? { ["--cls" as string]: CLASS_INFO[cm.cls].color } : undefined}>
          <SmoothHeight className="rv-card-body" keepHeight={reasoning?.status === "pending"}>
            {ply === 0 && !side ? (
              <>
                <p className="eyebrow">Start</p>
                <p className="rv-headline">
                  {running
                    ? "Moves get their labels as the engine finishes them; sharp moments are then double-checked deeper. Step through with ← → or pick a move."
                    : "Step through with ← →, click the graph, or jump to a key moment below."}
                </p>
              </>
            ) : !shown || !story ? (
              <>
                <p className="eyebrow">
                  {sideMove ? `${moveName(sideMove)} · your line` : gm ? moveName(gm) : ""}
                </p>
                <p className="rv-headline muted">{sideMove ? "Stockfish is analysing your move…" : "The engine hasn\u2019t reached this move yet…"}</p>
              </>
            ) : (
              <>
                <div className="rv-card-head">
                  <ClassIcon cls={shown.cls} size={30} />
                  <div>
                    <span className="rv-cls">
                      {CLASS_INFO[shown.cls].label}
                      {sideMove && <span className="rv-side-tag">your line</span>}
                    </span>
                    <h3 className="rv-move">{moveName(shown.move)}</h3>
                  </div>
                  <EvalChip e={shown.evalAfter} />
                </div>
                <MoveInsight cm={shown} story={story} entry={reasoning} onHover={setHover} onPlay={playLine} />
              </>
            )}
            <div className="rv-deep">
              <button className="btn btn-primary btn-sm" onClick={() => onDeep(boardFen)}>
                Deep-analyse this position
              </button>
              {(sideMove ?? gm) && !line && (
                <button className="linkish" onClick={() => onDeep((sideMove ?? gm)!.fenBefore)}>
                  or the moment before {moveName((sideMove ?? gm)!)}
                </button>
              )}
            </div>
          </SmoothHeight>
        </section>

        {openingStory && <OpeningCard story={openingStory} masters={r.review.masters} onGo={go} onHover={setHover} />}

        {keyMoments.length > 0 && (
          <section className="rv-moments" aria-label="Key moments">
            <span className="eyebrow">Key moments</span>
            <div className="rv-moment-row">
              {keyMoments.map((m) => (
                <button key={m.move.ply} className={`rv-moment ${ply === m.move.ply ? "rv-moment-on" : ""}`} onClick={() => go(m.move.ply)} title={CLASS_INFO[m.cls].label}>
                  <ClassIcon cls={m.cls} size={14} />
                  {moveName(m.move)}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="rv-table" aria-label="Move labels per player">
          <div className="rv-table-head">
            <span className="mono">{game.white}</span>
            <span />
            <span className="mono">{game.black}</span>
          </div>
          {TABLE.map((c) => {
            const t = counts[c] ?? { w: 0, b: 0 };
            return (
              <div key={c} className="rv-table-row" style={{ ["--cls" as string]: CLASS_INFO[c].color }}>
                <button className="rv-count" disabled={!t.w} onClick={() => jumpTo(c, "w")} aria-label={`${t.w} ${CLASS_INFO[c].label} by White`}>
                  {t.w}
                </button>
                <span className="rv-table-label">
                  <ClassIcon cls={c} size={16} />
                  {CLASS_INFO[c].label}
                </span>
                <button className="rv-count" disabled={!t.b} onClick={() => jumpTo(c, "b")} aria-label={`${t.b} ${CLASS_INFO[c].label} by Black`}>
                  {t.b}
                </button>
              </div>
            );
          })}
        </section>

        <section className="rv-moves" aria-label="Moves" ref={listRef}>
          <button data-ply={0} className={`rv-start ${ply === 0 && !side ? "rv-cell-on" : ""}`} onClick={() => go(0)}>
            Start position
          </button>
          {rows.map((row, i) => (
            <div key={row.num} className="rv-row-group">
              <div className="rv-row">
                <span className="rv-num mono">{row.num}.</span>
                {cell(row.w)}
                {cell(row.b)}
              </div>
              {linesAt.get(i)?.map(sideRow)}
            </div>
          ))}
          {!rows.length && lines.map(sideRow)}
          <p className="rv-result mono">{game.result}</p>
        </section>
      </aside>
    </main>
  );
  // Line previews (hover a move in an explanation) use the board's orientation.
  return <PeekOrientation.Provider value={orientation}>{view}</PeekOrientation.Provider>;
}
