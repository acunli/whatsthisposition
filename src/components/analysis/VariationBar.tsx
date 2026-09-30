"use client";

import { evalBarShare, formatEval, type Evaluation } from "@/lib/engine/score";
import { formatLine, type Variation, type NavAction } from "@/lib/variation";

interface Props {
  variation: Variation | null;
  ply: number;
  onNav: (a: NavAction) => void;
  evals: (Evaluation | null)[];
  title: string;
  onClose?: () => void;
}

export function VariationBar({ variation, ply, onNav, evals, title, onClose }: Props) {
  if (!variation) {
    return (
      <div className="varbar varbar-empty">
        <p>Pick a candidate move to play it out here, or tap one of your pieces and then a square to try your own idea.</p>
      </div>
    );
  }
  const tokens = formatLine(variation);
  const n = variation.moves.length;
  return (
    <div className="varbar">
      <div className="varbar-head">
        <span className="kicker">{title}</span>
        {onClose && (
          <button className="linkish" onClick={onClose}>
            Back to the position
          </button>
        )}
      </div>
      <div className="varbar-row">
        <div className="stepper" role="group" aria-label="Step through the line">
          <button className="step-btn" onClick={() => onNav("first")} disabled={ply === 0} aria-label="Start of line">
            ⏮
          </button>
          <button className="step-btn" onClick={() => onNav("prev")} disabled={ply === 0} aria-label="Previous move">
            ◀
          </button>
          <button className="step-btn step-main" onClick={() => onNav("next")} disabled={ply === n} aria-label="Next move">
            ▶
          </button>
          <button className="step-btn" onClick={() => onNav("last")} disabled={ply === n} aria-label="End of line">
            ⏭
          </button>
        </div>
        <ol className="moves">
          <li>
            <button className={ply === 0 ? "mv mv-on" : "mv"} onClick={() => onNav({ goto: 0 })}>
              start
            </button>
          </li>
          {tokens.map((t) => (
            <li key={t.ply}>
              <button className={ply === t.ply ? "mv mv-on" : "mv"} onClick={() => onNav({ goto: t.ply })}>
                {t.label}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <EvalStrip evals={evals} ply={ply} onPick={(p) => onNav({ goto: p })} />
    </div>
  );
}

/** Evaluation after each move of the line (quick engine checks). Gaps are still being computed. */
function EvalStrip({ evals, ply, onPick }: { evals: (Evaluation | null)[]; ply: number; onPick: (p: number) => void }) {
  const n = evals.length;
  if (n < 2) return null;
  const W = 300;
  const H = 54;
  const x = (i: number) => (i / (n - 1)) * (W - 16) + 8;
  const y = (e: Evaluation) => H - 6 - evalBarShare(e) * (H - 12);
  const pts = evals.map((e, i) => (e ? `${x(i)},${y(e)}` : null));
  const segments: string[][] = [[]];
  pts.forEach((p) => (p ? segments[segments.length - 1].push(p) : segments.push([])));
  const cur = evals[ply];
  const known = evals.filter(Boolean).length;
  return (
    <figure className="evalstrip">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Evaluation after each move of the line">
        <rect x="0" y="0" width={W} height={H / 2} className="evalstrip-w" />
        <rect x="0" y={H / 2} width={W} height={H / 2} className="evalstrip-b" />
        <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="evalstrip-mid" />
        {segments.filter((s) => s.length > 1).map((s, i) => (
          <polyline key={i} points={s.join(" ")} className="evalstrip-line" />
        ))}
        {evals.map((e, i) =>
          e ? (
            <circle key={i} cx={x(i)} cy={y(e)} r={i === ply ? 5 : 3} className={i === ply ? "evalstrip-dot evalstrip-cur" : "evalstrip-dot"} onClick={() => onPick(i)} />
          ) : (
            <circle key={i} cx={x(i)} cy={H / 2} r={2.5} className="evalstrip-pending" />
          ),
        )}
        <line x1={x(ply)} x2={x(ply)} y1={0} y2={H} className="evalstrip-cursor" />
      </svg>
      <figcaption>
        {cur ? (
          <>
            After this move: <b className="mono">{formatEval(cur)}</b>
          </>
        ) : (
          "Checking this move…"
        )}
        <span className="muted">
          {" "}
          · quick check at depth 12{known < n ? ` · ${n - known} to go` : ""}
        </span>
      </figcaption>
    </figure>
  );
}
