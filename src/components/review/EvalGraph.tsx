"use client";

import { useRef } from "react";
import { CLASS_INFO, expectedScore, type ClassifiedMove, type MoveClass, type PositionAnalysis } from "@/lib/review/classify";

const W = 600;
const H = 110;
const MARKED: MoveClass[] = ["brilliant", "great", "miss", "mistake", "blunder"];

interface Props {
  positions: (PositionAnalysis | null)[];
  moves: ClassifiedMove[];
  /** Selected position: 0 = start, k = after move k. */
  ply: number;
  onPly: (ply: number) => void;
}

const moveName = (m: ClassifiedMove) => `${m.move.moveNumber}${m.move.color === "w" ? "." : "…"}${m.move.san}`;

/** White's winning chances across the game. White's area grows from the bottom; click or drag to jump. */
export function EvalGraph({ positions, moves, ply, onPly }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const n = Math.max(1, positions.length - 1);
  const x = (i: number) => (i / n) * W;
  const y = (p: number) => H - p * H;

  const pts: [number, number][] = [];
  for (let i = 0; i < positions.length; i++) {
    const pa = positions[i];
    if (!pa) break;
    pts.push([x(i), y(expectedScore(pa.eval, "w"))]);
  }
  const line = pts.map(([px, py], k) => `${k ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${pts[pts.length - 1][0].toFixed(1)},${H} L0,${H} Z` : "";

  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onPly(Math.round(t * n));
  };

  return (
    <div
      ref={ref}
      className="egraph"
      role="slider"
      aria-label="Evaluation graph: pick a move"
      aria-valuemin={0}
      aria-valuemax={n}
      aria-valuenow={ply}
      tabIndex={0}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".egraph-dot")) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        pick(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1 && !(e.target as HTMLElement).closest(".egraph-dot")) pick(e.clientX);
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
        {area && <path d={area} className="egraph-area" />}
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="egraph-mid" vectorEffect="non-scaling-stroke" />
        {line && <path d={line} className="egraph-line" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="egraph-cursor" style={{ left: `${(ply / n) * 100}%` }} aria-hidden />
      {moves.map((m, i) =>
        MARKED.includes(m.cls) ? (
          <button
            key={i}
            className="egraph-dot"
            style={{ left: `${((i + 1) / n) * 100}%`, top: `${(1 - (m.move.color === "w" ? m.after : 1 - m.after)) * 100}%`, background: CLASS_INFO[m.cls].color }}
            onClick={() => onPly(i + 1)}
            title={`${moveName(m)}: ${CLASS_INFO[m.cls].label}`}
            aria-label={`${moveName(m)}, ${CLASS_INFO[m.cls].label}`}
          />
        ) : null,
      )}
    </div>
  );
}
