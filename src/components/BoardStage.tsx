"use client";

import { memo, useMemo, type ReactNode } from "react";
import { ALL_SQUARES, fileIndex, isLightSquare, rankIndex } from "@/lib/chess/board";
import { pieceToChar } from "@/lib/chess/fen";
import type { Color, Placement, Square } from "@/lib/chess/types";
import type { ArrowMark, IconName, LinkMark, Marks } from "@/lib/facts/types";

export interface BoardStageProps {
  placement: Placement;
  orientation: Color;
  marks?: Marks;
  lastMove?: { from: Square; to: Square } | null;
  /** The piece on `to` slides in from `from`; a new key replays it. */
  animate?: { from: Square; to: Square; key: string } | null;
  selected?: Square | null;
  targets?: Square[];
  uncertain?: Square[];
  problems?: Square[];
  onSquareClick?: (sq: Square) => void;
  label: string;
  coordinates?: boolean;
  /** Changing this replays every overlay's entrance animation. */
  revealKey?: string | number;
  dimPieces?: boolean;
  className?: string;
  /** An icon pinned to a square's top-right corner (e.g. a move-classification badge). */
  stamp?: { sq: Square; node: ReactNode; key: string } | null;
}

const col = (sq: Square, o: Color) => (o === "w" ? fileIndex(sq) : 7 - fileIndex(sq));
const row = (sq: Square, o: Color) => (o === "w" ? 7 - rankIndex(sq) : rankIndex(sq));
const cx = (sq: Square, o: Color) => col(sq, o) * 100 + 50;
const cy = (sq: Square, o: Color) => row(sq, o) * 100 + 50;

const ICONS: Record<IconName, string> = {
  shield: "M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z",
  flag: "M6 21V4M6 4h11l-2.5 4L17 12H6",
  crown: "M4 18h16M5 16l-1-9 5 4 3-6 3 6 5-4-1 9z",
  star: "M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z",
  target: "M12 3a9 9 0 110 18 9 9 0 010-18zM12 8a4 4 0 110 8 4 4 0 010-8z",
  lock: "M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z",
  bolt: "M13 2L4 14h7l-1 8 9-12h-7z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 110 6 3 3 0 010-6z",
};

function arrowPath(a: ArrowMark, o: Color): { d: string; head: string } {
  const x1 = cx(a.from, o);
  const y1 = cy(a.from, o);
  const x2 = cx(a.to, o);
  const y2 = cy(a.to, o);
  const dx = Math.abs(col(a.to, o) - col(a.from, o));
  const dy = Math.abs(row(a.to, o) - row(a.from, o));
  const knight = (dx === 1 && dy === 2) || (dx === 2 && dy === 1);
  // Knight moves bend like the knight does.
  const pts = knight ? (dy === 2 ? [[x1, y1], [x1, y2], [x2, y2]] : [[x1, y1], [x2, y1], [x2, y2]]) : [[x1, y1], [x2, y2]];
  const [px, py] = pts[pts.length - 2];
  const len = Math.hypot(x2 - px, y2 - py) || 1;
  const ux = (x2 - px) / len;
  const uy = (y2 - py) / len;
  const headLen = a.thin ? 22 : 32;
  const tip = [x2 - ux * 12, y2 - uy * 12];
  const base = [tip[0] - ux * headLen, tip[1] - uy * headLen];
  const start = [pts[0][0] + (pts[1][0] - pts[0][0] === 0 ? 0 : Math.sign(pts[1][0] - pts[0][0]) * 24), pts[0][1] + (pts[1][1] - pts[0][1] === 0 ? 0 : Math.sign(pts[1][1] - pts[0][1]) * 24)];
  const mid = pts.slice(1, -1);
  const d = `M${start[0]},${start[1]} ${mid.map((p) => `L${p[0]},${p[1]}`).join(" ")} L${base[0]},${base[1]}`;
  const hw = headLen * 0.62;
  const head = `${tip[0]},${tip[1]} ${base[0] - uy * hw},${base[1] + ux * hw} ${base[0] + uy * hw},${base[1] - ux * hw}`;
  return { d, head };
}

function Link({ l, o, i }: { l: LinkMark; o: Color; i: number }) {
  return (
    <line
      x1={cx(l.from, o)}
      y1={cy(l.from, o)}
      x2={cx(l.to, o)}
      y2={cy(l.to, o)}
      pathLength={1}
      className={`bs-link bs-link-${l.kind} t-${l.tone}`}
      style={{ ["--i" as string]: i }}
    />
  );
}

