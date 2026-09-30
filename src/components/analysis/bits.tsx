"use client";

import type { Color } from "@/lib/chess/types";
import { describeEval, evalBarShare, formatEval, type Evaluation } from "@/lib/engine/score";
import type { Evidence, LegendItem, Tone } from "@/lib/facts/types";

const EVIDENCE_LABEL: Record<Evidence, string> = { rules: "Board fact", engine: "Engine", idea: "Idea" };
const EVIDENCE_TITLE: Record<Evidence, string> = {
  rules: "Follows from the position and the rules alone",
  engine: "Backed by Stockfish's search",
  idea: "A strategic interpretation. The engine hasn't confirmed it",
};

export function EvidenceTag({ e }: { e: Evidence }) {
  return (
    <span className={`ev ev-${e}`} title={EVIDENCE_TITLE[e]}>
      {EVIDENCE_LABEL[e]}
    </span>
  );
}

export function Swatch({ tone, style }: { tone: Tone; style: LegendItem["style"] }) {
  return (
    <svg className="swatch" viewBox="0 0 24 24" aria-hidden>
      <rect x="1" y="1" width="22" height="22" rx="4" className="swatch-sq" />
      {style === "fill" && <rect x="1" y="1" width="22" height="22" rx="4" className={`mk mk-${tone} mk-fill`} />}
      {style === "hatch" && <rect x="1" y="1" width="22" height="22" rx="4" fill={`url(#legend-hatch-${tone})`} />}
      {style === "ring" && <rect x="4" y="4" width="16" height="16" rx="4" className={`mk mk-${tone} mk-ring swatch-ring`} />}
      {style === "dashed" && <rect x="4" y="4" width="16" height="16" rx="4" className={`mk mk-${tone} mk-ring mk-dashed swatch-ring`} />}
      {style === "dot" && <circle cx="12" cy="12" r="4.5" className={`mk mk-${tone} mk-dot`} />}
      {style === "arrow" && (
        <g className={`arrow arrow-${tone}`}>
          <line x1="4" y1="18" x2="15" y2="7" strokeWidth="3" strokeLinecap="round" />
          <polygon points="20,3 11,6 17,12" />
        </g>
      )}
      <defs>
        <pattern id={`legend-hatch-${tone}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className={`hatch-line hatch-${tone}`} strokeWidth="2.5" />
        </pattern>
      </defs>
    </svg>
  );
}

export function EvalChip({ e, big }: { e: Evaluation; big?: boolean }) {
  const mate = e.kind === "mate";
  const lead = e.kind === "mate" ? e.winner : e.cp > 0 ? "w" : e.cp < 0 ? "b" : null;
  return (
    <span className={`evalchip ${mate ? "evalchip-mate" : ""} ${lead ? `evalchip-${lead}` : ""} ${big ? "evalchip-big" : ""}`}>{formatEval(e)}</span>
  );
}

export function EvalBar({ e, orientation, pending }: { e: Evaluation | null; orientation: Color; pending?: boolean }) {
  const share = e ? evalBarShare(e) : 0.5;
  const whitePct = share * 100;
  return (
    <div className={`evalbar evalbar-${orientation} ${pending ? "evalbar-pending" : ""}`} aria-hidden>
      <div className="evalbar-white" style={{ ["--share" as string]: `${whitePct}%` }} />
      <div className="evalbar-mid" />
      {e && <span className={`evalbar-label ${share >= 0.5 ? "evalbar-label-w" : "evalbar-label-b"}`}>{formatEval(e).replace("+", "")}</span>}
    </div>
  );
}

export function EvalHeadline({
  e,
  depth,
  context,
  pending,
}: {
  e: Evaluation | null;
  depth?: number;
  context: string;
  pending?: string;
}) {
  if (!e) {
    return (
      <div className="headline">
        <div className="kicker">{context}</div>
        <div className="headline-text headline-pending">{pending ?? "Waiting for the engine…"}</div>
      </div>
    );
  }
  const v = describeEval(e);
  return (
    <div className={`headline headline-${v.leader ?? "eq"} ${v.strength === "mate" ? "headline-mate" : ""}`}>
      <div className="kicker">{context}</div>
      <div className="headline-row">
        <h2 className="headline-text">{v.headline}</h2>
        <EvalChip e={e} big />
      </div>
      <p className="headline-sub">
        {e.kind === "mate"
          ? `Forced mate: the engine found a sequence that can't be escaped.`
          : `Scores are from White's side: + is good for White, − for Black. 1.00 ≈ one pawn.`}
        {depth ? ` Depth ${depth}.` : ""}
      </p>
    </div>
  );
}
