"use client";

import { memo, useMemo } from "react";
import { ALL_SQUARES, fileIndex, isLightSquare, rankIndex } from "@/lib/chess/board";
import type { Color, Placement, Square } from "@/lib/chess/types";
import { pieceToChar } from "@/lib/chess/fen";
import type { ArrowMark, BadgeMark, Marks, SquareMark, Tone } from "@/lib/facts/types";

const S = 100;

export interface BoardProps {
  placement: Placement;
  orientation: Color;
  marks?: Marks;
  lastMove?: { from: Square; to: Square } | null;
  /** When set, the piece on `to` slides in from `from`. Changing the key replays it. */
  animate?: { from: Square; to: Square; key: string } | null;
  selected?: Square | null;
  /** Small dots for legal destinations. */
  targets?: Square[];
  /** Setup mode: squares the recognizer wasn't sure about. */
  uncertain?: Square[];
  /** Setup mode: squares tied to a validation problem. */
  problems?: Square[];
  onSquareClick?: (sq: Square) => void;
  label: string;
  coordinates?: boolean;
  dimPieces?: boolean;
}

function xy(sq: Square, o: Color) {
  const f = fileIndex(sq);
  const r = rankIndex(sq);
  return { x: (o === "w" ? f : 7 - f) * S, y: (o === "w" ? 7 - r : r) * S };
}

const center = (sq: Square, o: Color) => {
  const { x, y } = xy(sq, o);
  return { cx: x + S / 2, cy: y + S / 2 };
};

function SquareOverlay({ m, o }: { m: SquareMark; o: Color }) {
  const { x, y } = xy(m.sq, o);
  const cls = `mk mk-${m.tone}`;
  switch (m.style) {
    case "fill":
      return <rect className={`${cls} mk-fill`} x={x} y={y} width={S} height={S} />;
    case "hatch":
      return <rect x={x} y={y} width={S} height={S} fill={`url(#hatch-${m.tone})`} className="mk-hatch" />;
    case "ring":
      return <rect className={`${cls} mk-ring`} x={x + 5} y={y + 5} width={S - 10} height={S - 10} rx={10} />;
    case "dashed":
      return <rect className={`${cls} mk-ring mk-dashed`} x={x + 7} y={y + 7} width={S - 14} height={S - 14} rx={10} />;
    case "dot":
      return <circle className={`${cls} mk-dot`} cx={x + S / 2} cy={y + S / 2} r={11} />;
  }
}

function Arrow({ a, o, idx }: { a: ArrowMark; o: Color; idx: number }) {
  const p1 = center(a.from, o);
  const p2 = center(a.to, o);
  const dx = p2.cx - p1.cx;
  const dy = p2.cy - p1.cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const w = a.thin ? 7 : 13;
  const head = a.thin ? 20 : 30;
  const start = { x: p1.cx + ux * 22, y: p1.cy + uy * 22 };
  const tip = { x: p2.cx - ux * 14, y: p2.cy - uy * 14 };
  const base = { x: tip.x - ux * head, y: tip.y - uy * head };
  const nx = -uy;
  const ny = ux;
  const hw = head * 0.62;
  return (
    <g className={`arrow arrow-${a.tone}${a.dashed ? " arrow-dashed" : ""}`} style={{ ["--i" as string]: idx }}>
      <line x1={start.x} y1={start.y} x2={base.x} y2={base.y} strokeWidth={w} strokeLinecap="round" />
      <polygon points={`${tip.x},${tip.y} ${base.x + nx * hw},${base.y + ny * hw} ${base.x - nx * hw},${base.y - ny * hw}`} />
    </g>
  );
}

function Badge({ b, o }: { b: BadgeMark; o: Color }) {
  const { x, y } = xy(b.sq, o);
  const w = Math.max(30, b.text.length * 12 + 14);
  return (
    <g className={`badge badge-${b.tone}`}>
      <rect x={x + S - w - 3} y={y + 3} width={w} height={26} rx={13} />
      <text x={x + S - w / 2 - 3} y={y + 21} textAnchor="middle">
        {b.text}
      </text>
    </g>
  );
}

const TONES: Tone[] = ["danger", "opportunity", "info", "white", "black", "idea"];

