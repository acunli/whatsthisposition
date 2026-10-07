"use client";

import { Chess, type Move } from "chess.js";
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { FILES } from "@/lib/chess/board";
import type { PieceSymbol, Square } from "@/lib/chess/types";
import { BoardStage, arrowPath, col, cx, cy, row, type BoardStageProps } from "./BoardStage";

/** Drawing colours, as on Lichess: green by default, Shift red, Alt blue, Shift+Alt yellow. */
type ShapeColor = "g" | "r" | "b" | "y";
interface Shapes {
  arrows: { from: Square; to: Square; c: ShapeColor }[];
  squares: { sq: Square; c: ShapeColor }[];
}
const NO_SHAPES: Shapes = { arrows: [], squares: [] };

export interface PlayBoardProps extends Omit<BoardStageProps, "onSquareClick" | "selected" | "targets" | "hide"> {
  /** The position shown (for legal moves). */
  fen: string;
  /** Called with a legal move in UCI ("e2e4", "e7e8q"). Without it the board only takes drawings. */
  onMove?: (uci: string) => void;
  /** Called when the selected square changes (e.g. to show what a piece does). */
  onSelect?: (sq: Square | null) => void;
  /** Right-click drawings: on by default. */
  annotate?: boolean;
}

const colourOf = (e: { shiftKey: boolean; altKey: boolean }): ShapeColor => (e.shiftKey && e.altKey ? "y" : e.shiftKey ? "r" : e.altKey ? "b" : "g");
const isRight = (e: ReactPointerEvent) => e.button === 2 || (e.button === 0 && e.ctrlKey);

/**
 * The board you can play on: click a piece and then a square, or drag it; promotions
 * ask which piece. Right-click a square to highlight it, right-drag to draw an arrow
 * (the same shape again removes it); a left click clears the drawings. Drawings and the
 * selection belong to the position, so they go when it changes.
 */
