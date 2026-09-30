"use client";

import { useMemo, useState } from "react";
import { BoardStage } from "../BoardStage";
import type { EngineLine } from "@/lib/engine/client";
import { placementFromFen } from "@/lib/chess/fen";
import type { Color } from "@/lib/chess/types";
import { makeCtx } from "@/lib/facts/context";
import { enPrise } from "@/lib/facts/context";
import { escapeSquares } from "@/lib/facts/king";
import { materialSummary } from "@/lib/facts/material";
import { classifyPawns } from "@/lib/facts/pawns";
import { ALL_SQUARES } from "@/lib/chess/board";
import { buildVariation, fenAtPly, formatLine } from "@/lib/variation";
import { EvalChip } from "./bits";

interface Props {
  fen: string;
  lines: EngineLine[];
  orientation: Color;
  pair: [number, number];
  onPair: (p: [number, number]) => void;
}

function snapshot(fen: string) {
  const ctx = makeCtx(fen);
  const m = materialSummary(ctx.p);
  const risk = (c: Color) => ALL_SQUARES.filter((s) => ctx.p[s]?.color === c && enPrise(ctx, s)).length;
  const passed = (c: Color) => classifyPawns(ctx.p).filter((x) => x.color === c && x.passed).length;
  return {
    material: m.diff,
    riskW: risk("w"),
    riskB: risk("b"),
    passedW: passed("w"),
    passedB: passed("b"),
    kingW: escapeSquares(ctx.p, "w").length,
    kingB: escapeSquares(ctx.p, "b").length,
    checks: ctx.legal.filter((mv) => /[+#]/.test(mv.san)).length,
    toMove: ctx.turn,
  };
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

export function ComparePanel({ fen, lines, orientation, pair, onPair }: Props) {
  const [depthPlies, setDepthPlies] = useState(4);
  const a = lines.find((l) => l.multipv === pair[0]) ?? lines[0];
  const b = lines.find((l) => l.multipv === pair[1]) ?? lines[1];
  const va = useMemo(() => (a ? buildVariation(fen, a.pv, 16) : null), [fen, a]);
  const vb = useMemo(() => (b ? buildVariation(fen, b.pv, 16) : null), [fen, b]);
  if (!a || !b || !va || !vb || lines.length < 2) {
    return <p className="muted pad">Comparison needs at least two candidate lines. Set “Lines” to 2 or more.</p>;
  }
  const maxPly = Math.max(1, Math.min(va.moves.length, vb.moves.length));
  const n = Math.min(depthPlies, maxPly);
  const fa = fenAtPly(va, n);
  const fb = fenAtPly(vb, n);
  const sa = snapshot(fa);
  const sb = snapshot(fb);
  const rows: [string, string, string, boolean][] = [
    ["Material (White − Black)", signed(sa.material), signed(sb.material), sa.material !== sb.material],
    ["Pieces en prise · White / Black", `${sa.riskW} / ${sa.riskB}`, `${sb.riskW} / ${sb.riskB}`, sa.riskW !== sb.riskW || sa.riskB !== sb.riskB],
    ["Passed pawns · White / Black", `${sa.passedW} / ${sa.passedB}`, `${sb.passedW} / ${sb.passedB}`, sa.passedW !== sb.passedW || sa.passedB !== sb.passedB],
    ["King's free squares · White / Black", `${sa.kingW} / ${sa.kingB}`, `${sb.kingW} / ${sb.kingB}`, sa.kingW !== sb.kingW || sa.kingB !== sb.kingB],
    [`Checks for ${sa.toMove === "w" ? "White" : "Black"} to move`, String(sa.checks), String(sb.checks), sa.checks !== sb.checks],
  ];

  const pick = (slot: 0 | 1, v: number) => onPair(slot === 0 ? [v, pair[1]] : [pair[0], v]);

  return (
    <div className="compare">
      <div className="compare-controls">
        {([0, 1] as const).map((slot) => (
          <label key={slot} className={`compare-pick compare-pick-${slot ? "b" : "a"}`}>
            <span className="compare-tag">{slot ? "B" : "A"}</span>
            <select className="select" value={pair[slot]} onChange={(e) => pick(slot, Number(e.target.value))}>
              {lines.map((l) => (
                <option key={l.multipv} value={l.multipv}>
                  #{l.multipv} {buildVariation(fen, l.pv.slice(0, 1)).moves[0]?.san}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="fine">
          After
          <input type="range" min={1} max={maxPly} value={n} onChange={(e) => setDepthPlies(Number(e.target.value))} />
          <span className="mono">
            {n} move{n > 1 ? "s" : ""}
          </span>
        </label>
      </div>
      <div className="compare-boards">
        {[
          { l: a, v: va, f: fa, tag: "A" },
          { l: b, v: vb, f: fb, tag: "B" },
        ].map(({ l, v, f, tag }) => {
          const last = v.moves[n - 1];
          return (
            <figure key={tag} className={`mini mini-${tag.toLowerCase()}`}>
              <div className="mini-head">
                <span className="compare-tag">{tag}</span>
                <EvalChip e={l.eval} />
              </div>
              <BoardStage placement={placementFromFen(f)} orientation={orientation} coordinates={false} lastMove={last ? { from: last.from, to: last.to } : null} label={`Line ${tag} after ${n} moves`} />
              <figcaption className="mono">
                {formatLine(v, n)
                  .map((t) => t.label)
                  .join(" ")}
              </figcaption>
            </figure>
          );
        })}
      </div>
      <table className="diff">
        <thead>
          <tr>
            <th scope="col">After {n} moves</th>
            <th scope="col">A</th>
            <th scope="col">B</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, x, y, changed]) => (
            <tr key={k} className={changed ? "diff-changed" : ""}>
              <th scope="row">{k}</th>
              <td className="mono">{x}</td>
              <td className="mono">{y}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Counts come from the board at that point in each line; the evaluations are the engine&apos;s for the full lines.</p>
    </div>
  );
}
