"use client";

import type { Color } from "@/lib/chess/types";
import { evalBarShare, formatEval, type Evaluation } from "@/lib/engine/score";
import type { Evidence, LegendItem, Tone } from "@/lib/facts/types";

const EVIDENCE_LABEL: Record<Evidence, string> = { rules: "Board fact", engine: "Engine", idea: "Idea" };
const EVIDENCE_TITLE: Record<Evidence, string> = {
  rules: "Follows from the position and the rules alone",
  engine: "Backed by Stockfish's search",
  idea: "A strategic interpretation the engine hasn't confirmed",
};

export function EvidenceTag({ e }: { e: Evidence }) {
  return (
    <span className={`ev ev-${e}`} title={EVIDENCE_TITLE[e]}>
      {EVIDENCE_LABEL[e]}
    </span>
  );
}

/** A tiny board square showing how a legend item looks on the board. */
export function Swatch({ tone, style }: { tone: Tone; style: LegendItem["style"] }) {
  if (style === "arrow") {
    return (
      <span className={`swatch t-${tone}`} aria-hidden>
        <svg viewBox="0 0 18 18" width="18" height="18" style={{ position: "absolute", inset: 0 }}>
          <path d="M3 14 L12 5" stroke={`rgb(var(--tc))`} strokeWidth="3" strokeLinecap="round" />
          <polygon points="15,2 9,4 14,9" fill="rgb(var(--tc))" />
        </svg>
      </span>
    );
  }
  return (
    <span className="swatch" aria-hidden>
      <span className={`ov ov-${style} t-${tone}`} />
    </span>
  );
}

export function EvalChip({ e }: { e: Evaluation }) {
  const mate = e.kind === "mate";
  const lead = e.kind === "mate" ? e.winner : e.cp > 0 ? "w" : e.cp < 0 ? "b" : null;
  return <span className={`evalchip ${mate ? "evalchip-mate" : lead ? `evalchip-${lead}` : ""}`}>{formatEval(e)}</span>;
}

/** Vertical evaluation bar that sits beside the board; White's share grows from White's side. */
export function EvalBar({ e, orientation }: { e: Evaluation | null; orientation: Color }) {
  const share = e ? evalBarShare(e) : 0.5;
  const text = e ? formatEval(e).replace("+", "") : "…";
  const whiteAhead = share >= 0.5;
  return (
    <div className={`vbar vbar-${orientation} ${e ? "" : "vbar-pending"} ${e?.kind === "mate" ? "vbar-mate" : ""}`} role="meter" aria-label={`Evaluation ${e ? formatEval(e) : "pending"}`} aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="vbar-white" style={{ ["--share" as string]: `${share * 100}%` }} />
      <div className="vbar-mid" />
      <span className={`vbar-label ${whiteAhead ? "vbar-label-w" : "vbar-label-b"}`}>{text}</span>
    </div>
  );
}

export interface CaptionData {
  tone: Tone;
  tag: string;
  kind: string;
  text: string;
  key: string;
}

/** Broadcast-style lower third under the board. */
export function Caption({ c }: { c: CaptionData | null }) {
  if (!c) return <div className="lower-third" />;
  return (
    <div className="lower-third" aria-live="polite">
      <div key={c.key} className={`caption t-${c.tone === "info" ? "white" : c.tone}`}>
        <span className="caption-tag">{c.tag}</span>
        <span className="caption-kind">{c.kind}</span>
        <span className="caption-text">{c.text}</span>
      </div>
    </div>
  );
}

export const sideName = (c: Color) => (c === "w" ? "White" : "Black");