export function PlayBoard({ fen, onMove, onSelect, annotate = true, ...stage }: PlayBoardProps) {
  const o = stage.orientation;
  const ref = useRef<HTMLDivElement>(null);
  const playable = !!onMove;
  const legal = useMemo<Move[]>(() => {
    if (!playable) return [];
    try {
      return new Chess(fen).moves({ verbose: true });
    } catch {
      return [];
    }
  }, [fen, playable]);

  // State is tagged with the position it belongs to, so a new position starts clean without effects.
  const [sel, setSel] = useState<{ fen: string; sq: Square } | null>(null);
  const [shapes, setShapes] = useState<{ fen: string; s: Shapes }>({ fen, s: NO_SHAPES });
  const [drag, setDrag] = useState<{ from: Square; x: number; y: number; left: number; top: number; size: number } | null>(null);
  const [promo, setPromo] = useState<{ fen: string; from: Square; to: Square } | null>(null);
  const selected = sel?.fen === fen ? sel.sq : null;
  const drawn = shapes.fen === fen ? shapes.s : NO_SHAPES;
  const promoting = promo?.fen === fen ? promo : null;
  const start = useRef<{ from: Square; x: number; y: number; rect: DOMRect; wasSelected: boolean } | null>(null);
  const rightFrom = useRef<Square | null>(null);

  const targetsOf = (from: Square | null) => (from ? [...new Set(legal.filter((m) => m.from === from).map((m) => m.to as Square))] : []);
  const targets = targetsOf(selected);

  const select = (sq: Square | null) => {
    setSel(sq ? { fen, sq } : null);
    onSelect?.(sq);
  };

  const squareAt = (x: number, y: number): Square | null => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return null;
    const c = Math.floor(((x - r.left) / r.width) * 8);
    const rw = Math.floor(((y - r.top) / r.height) * 8);
    if (c < 0 || c > 7 || rw < 0 || rw > 7) return null;
    const file = o === "w" ? c : 7 - c;
    const rank = o === "w" ? 7 - rw : rw;
    return `${FILES[file]}${rank + 1}` as Square;
  };

  const play = (from: Square, to: Square) => {
    const ms = legal.filter((m) => m.from === from && m.to === to);
    if (!ms.length) return false;
    select(null);
    if (ms.some((m) => m.promotion)) setPromo({ fen, from, to });
    else onMove?.(ms[0].lan);
    return true;
  };

  const toggleShape = (from: Square, to: Square, c: ShapeColor) => {
    setShapes((cur) => {
      const s = cur.fen === fen ? cur.s : NO_SHAPES;
      if (from === to) {
        const has = s.squares.find((x) => x.sq === from);
        const squares = s.squares.filter((x) => x.sq !== from);
        return { fen, s: { ...s, squares: has && has.c === c ? squares : [...squares, { sq: from, c }] } };
      }
      const has = s.arrows.find((x) => x.from === from && x.to === to);
      const arrows = s.arrows.filter((x) => !(x.from === from && x.to === to));
      return { fen, s: { ...s, arrows: has && has.c === c ? arrows : [...arrows, { from, to, c }] } };
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const sq = squareAt(e.clientX, e.clientY);
    if (!sq) return;
    if (isRight(e)) {
      if (annotate) rightFrom.current = sq;
      return;
    }
    if (e.button !== 0) return;
    if (promoting) return;
    // A left click clears the drawings, as on Lichess.
    if (drawn.arrows.length || drawn.squares.length) setShapes({ fen, s: NO_SHAPES });
    if (selected && targets.includes(sq)) {
      play(selected, sq);
      return;
    }
    const hasPiece = !!stage.placement[sq];
    if (!hasPiece) {
      select(null);
      return;
    }
    const wasSelected = selected === sq;
    select(sq);
    if (playable && legal.some((m) => m.from === sq)) {
      start.current = { from: sq, x: e.clientX, y: e.clientY, rect: ref.current!.getBoundingClientRect(), wasSelected };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else if (wasSelected) select(null);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    if (drag || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 4) setDrag({ from: s.from, x: e.clientX, y: e.clientY, left: s.rect.left, top: s.rect.top, size: s.rect.width / 8 });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (rightFrom.current) {
      const from = rightFrom.current;
      rightFrom.current = null;
      const to = squareAt(e.clientX, e.clientY);
      if (to) toggleShape(from, to, colourOf(e));
      return;
    }
    const s = start.current;
    start.current = null;
    if (!s) return;
    const dragged = !!drag;
    setDrag(null);
    if (!dragged) {
      // A plain click on the piece that was already selected deselects it.
      if (s.wasSelected) select(null);
      return;
    }
    const to = squareAt(e.clientX, e.clientY);
    if (!to || to === s.from) return;
    if (!play(s.from, to)) select(null);
  };

  const cancelDrag = () => {
    start.current = null;
    rightFrom.current = null;
    setDrag(null);
  };

  const mover = (fen.split(" ")[1] ?? "w") as "w" | "b";
  const dragPiece = drag ? stage.placement[drag.from] : undefined;

  return (
    <div
      ref={ref}
      className={playable ? "pb pb-play" : "pb"}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelDrag}
      onContextMenu={(e) => annotate && e.preventDefault()}
    >
      <BoardStage {...stage} selected={selected} targets={targets} hide={drag ? drag.from : null} />
      {(drawn.arrows.length > 0 || drawn.squares.length > 0) && (
        <svg className="pb-shapes" viewBox="0 0 800 800" aria-hidden>
          {drawn.squares.map((x) => (
            <circle key={`s-${x.sq}`} className={`pb-ring pb-${x.c}`} cx={cx(x.sq, o)} cy={cy(x.sq, o)} r={45} />
          ))}
          {drawn.arrows.map((a) => {
            const { d, head } = arrowPath(a, o);
            return (
              <g key={`a-${a.from}${a.to}`} className={`pb-arrow pb-${a.c}`}>
                <path d={d} />
                <polygon points={head} />
              </g>
            );
          })}
        </svg>
      )}
      {drag && dragPiece && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="pb-ghost"
          src={`/pieces/${dragPiece.color}${dragPiece.type.toUpperCase()}.svg`}
          alt=""
          style={{ width: drag.size, height: drag.size, left: drag.x - drag.left - drag.size / 2, top: drag.y - drag.top - drag.size / 2 }}
        />
      )}
      {promoting && (
        <div className="pb-promo" style={{ left: `${col(promoting.to, o) * 12.5}%`, top: row(promoting.to, o) < 4 ? 0 : "50%" }} role="dialog" aria-label="Promote to">
          {(["q", "r", "b", "n"] as PieceSymbol[]).map((p) => (
            <button
              key={p}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                setPromo(null);
                onMove?.(`${promoting.from}${promoting.to}${p}`);
              }}
              aria-label={`Promote to ${{ q: "queen", r: "rook", b: "bishop", n: "knight" }[p as "q"]}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/pieces/${mover}${p.toUpperCase()}.svg`} alt="" draggable={false} />
            </button>
          ))}
          <button className="pb-promo-x" onPointerDown={(e) => e.stopPropagation()} onClick={() => setPromo(null)} aria-label="Cancel">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
