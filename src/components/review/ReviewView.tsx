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
import { ANNOTATION, CLASS_INFO, CLASS_ORDER, type ClassifiedMove, type MoveClass } from "@/lib/review/classify";
import { explainOpening, explainReviewMove } from "@/lib/review/explain";
import type { ParsedGame } from "@/lib/review/pgn";
import { tally } from "@/lib/review/review";
import { buildVariation, fenAtPly, moveAtPly, navigate, type NavAction, type Variation } from "@/lib/variation";
import { ClassIcon } from "./ClassIcon";
import { EvalGraph } from "./EvalGraph";
import { PeekOrientation } from "../peek/Peek";
import { MoveInsight } from "./MoveInsight";
import { OpeningCard } from "./OpeningCard";
import { useMoveReasoning } from "./useMoveReasoning";
import { REVIEW_DEPTHS, VERIFY_EXTRA, useReview } from "./useReview";

interface Props {
  game: ParsedGame;
  orientation: Color;
  onOrientation: (c: Color) => void;
  /** Open the single-position analysis for this FEN. */
  onDeep: (fen: string) => void;
  /** False while the review is kept alive behind another screen (no keyboard handling). */
  active: boolean;
}

interface LineView {
  title: string;
  variation: Variation;
  ply: number;
  eval: Evaluation;
  /** Moves the user played on the board (its eval comes from the live engine lines). */
  user?: boolean;
}

const KEY_CLASSES: MoveClass[] = ["brilliant", "great", "miss", "blunder", "mistake"];
const COLOURED: MoveClass[] = [...KEY_CLASSES, "inaccuracy"];
const TABLE: MoveClass[] = CLASS_ORDER.filter((c) => c !== "forced");

const moveName = (m: { moveNumber: number; color: Color; san: string }) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;

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

