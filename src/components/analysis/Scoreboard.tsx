"use client";

import type { Color } from "@/lib/chess/types";
import type { AnalysisSnapshot } from "@/lib/engine/client";
import { describeEval, formatEval, type Evaluation } from "@/lib/engine/score";
import type { Ledger } from "@/lib/facts/ledger";
import { MATERIAL_ORDER, type MaterialSummary } from "@/lib/facts/material";
import { SEARCH_PRESETS, type MainStatus } from "./useAnalysis";

interface Props {
  ledger: Ledger;
  material: MaterialSummary;
  turn: Color;
  orientation: Color;
  evaluation: Evaluation | null;
  depth?: number;
  context: string;
  status: MainStatus;
  snapshot: AnalysisSnapshot | null;
  error: string | null;
  presetIdx: number;
  onPreset: (i: number) => void;
  multipv: number;
  onMultipv: (n: number) => void;
  onStop: () => void;
  onRerun: () => void;
  progress: number;
}

function SideCard({ c, ledger, material, turn }: { c: Color; ledger: Ledger; material: MaterialSummary; turn: Color }) {
  const mine = material[c].counts;
  const theirs = material[c === "w" ? "b" : "w"].counts;
  const extra = MATERIAL_ORDER.flatMap((t) => Array.from({ length: Math.max(0, mine[t] - theirs[t]) }, () => t));
  const diff = c === "w" ? material.diff : -material.diff;
  return (
    <div className={`side-card side-card-${c}`}>
      <div className="side-card-head">
        <span className="side-name">
          <span className={`side-dot side-${c}`} aria-hidden />
          {c === "w" ? "White" : "Black"}
        </span>
        {turn === c && <span className="to-move">To move</span>}
      </div>
      <div className="tallies">
        <span className="mini-tally t-opportunity" title="Strengths found on the board">
          <b>{ledger[c].strengths.length}</b> strengths
        </span>
        <span className="mini-tally t-danger" title="Weaknesses found on the board">
          <b>{ledger[c].weaknesses.length}</b> weaknesses
        </span>
      </div>
      <div className="keys">
        {ledger[c].strengths[0] && <span className="key t-opportunity">+ {ledger[c].strengths[0].label}</span>}
        {ledger[c].weaknesses[0] && <span className="key t-danger">− {ledger[c].weaknesses[0].label}</span>}
      </div>
      {(extra.length > 0 || material.diff === 0) && (
        <div className="material-line" aria-label={`Material ${diff > 0 ? `+${diff}` : diff}`}>
          {extra.map((t, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={`/pieces/${c}${t.toUpperCase()}.svg`} alt="" />
          ))}
          {diff > 0 && <span className="plus">+{diff}</span>}
          {material.diff === 0 && <span className="small muted">Material level</span>}
        </div>
      )}
    </div>
  );
}

export function Scoreboard(p: Props) {
  const e = p.evaluation;
  const v = e ? describeEval(e) : null;
  const running = p.status === "running" || p.status === "starting";
  return (
    <section className="score" aria-label="Scoreboard">
      <div className={`verdict-card ${v?.strength === "mate" ? "verdict-mate" : ""}`}>
        <div className="verdict-top">
          <div>
            <div className="eyebrow">{p.context}</div>
            <h1 className="verdict-head">{v ? v.headline : p.status === "error" ? "Engine offline" : "Reading the position…"}</h1>
          </div>
          <span className="verdict-num">{e ? formatEval(e) : "…"}</span>
        </div>
        <div className="verdict-sub">
          <span>{e?.kind === "mate" ? "Forced mate: there's no escape." : "White's view: + favours White · 1.00 ≈ a pawn"}</span>
          {p.depth ? <span className="mono">depth {p.depth}</span> : null}
        </div>
        <div className="engine-line">
          <span className={`dot dot-${p.status}`} aria-hidden />
          <span className="engine-status">
            {p.status === "starting" && "Starting Stockfish"}
            {p.status === "running" && `Stockfish thinking · depth ${p.snapshot?.depth ?? 0}`}
            {p.status === "done" && `Stockfish 19 · depth ${p.snapshot?.depth ?? 0}`}
            {p.status === "stopped" && `Stopped at depth ${p.snapshot?.depth ?? 0}`}
            {p.status === "error" && (p.error ?? "Engine unavailable")}
          </span>
          <span style={{ flex: 1 }} />
          <select className="select select-sm" value={p.presetIdx} onChange={(x) => p.onPreset(Number(x.target.value))} aria-label="Search depth or time">
            {SEARCH_PRESETS.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
          <select className="select select-sm" value={p.multipv} onChange={(x) => p.onMultipv(Number(x.target.value))} aria-label="Number of lines">
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} line{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
          {running ? (
            <button className="btn btn-sm" onClick={p.onStop}>
              Stop
            </button>
          ) : (
            <button className="btn btn-sm btn-ghost" onClick={p.onRerun}>
              {p.status === "error" ? "Retry" : "Re-run"}
            </button>
          )}
        </div>
        <div className="progress" aria-hidden>
          <span style={{ width: `${p.progress * 100}%` }} />
        </div>
      </div>
      <SideCard c="w" ledger={p.ledger} material={p.material} turn={p.turn} />
      <SideCard c="b" ledger={p.ledger} material={p.material} turn={p.turn} />
    </section>
  );
}
