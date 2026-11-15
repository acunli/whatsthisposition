"use client";

import type { AnalysisSnapshot } from "@/lib/engine/client";
import { describeEval, formatEval, type Evaluation } from "@/lib/engine/score";
import { SEARCH_PRESETS, type MainStatus } from "./useAnalysis";

interface Props {
  /** The position in one sentence, and the two or three that follow it (lib/commentary); none while inside a line. */
  headline: string | null;
  story: string[];
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

export function Scoreboard(p: Props) {
  const e = p.evaluation;
  const v = e ? describeEval(e) : null;
  const running = p.status === "running" || p.status === "starting";
  return (
    <section className="score" aria-label="Scoreboard">
      <p className="wip-note">
        <span className="wip-tag">Under construction</span>
        <span className="small muted">Position analysis is still being built, so parts of it may be rough or missing.</span>
      </p>
      <div className={`verdict-card ${v?.strength === "mate" ? "verdict-mate" : ""}`}>
        <div className="verdict-top">
          <div>
            <div className="eyebrow">{p.context}</div>
            <h1 className="verdict-head">{v ? v.headline : p.status === "error" ? "Engine offline" : "Reading the position…"}</h1>
          </div>
          <span className="verdict-num">{e ? formatEval(e) : "…"}</span>
        </div>
        {p.headline && (
          <div className="verdict-read">
            <p className="verdict-kind">{p.headline}</p>
            {p.story.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}
        <div className="verdict-sub">
          <span>{e?.kind === "mate" ? "Forced mate: there's no escape." : "The number is from White's side: + favours White, 1.00 is about a pawn"}</span>
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
    </section>
  );
}
