"use client";

import { useMemo } from "react";
import type { EngineLine } from "@/lib/engine/client";
import { emptyMarks, type Marks } from "@/lib/facts/types";
import { buildVariation } from "@/lib/variation";
import { EvalChip } from "./analysis/bits";

interface Props {
  /** The position the lines start from. */
  fen: string;
  lines: EngineLine[];
  depth: number | null;
  /** Still searching (the lines will improve). */
  searching?: boolean;
  /** Play the line on the board up to (and including) move `ply` (1-based). */
  onPlay: (pv: string[], ply: number) => void;
  onHover?: (m: Marks | null) => void;
  max?: number;
}

/**
 * The engine's top lines for the position on the board, next to it: the evaluation and
 * the moves, each move clickable to play the line up to there.
 */
export function EngineLines({ fen, lines, depth, searching, onPlay, onHover, max = 3 }: Props) {
  const rows = useMemo(
    () =>
      lines.slice(0, max).map((l) => ({
        line: l,
        moves: buildVariation(fen, l.pv, 12).moves,
      })),
    [fen, lines, max],
  );
  return (
    <section className="elines" aria-label="Engine lines">
      <header className="elines-head">
        <span>Engine lines</span>
        <span className="muted">
          Stockfish 19{depth ? ` · depth ${depth}` : ""}
          {searching ? <i className="elines-dot" aria-label="searching" /> : null}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="elines-empty muted">{searching ? "Thinking…" : "No lines for this position."}</p>
      ) : (
        <ol className="elines-list">
          {rows.map(({ line, moves }, i) => (
            <li
              key={`${i}-${line.pv[0]}`}
              onMouseEnter={() => moves[0] && onHover?.({ ...emptyMarks(), arrows: [{ from: moves[0].from, to: moves[0].to, tone: "opportunity" }] })}
              onMouseLeave={() => onHover?.(null)}
            >
              <EvalChip e={line.eval} />
              <span className="elines-moves">
                {moves.map((m, k) => (
                  <button key={k} className="elines-mv" onClick={() => onPlay(line.pv, k + 1)} title="Play the line to here">
                    {m.color === "w" ? `${m.moveNumber}.` : k === 0 ? `${m.moveNumber}…` : ""}
                    {m.san}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