export function ReviewView({ game, orientation, onOrientation, onDeep, active }: Props) {
  const [depthIdx, setDepthIdx] = useState(1);
  const [run, setRun] = useState(0);
  const r = useReview(game, REVIEW_DEPTHS[depthIdx].depth, run);
  const n = game.moves.length;
  const [ply, setPly] = useState(0);
  const [line, setLine] = useState<LineView | null>(null);
  const [hover, setHover] = useState<Marks | null>(null);
  const [animKey, setAnimKey] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const moves = r.review.moves;
  const cm: ClassifiedMove | undefined = ply > 0 ? moves[ply - 1] : undefined;
  const gm = ply > 0 ? game.moves[ply - 1] : undefined;
  const story = useMemo(() => (cm ? explainReviewMove(cm, moves[ply - 2]) : null), [cm, moves, ply]);
  // The deeper explanation waits until the review has finished, so it doesn't slow the engines down.
  const reasoning = useMoveReasoning(cm, active && r.status === "done");

  const go = useCallback(
    (p: number) => {
      const next = Math.max(0, Math.min(n, p));
      setPly(next);
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
      } else if (e.key === "ArrowRight") go(ply + 1);
      else if (e.key === "ArrowLeft") go(ply - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, line, navLine, go, ply, n]);

  // Keep the selected move visible in the move list without scrolling the page.
  useEffect(() => {
    const box = listRef.current;
    const el = box?.querySelector<HTMLElement>(`[data-ply="${ply}"]`);
    if (!box || !el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    if (top < box.scrollTop + 8) box.scrollTop = top - 8;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight - 8) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
  }, [ply]);

  // What the board shows: a side line being played out, or the game position.
  const boardFen = line ? fenAtPly(line.variation, line.ply) : gm ? gm.fenAfter : game.startFen;
  const boardMove = line ? moveAtPly(line.variation, line.ply) : gm;
  const placement = useMemo(() => placementFromFen(boardFen), [boardFen]);
  // Top engine lines for whatever is on the board. During the review the pool's own lines
  // stand in (no extra engine work); afterwards a dedicated engine searches deeper, live.
  const live = useLiveLines(boardFen, { enabled: active && r.status === "done" });
  const gameLines = !line ? (r.positions[ply]?.lines ?? []) : [];
  // The review's own lines stay up until the live search is at least as deep, so the
  // panel doesn't swap deeper lines for shallower ones (or 2 lines for 1) on every move.
  const useLive = !!live?.lines.length && (live.done || !gameLines.length || live.depth >= (gameLines[0]?.depth ?? 0));
  const shownLines = useLive ? live!.lines : gameLines;
  const linesDepth = useLive ? live!.depth : (gameLines[0]?.depth ?? null);
  const shownEval = line ? (live?.lines[0]?.eval ?? (line.user ? null : line.eval)) : (r.positions[ply]?.eval ?? null);

  /** A move played on the board: follows the game if it's the game's move, otherwise starts (or extends) "Your moves". */
  const userMove = (uci: string) => {
    if (!line && game.moves[ply]?.uci === uci) return go(ply + 1);
    const start = line ? line.variation.startFen : boardFen;
    const before = line ? line.variation.moves.slice(0, line.ply).map((m) => m.uci) : [];
    const v = buildVariation(start, [...before, uci], 60);
    if (v.moves.length !== before.length + 1) return;
    setLine({ title: line?.user ? line.title : "Your moves", variation: v, ply: v.moves.length, eval: line?.eval ?? r.positions[ply]?.eval ?? { kind: "cp", cp: 0 }, user: true });
    setHover(null);
    setAnimKey((k) => k + 1);
  };

  const marks = useMemo((): Marks => {
    if (hover) return hover;
    const m = emptyMarks();
    if (line) {
      const nx = line.variation.moves[line.ply];
      if (nx) m.arrows.push({ from: nx.from, to: nx.to, tone: "info", thin: true, dashed: true });
      return m;
    }
    if (cm && cm.bestUci && cm.bestUci !== cm.move.uci && !["book", "forced", "best", "brilliant", "great"].includes(cm.cls)) {
      m.arrows.push({ from: cm.bestUci.slice(0, 2) as Square, to: cm.bestUci.slice(2, 4) as Square, tone: "opportunity" });
    }
    const next = game.moves[ply];
    if (next && !cm) m.arrows.push({ from: next.from, to: next.to, tone: "info", thin: true, dashed: true });
    return m;
  }, [hover, line, cm, game.moves, ply]);

  const stamp = !line && cm ? { sq: cm.move.to, node: <ClassIcon cls={cm.cls} size={28} />, key: `${ply}-${cm.cls}` } : null;

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
    setLine({ title, variation: v, ply: 1, eval: e });
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
        className={`rv-cell ${ply === p ? "rv-cell-on" : ""} ${!c ? "rv-cell-wait" : COLOURED.includes(c.cls) ? "rv-cell-mark" : ""}`}
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
            label={`Game position after ${gm ? moveName(gm) : "the start"}`}
            dimPieces={!!hover}
          />
        </div>
        <PlayerRow game={game} color={orientation} accuracy={r.accuracy?.[orientation]} active={turnAt === orientation} />

        {line ? (
          <VariationBar variation={line.variation} ply={line.ply} onNav={navLine} evals={[]} title={line.title} onClose={() => setLine(null)} />
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
            setLine({ title: "Engine line", variation: v, ply: Math.min(upto, v.moves.length), eval: shownLines.find((l) => l.pv === pv)?.eval ?? { kind: "cp", cp: 0 } });
            setHover(null);
            setAnimKey((k) => k + 1);
          }}
          onHover={setHover}
        />

        <section className={`rv-card ${cm ? `rv-card-${cm.cls}` : ""}`} aria-live="polite" style={cm ? { ["--cls" as string]: CLASS_INFO[cm.cls].color } : undefined}>
          <SmoothHeight className="rv-card-body" keepHeight={reasoning?.status === "pending"}>
            {ply === 0 ? (
              <>
                <p className="eyebrow">Start</p>
                <p className="rv-headline">
                  {running
                    ? "Moves get their labels as the engine finishes them; sharp moments are then double-checked deeper. Step through with ← → or pick a move."
                    : "Step through with ← →, click the graph, or jump to a key moment below."}
                </p>
              </>
            ) : !cm || !story ? (
              <>
                <p className="eyebrow">{gm ? moveName(gm) : ""}</p>
                <p className="rv-headline muted">The engine hasn&apos;t reached this move yet…</p>
              </>
            ) : (
              <>
                <div className="rv-card-head">
                  <ClassIcon cls={cm.cls} size={30} />
                  <div>
                    <span className="rv-cls">{CLASS_INFO[cm.cls].label}</span>
                    <h3 className="rv-move">{moveName(cm.move)}</h3>
                  </div>
                  <EvalChip e={cm.evalAfter} />
                </div>
                <MoveInsight cm={cm} story={story} entry={reasoning} onHover={setHover} onPlay={playLine} />
              </>
            )}
            <div className="rv-deep">
              <button className="btn btn-primary btn-sm" onClick={() => onDeep(boardFen)}>
                Deep-analyse this position
              </button>
              {gm && !line && (
                <button className="linkish" onClick={() => onDeep(gm.fenBefore)}>
                  or the moment before {moveName(gm)}
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
          <button data-ply={0} className={`rv-start ${ply === 0 ? "rv-cell-on" : ""}`} onClick={() => go(0)}>
            Start position
          </button>
          {rows.map((row) => (
            <div key={row.num} className="rv-row">
              <span className="rv-num mono">{row.num}.</span>
              {cell(row.w)}
              {cell(row.b)}
            </div>
          ))}
          <p className="rv-result mono">{game.result}</p>
        </section>
      </aside>
    </main>
  );
  // Line previews (hover a move in an explanation) use the board's orientation.
  return <PeekOrientation.Provider value={orientation}>{view}</PeekOrientation.Provider>;
}