function BoardImpl(props: BoardProps) {
  const { placement, orientation: o, marks, lastMove, animate, selected, targets, uncertain, problems, onSquareClick, label } = props;
  const coords = props.coordinates ?? true;

  const pieces = useMemo(
    () =>
      ALL_SQUARES.filter((sq) => placement[sq]).map((sq) => {
        const piece = placement[sq]!;
        const code = `${piece.color}${pieceToChar(piece).toUpperCase()}`;
        return { sq, code };
      }),
    [placement],
  );

  return (
    <svg className="board" viewBox={`0 0 ${8 * S} ${8 * S}`} role="img" aria-label={label}>
      <defs>
        {TONES.map((t) => (
          <pattern key={t} id={`hatch-${t}`} width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="14" height="14" className={`hatch-bg hatch-bg-${t}`} />
            <line x1="0" y1="0" x2="0" y2="14" className={`hatch-line hatch-${t}`} strokeWidth="5" />
          </pattern>
        ))}
      </defs>

      {ALL_SQUARES.map((sq) => {
        const { x, y } = xy(sq, o);
        return <rect key={sq} x={x} y={y} width={S} height={S} className={isLightSquare(sq) ? "sq-light" : "sq-dark"} />;
      })}

      {lastMove &&
        [lastMove.from, lastMove.to].map((sq) => {
          const { x, y } = xy(sq, o);
          return <rect key={`lm-${sq}`} x={x} y={y} width={S} height={S} className="sq-last" />;
        })}

      {coords &&
        ALL_SQUARES.map((sq) => {
          const { x, y } = xy(sq, o);
          const bottom = o === "w" ? rankIndex(sq) === 0 : rankIndex(sq) === 7;
          const left = o === "w" ? fileIndex(sq) === 0 : fileIndex(sq) === 7;
          const cls = isLightSquare(sq) ? "coord coord-on-light" : "coord coord-on-dark";
          return (
            <g key={`c-${sq}`}>
              {bottom && (
                <text x={x + S - 7} y={y + S - 7} textAnchor="end" className={cls}>
                  {sq[0]}
                </text>
              )}
              {left && (
                <text x={x + 6} y={y + 20} className={cls}>
                  {sq[1]}
                </text>
              )}
            </g>
          );
        })}

      <g className="layer-squares">
        {marks?.squares.filter((m) => m.style === "fill" || m.style === "hatch").map((m, i) => <SquareOverlay key={`f${i}`} m={m} o={o} />)}
      </g>

      {problems?.map((sq) => {
        const { x, y } = xy(sq, o);
        return <rect key={`p-${sq}`} x={x + 4} y={y + 4} width={S - 8} height={S - 8} rx={8} className="sq-problem" />;
      })}

      <g className={props.dimPieces ? "pieces pieces-dim" : "pieces"}>
        {pieces.map(({ sq, code }) => {
          const { x, y } = xy(sq, o);
          const anim = animate && animate.to === sq ? animate : null;
          const from = anim ? xy(anim.from, o) : null;
          return (
            <g
              key={anim ? `${sq}-${anim.key}` : sq}
              className={anim ? "piece piece-enter" : "piece"}
              style={from ? ({ ["--dx" as string]: `${from.x - x}px`, ["--dy" as string]: `${from.y - y}px` } as React.CSSProperties) : undefined}
            >
              <image href={`/pieces/${code}.svg`} x={x + 4} y={y + 4} width={S - 8} height={S - 8} />
            </g>
          );
        })}
      </g>

      <g className="layer-marks">
        {marks?.squares.filter((m) => m.style !== "fill" && m.style !== "hatch").map((m, i) => <SquareOverlay key={`r${i}`} m={m} o={o} />)}
        {uncertain?.map((sq) => {
          const { x, y } = xy(sq, o);
          return (
            <g key={`u-${sq}`} className="sq-uncertain">
              <rect x={x + 6} y={y + 6} width={S - 12} height={S - 12} rx={10} />
              <circle cx={x + S - 18} cy={y + 18} r={13} />
              <text x={x + S - 18} y={y + 24} textAnchor="middle">
                ?
              </text>
            </g>
          );
        })}
        {selected && (() => {
          const { x, y } = xy(selected, o);
          return <rect x={x + 3} y={y + 3} width={S - 6} height={S - 6} rx={6} className="sq-selected" />;
        })()}
        {targets?.map((sq) => {
          const { x, y } = xy(sq, o);
          return placement[sq] ? (
            <circle key={`t-${sq}`} cx={x + S / 2} cy={y + S / 2} r={44} className="sq-target-capture" />
          ) : (
            <circle key={`t-${sq}`} cx={x + S / 2} cy={y + S / 2} r={14} className="sq-target" />
          );
        })}
        {marks?.arrows.map((a, i) => <Arrow key={`a${i}-${a.from}${a.to}`} a={a} o={o} idx={i} />)}
        {marks?.badges.map((b, i) => <Badge key={`b${i}`} b={b} o={o} />)}
      </g>

      {onSquareClick &&
        ALL_SQUARES.map((sq) => {
          const { x, y } = xy(sq, o);
          return (
            <rect
              key={`hit-${sq}`}
              x={x}
              y={y}
              width={S}
              height={S}
              className="hit"
              onClick={() => onSquareClick(sq)}
              aria-label={sq}
            />
          );
        })}
    </svg>
  );
}

export const Board = memo(BoardImpl);
