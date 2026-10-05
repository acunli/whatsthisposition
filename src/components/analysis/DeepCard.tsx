"use client";

import type { DeepMove } from "@/lib/deep/deep";
import { CLASS_INFO } from "@/lib/review/classify";
import { ClassIcon } from "../review/ClassIcon";
import type { Marks } from "@/lib/facts/types";
import { PeekText } from "../peek/Peek";
import { EvalChip, EvidenceTag, sideName } from "./bits";
import type { DeepEntry } from "./useAnalysis";

interface Props {
  entry: DeepEntry | null;
  onHoverMarks: (m: Marks | null) => void;
  /** Play a line from the analysed position (UCI moves) and show it at `ply`. */
  onPlay: (pv: string[], ply: number, title: string) => void;
  onClose?: () => void;
}

export function ClassBadge({ d }: { d: Pick<DeepMove, "classification"> }) {
  const k = d.classification.kind;
  return (
    <span className="cls" style={{ ["--cls" as string]: CLASS_INFO[k].color }}>
      <ClassIcon cls={k} size={16} />
      {d.classification.label}
    </span>
  );
}

export function DeepCard({ entry, onHoverMarks, onPlay, onClose }: Props) {
  if (!entry || entry.status === "pending") {
    return (
      <aside className="deep deep-pending" aria-live="polite">
        <div className="deep-scan" aria-hidden />
        <p className="eyebrow">Looking deeper</p>
        <p className="deep-step">{entry?.status === "pending" ? entry.step : "Waiting for the engine"}…</p>
        <p className="small muted">Side lines are searched at depth 16+ so sacrifices aren&apos;t misjudged.</p>
      </aside>
    );
  }
  if (entry.status === "failed") {
    return (
      <aside className="deep">
        <p className="issue">The deeper look didn&apos;t finish (the engine was stopped or restarted). Re-run the analysis to try again.</p>
      </aside>
    );
  }
  const d = entry.data;
  const hover = (m: Marks | null) => onHoverMarks(m && (m.arrows.length || m.squares.length) ? m : null);

  return (
    <aside className={`deep deep-${d.classification.kind}`} aria-live="polite">
      <header className="deep-head">
        <div>
          <ClassBadge d={d} />
          <h3 className="deep-san">
            {d.label}
            {d.classification.symbol}
          </h3>
        </div>
        <div className="deep-head-r">
          <EvalChip e={d.eval} />
          {onClose && (
            <button className="linkish" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </header>
      <p className="deep-headline">{d.headline}</p>

      {d.points.length > 0 && (
        <section className="deep-sec">
          <h4>What it does</h4>
          <ul className="points">
            {d.points.map((p, i) => (
              <li key={i} className={`point t-${p.tone}`} onMouseEnter={() => hover(p.marks)} onMouseLeave={() => hover(null)}>
                <span className={`fact-mark t-${p.tone}`} aria-hidden />
                <span>
                  <PeekText text={p.text} line={p.line} lines={p.lines} />
                </span>
                <EvidenceTag e={p.evidence} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.offers.map((o) => (
        <section key={o.uci} className={`deep-sec deep-offer ${o.poisoned ? "deep-poison" : ""}`} onMouseEnter={() => hover(o.marks)} onMouseLeave={() => hover(null)}>
          <h4>
            {o.existing ? `Why not just take on ${o.capturedOn}?` : `${o.poisoned ? "Poisoned: " : ""}what if ${sideName(d.mover === "w" ? "b" : "w")} takes?`}
          </h4>
          <p>{o.text}</p>
          <div className="deep-line">
            {o.sans.slice(0, 8).map((s, i) => (
              <button key={i} className="mv" onClick={() => onPlay([d.uci, ...o.pv], i + 2, `If ${o.san}`)}>
                {s}
              </button>
            ))}
          </div>
          <div className="row">
            <button className="btn btn-sm" onClick={() => onPlay([d.uci, ...o.pv], o.showPly, `If ${o.san}`)}>
              ▶ Show the refutation
            </button>
            <EvidenceTag e="engine" />
          </div>
        </section>
      ))}

      {d.threat && (
        <section className="deep-sec" onMouseEnter={() => hover(d.threat!.marks)} onMouseLeave={() => hover(null)}>
          <h4>The threat</h4>
          <p>{d.threat.text}</p>
          <EvidenceTag e="engine" />
        </section>
      )}

      {d.reply && (
        <section className="deep-sec">
          <h4>Best reply</h4>
          <p>
            <b>{d.reply.label}</b>: {d.reply.text}
          </p>
        </section>
      )}

      {d.moments.length > 0 && (
        <section className="deep-sec">
          <h4>How the line unfolds</h4>
          <ol className="moments">
            {d.moments.map((m) => (
              <li key={m.ply}>
                <button
                  className={`moment t-${m.tone}`}
                  onMouseEnter={() => hover(m.marks)}
                  onMouseLeave={() => hover(null)}
                  onClick={() => onPlay(d.pv, m.ply, "")}
                >
                  <b>{m.label}</b>
                  <span>{m.text}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="deep-sec deep-verdict">
        <p>{d.outcome}</p>
        {d.comparison && <p>{d.comparison.text}</p>}
        <EvidenceTag e="engine" />
      </section>
    </aside>
  );
}
