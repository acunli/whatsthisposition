"use client";

import type { EngineLine } from "@/lib/engine/client";
import type { Evaluation } from "@/lib/engine/score";
import { classifyLoss } from "@/lib/deep/deep";
import type { InsightPoint, MoveInsight, WhyNot } from "@/lib/facts/explain";
import type { Marks } from "@/lib/facts/types";
import { buildVariation, formatLine } from "@/lib/variation";
import { EvalChip, EvidenceTag } from "./bits";
import { DeepCard } from "./DeepCard";
import type { DeepEntry } from "./useAnalysis";

export interface LineRef {
  key: string;
  kind: "engine" | "try" | "side";
  rank?: number;
  pv: string[];
  eval: Evaluation;
  depth: number;
}

export type WhyState = { kind: "why"; line: LineRef } | { kind: "whynot"; line: LineRef; data: WhyNot | null; loading?: boolean };

interface Props {
  fen: string;
  lines: EngineLine[];
  running: boolean;
  selectedKey: string | null;
  onSelect: (l: LineRef) => void;
  onHoverLine: (l: EngineLine | null) => void;
  onWhy: (l: LineRef) => void;
  onWhyNot: (l: LineRef) => void;
  why: WhyState | null;
  onCloseWhy: () => void;
  onHoverPoint: (m: Marks | null) => void;
  onShowPly: (ply: number) => void;
  deepFor: (uci: string | undefined) => DeepEntry | null;
  onPlay: (pv: string[], ply: number, title: string) => void;
}

export function toRef(l: EngineLine): LineRef {
  return { key: `pv${l.multipv}`, kind: "engine", rank: l.multipv, pv: l.pv, eval: l.eval, depth: l.depth };
}

export function LinesPanel(p: Props) {
  const { fen, lines, running, selectedKey } = p;
  if (!lines.length) {
    return <p className="muted pad">{running ? "The engine is warming up. Candidate moves appear here in a moment." : "No legal moves in this position."}</p>;
  }
  return (
    <div className="lines">
      <ol className="cands">
        {lines.map((l) => {
          const v = buildVariation(fen, l.pv, 10);
          const first = v.moves[0];
          if (!first) return null;
          const ref = toRef(l);
          const on = selectedKey === ref.key;
          return (
            <li
              key={l.multipv}
              className={on ? "cand cand-on" : "cand"}
              onMouseEnter={() => p.onHoverLine(l)}
              onMouseLeave={() => p.onHoverLine(null)}
            >
              <button className="cand-main" onClick={() => p.onSelect(ref)} aria-pressed={on}>
                <span className="cand-rank">{l.multipv}</span>
                <span className="cand-move">{first.san}</span>
                <EvalChip e={l.eval} />
                <span className="cand-line mono">
                  {formatLine(v)
                    .slice(1, 7)
                    .map((t) => t.label)
                    .join(" ")}
                </span>
              </button>
              <div className="cand-actions">
                <button className="chip-btn" onClick={() => p.onWhy(ref)}>
                  Why {first.san}?
                </button>
                {l.multipv > 1 && (
                  <button className="chip-btn chip-btn-alt" onClick={() => p.onWhyNot(ref)}>
                    Why not first?
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {p.why?.kind === "why" && <DeepCard entry={p.deepFor(p.why.line.pv[0])} onHoverMarks={p.onHoverPoint} onPlay={p.onPlay} onClose={p.onCloseWhy} />}
      {p.why?.kind === "whynot" && <WhyCard fen={fen} why={p.why} onClose={p.onCloseWhy} onHoverPoint={p.onHoverPoint} onShowPly={p.onShowPly} />}
    </div>
  );
}

function Points({ pts, onHoverPoint }: { pts: InsightPoint[]; onHoverPoint: (m: Marks | null) => void }) {
  return (
    <ul className="points">
      {pts.map((pt, i) => (
        <li
          key={i}
          className={`point point-${pt.tone}`}
          onMouseEnter={() => onHoverPoint(pt.marks.arrows.length || pt.marks.squares.length ? pt.marks : null)}
          onMouseLeave={() => onHoverPoint(null)}
        >
          <span className={`fact-mark fact-mark-${pt.tone}`} aria-hidden />
          <span>{pt.text}</span>
          <EvidenceTag e={pt.evidence} />
        </li>
      ))}
    </ul>
  );
}

function MoveBlock({
  label,
  m,
  ply,
  onHoverPoint,
  onShowPly,
}: {
  label: string;
  m: MoveInsight;
  ply: number;
  onHoverPoint: (m: Marks | null) => void;
  onShowPly: (p: number) => void;
}) {
  return (
    <div className="moveblock">
      <div className="moveblock-head">
        <span className="kicker">{label}</span>
        <button className="linkish" onClick={() => onShowPly(ply)}>
          show {m.san} on the board
        </button>
      </div>
      <Points pts={m.points} onHoverPoint={onHoverPoint} />
    </div>
  );
}

function WhyCard({
  why,
  onClose,
  onHoverPoint,
  onShowPly,
}: {
  fen: string;
  why: WhyState;
  onClose: () => void;
  onHoverPoint: (m: Marks | null) => void;
  onShowPly: (p: number) => void;
}) {
  return (
    <aside className="why" aria-live="polite">
      <header className="why-head">
        <h3>
          {why.kind === "whynot" && why.data ? (
            <>
              <span className={`cls cls-${classifyLoss(why.data.loss).kind}`}>
                {classifyLoss(why.data.loss).symbol && <b>{classifyLoss(why.data.loss).symbol}</b>}
                {classifyLoss(why.data.loss).label}
              </span>{" "}
              Why not {why.data.move.san}?
            </>
          ) : (
            "Why not this move?"
          )}
        </h3>
        <button className="linkish" onClick={onClose} aria-label="Close explanation">
          Close
        </button>
      </header>
      {why.kind === "whynot" && why.loading && <p className="muted">Asking the engine about this move…</p>}
      {why.kind === "whynot" && why.data && (
        <>
          <p className={`verdict ${why.data.loss >= 30 ? "verdict-bad" : ""}`}>{why.data.verdict}</p>
          {why.data.refutation && (
            <MoveBlock label={`The answer: ${why.data.refutation.san}`} m={why.data.refutation} ply={2} onHoverPoint={onHoverPoint} onShowPly={onShowPly} />
          )}
          <MoveBlock label={`What ${why.data.move.san} does`} m={why.data.move} ply={1} onHoverPoint={onHoverPoint} onShowPly={onShowPly} />
          <div className="moveblock">
            <div className="kicker">Engine</div>
            <Points pts={why.data.engine} onHoverPoint={onHoverPoint} />
          </div>
        </>
      )}
      {why.kind === "whynot" && !why.loading && !why.data && <p className="issue">The engine couldn&apos;t evaluate that move. Try again after the analysis finishes.</p>}
      <p className="why-foot">Hover a reason to see it on the board. “Board fact” = from the position itself; “Engine” = from Stockfish&apos;s line.</p>
    </aside>
  );
}
