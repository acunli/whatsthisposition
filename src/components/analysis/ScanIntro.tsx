"use client";

import { useEffect, useMemo, useState } from "react";
import { ALL_SQUARES, controlMap, fileIndex, isLightSquare, rankIndex } from "@/lib/chess/board";
import { pieceToChar } from "@/lib/chess/fen";
import type { Color, Placement } from "@/lib/chess/types";
import type { Ledger } from "@/lib/facts/ledger";

interface Props {
  placement: Placement;
  orientation: Color;
  ledger: Ledger;
  threats: number;
  depth: number;
  onDone: () => void;
}

const TOTAL_MS = 3300;

/**
 * The "X-ray" that plays when analysis starts: the board rises in 3D, pieces drop in,
 * a beam sweeps the ranks and every square flashes in the colour of the side that
 * controls it. Real numbers from the position fill the HUD. Skippable, and skipped
 * entirely for reduced-motion users.
 */
export function ScanIntro({ placement, orientation: o, ledger, threats, depth, onDone }: Props) {
  const [skip, setSkip] = useState(false);
  const control = useMemo(() => controlMap(placement), [placement]);
  const attacked = useMemo(() => ALL_SQUARES.filter((s) => control[s].w + control[s].b > 0).length, [control]);
  const contested = useMemo(() => ALL_SQUARES.filter((s) => control[s].w > 0 && control[s].b > 0).length, [control]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(onDone, reduce || skip ? 0 : TOTAL_MS + 450);
    return () => clearTimeout(t);
  }, [onDone, skip]);

  const col = (f: number) => (o === "w" ? f : 7 - f);
  const row = (r: number) => (o === "w" ? 7 - r : r);
  const strengths = ledger.w.strengths.length + ledger.b.strengths.length;
  const weaknesses = ledger.w.weaknesses.length + ledger.b.weaknesses.length;

  const hud = [
    <>
      Mapping <b>64</b> squares
    </>,
    <>
      <b>{attacked}</b> under attack · <b>{contested}</b> contested
    </>,
    <>Pawn structure · king cover · outposts</>,
    <>
      <b>{strengths}</b> strengths · <b>{weaknesses}</b> weaknesses
    </>,
    <>
      Stockfish searching · depth <b>{Math.max(1, depth)}</b>
    </>,
  ];

  return (
    <div className="scan" role="dialog" aria-label="Analysing the position" style={{ ["--out" as string]: `${TOTAL_MS}ms` }}>
      <div className="scan-title">
        X-raying
        <span>the position</span>
      </div>

      <div className="scan-stage">
        <div className="scan-board">
          <div className="scan-grid">
            {ALL_SQUARES.map((sq) => {
              const r = row(rankIndex(sq));
              const c = col(fileIndex(sq));
              const ctl = control[sq];
              const tone = ctl.w > ctl.b ? "t-white" : ctl.b > ctl.w ? "t-black" : "t-none";
              return (
                <div
                  key={sq}
                  className={`scan-sq ${tone}`}
                  style={{
                    gridRow: r + 1,
                    gridColumn: c + 1,
                    background: isLightSquare(sq) ? "var(--sq-l)" : "var(--sq-d)",
                    ["--w" as string]: r + c,
                    ["--r" as string]: r,
                  }}
                />
              );
            })}
          </div>
          {ALL_SQUARES.filter((sq) => placement[sq]).map((sq) => {
            const x = placement[sq]!;
            const r = row(rankIndex(sq));
            const c = col(fileIndex(sq));
            return (
              <span key={sq} className="scan-piece" style={{ left: `${c * 12.5}%`, top: `${r * 12.5}%`, ["--w" as string]: r + c }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/pieces/${x.color}${pieceToChar(x).toUpperCase()}.svg`} alt="" />
              </span>
            );
          })}
          <span className="scan-beam" />
        </div>
      </div>

      <div className="scan-hud" aria-hidden>
        {hud.map((h, i) => (
          <p key={i} style={{ animationDelay: `${0.5 + i * 0.45}s` }}>
            ▸ {h}
          </p>
        ))}
      </div>

      <div className="scan-tallies" aria-hidden>
        <div className="tally t-danger" style={{ animationDelay: "1.9s" }}>
          <b>{threats}</b>
          <span>Threats</span>
          <em>on the board</em>
        </div>
        <div className="tally t-opportunity" style={{ animationDelay: "2.15s" }}>
          <b>{strengths}</b>
          <span>Strengths</span>
          <em>for both sides</em>
        </div>
        <div className="tally t-danger" style={{ animationDelay: "2.4s" }}>
          <b>{weaknesses}</b>
          <span>Weaknesses</span>
          <em>to exploit or fix</em>
        </div>
      </div>

      <button className="btn btn-sm btn-ghost scan-skip" onClick={() => setSkip(true)}>
        Skip ⏭
      </button>
    </div>
  );
}