function BoardStageImpl(props: BoardStageProps) {
  const { placement, orientation: o, marks, lastMove, animate, selected, targets, uncertain, problems, onSquareClick, label, revealKey = 0 } = props;
  const coords = props.coordinates ?? true;

  const bySquare = useMemo(() => {
    const m = new Map<Square, NonNullable<Marks["squares"]>>();
    for (const s of marks?.squares ?? []) m.set(s.sq, [...(m.get(s.sq) ?? []), s]);
    return m;
  }, [marks]);

  const pieces = useMemo(
    () =>
      ALL_SQUARES.filter((sq) => placement[sq]).map((sq) => {
        const x = placement[sq]!;
        return { sq, code: `${x.color}${pieceToChar(x).toUpperCase()}` };
      }),
    [placement],
  );

  const badges = marks?.badges ?? [];
  const icons = marks?.icons ?? [];

  return (
    <div className={`bs ${props.className ?? ""}`} role="img" aria-label={label}>
      <div className="bs-grid">
        {ALL_SQUARES.map((sq) => {
          const r = row(sq, o);
          const c = col(sq, o);
          const light = isLightSquare(sq);
          const ov = bySquare.get(sq);
          return (
            <div
              key={sq}
              className={`bs-sq ${light ? "bs-light" : "bs-dark"}${onSquareClick ? " bs-click" : ""}`}
              style={{ gridRow: r + 1, gridColumn: c + 1 }}
              onClick={onSquareClick ? () => onSquareClick(sq) : undefined}
              data-sq={sq}
            >
              {lastMove && (lastMove.from === sq || lastMove.to === sq) && <span className="ov ov-last" />}
              {ov?.map((m, i) => (
                <span
                  key={`${revealKey}-${i}-${m.style}-${m.tone}`}
                  className={`ov ov-${m.style} t-${m.tone}`}
                  style={{ ["--o" as string]: m.order ?? i }}
                />
              ))}
              {problems?.includes(sq) && <span className="ov ov-problem" />}
              {selected === sq && <span className="ov ov-selected" />}
              {coords && r === 7 && <span className={`coord coord-f ${light ? "on-light" : "on-dark"}`}>{sq[0]}</span>}
              {coords && c === 0 && <span className={`coord coord-r ${light ? "on-light" : "on-dark"}`}>{sq[1]}</span>}
            </div>
          );
        })}
      </div>

      <div className="bs-bands" aria-hidden>
        {(marks?.bands ?? []).map((b, i) => {
          const idx = b.kind === "file" ? (o === "w" ? b.index : 7 - b.index) : o === "w" ? 7 - b.index : b.index;
          return (
            <span
              key={`${revealKey}-band-${i}`}
              className={`band band-${b.kind} t-${b.tone}`}
              style={b.kind === "file" ? { left: `${idx * 12.5}%` } : { top: `${idx * 12.5}%` }}
            />
          );
        })}
      </div>

      <div className={props.dimPieces ? "bs-pieces bs-dim" : "bs-pieces"} aria-hidden>
        {pieces.map(({ sq, code }) => {
          const anim = animate && animate.to === sq ? animate : null;
          const dx = anim ? col(anim.from, o) - col(sq, o) : 0;
          const dy = anim ? row(anim.from, o) - row(sq, o) : 0;
          return (
            <span
              key={anim ? `${sq}-${anim.key}` : sq}
              className={anim ? "pc pc-enter" : "pc"}
              style={{
                left: `${col(sq, o) * 12.5}%`,
                top: `${row(sq, o) * 12.5}%`,
                ...(anim ? { ["--dx" as string]: dx, ["--dy" as string]: dy } : {}),
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/pieces/${code}.svg`} alt="" draggable={false} />
            </span>
          );
        })}
      </div>

      <svg className="bs-svg" viewBox="0 0 800 800" aria-hidden>
        <g key={`links-${revealKey}`}>
          {(marks?.links ?? []).map((l, i) => (
            <Link key={i} l={l} o={o} i={i} />
          ))}
        </g>
        <g key={`arrows-${revealKey}`}>
          {(marks?.arrows ?? []).map((a, i) => {
            const { d, head } = arrowPath(a, o);
            return (
              <g key={`${i}-${a.from}${a.to}`} className={`bs-arrow t-${a.tone}${a.dashed ? " bs-arrow-dashed" : ""}${a.thin ? " bs-arrow-thin" : ""}`} style={{ ["--i" as string]: i }}>
                <path d={d} pathLength={1} />
                <polygon points={head} />
              </g>
            );
          })}
        </g>
        {targets?.map((sq) =>
          placement[sq] ? (
            <circle key={`t-${sq}`} cx={cx(sq, o)} cy={cy(sq, o)} r={44} className="bs-target-cap" />
          ) : (
            <circle key={`t-${sq}`} cx={cx(sq, o)} cy={cy(sq, o)} r={13} className="bs-target" />
          ),
        )}
        <g key={`icons-${revealKey}`}>
          {icons.map((ic, i) => (
            <g key={i} className={`bs-icon t-${ic.tone}`} transform={`translate(${col(ic.sq, o) * 100 + 4} ${row(ic.sq, o) * 100 + 4})`} style={{ ["--i" as string]: i }}>
              <circle cx={17} cy={17} r={17} />
              <path d={ICONS[ic.icon]} transform="translate(5 5)" />
            </g>
          ))}
        </g>
      </svg>

      <div className="bs-badges" aria-hidden>
        {badges.map((b, i) => (
          <span
            key={`${revealKey}-b-${i}`}
            className={`bs-badge t-${b.tone}`}
            style={{ left: `${(col(b.sq, o) + 1) * 12.5}%`, top: `${row(b.sq, o) * 12.5}%` }}
          >
            {b.text}
          </span>
        ))}
        {props.stamp && (
          <span key={`stamp-${props.stamp.key}`} className="bs-stamp" style={{ left: `${(col(props.stamp.sq, o) + 1) * 12.5}%`, top: `${row(props.stamp.sq, o) * 12.5}%` }}>
            {props.stamp.node}
          </span>
        )}
        {uncertain?.map((sq) => (
          <span key={`u-${sq}`} className="bs-unsure" style={{ left: `${col(sq, o) * 12.5}%`, top: `${row(sq, o) * 12.5}%` }}>
            <b>?</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export const BoardStage = memo(BoardStageImpl);
