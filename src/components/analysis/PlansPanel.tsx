"use client";

import type { Color } from "@/lib/chess/types";
import type { Marks } from "@/lib/facts/types";
import { PLAN_KIND_LABEL, type PlanCard, type PlanMeter, type PlanPoint } from "@/lib/plans/cards";
import type { PlanVerdict } from "@/lib/plans/timing";
import type { ThreatInfo } from "@/lib/reason/reason";
import { Peek, PeekText } from "../peek/Peek";
import { EvidenceTag, sideName } from "./bits";
import type { TimingEntry } from "./usePlanTimings";

interface Props {
  cards: PlanCard[];
  timings: Record<string, TimingEntry>;
  turn: Color;
  /** The opponent's threat on the board right now (null: none). */
  threat: ThreatInfo | null;
  bestSan: string | null;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onHoverPoint: (m: Marks | null) => void;
  onShow: (pv: string[]) => void;
}

const VERDICT: Record<PlanVerdict, string> = { now: "Good now", prepare: "Prepare first", "not-now": "Not now", later: "Later" };
const METER: [keyof PlanMeter, string][] = [
  ["attack", "Attack"],
  ["defence", "Defence"],
  ["longTerm", "Long-term"],
  ["risk", "Risk"],
];

function Meter({ m }: { m: PlanMeter }) {
  return (
    <div className="pmeter" aria-label="Plan character">
      {METER.map(([k, label]) => (
        <div key={k} className={`pmeter-row pmeter-${k}`}>
          <span>{label}</span>
          <span className="pmeter-track">
            <span style={{ width: `${Math.round(m[k] * 100)}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}

function List({ items, onHoverPoint, sign }: { items: PlanPoint[]; onHoverPoint: Props["onHoverPoint"]; sign: string }) {
  return (
    <ul className="plist">
      {items.map((p, i) => (
        <li key={i} className={`t-${p.tone}`} onMouseEnter={() => onHoverPoint(p.marks.arrows.length || p.marks.squares.length || p.marks.bands?.length ? p.marks : null)} onMouseLeave={() => onHoverPoint(null)}>
          <b aria-hidden>{sign}</b> {p.text} {p.evidence !== "rules" && <EvidenceTag e={p.evidence} />}
        </li>
      ))}
    </ul>
  );
}

export function PlansPanel({ cards, timings, turn, threat, bestSan, focus, onFocus, onHover, onHoverPoint, onShow }: Props) {
  if (!cards.length) return <p className="muted pad">No clear pawn breaks, piece routes, rook lifts or castling plans stand out right now.</p>;
  const order = (c: PlanCard) => {
    const t = timings[c.id];
    const v = t && t !== "pending" ? t.verdict : "later";
    return (c.side === turn ? 0 : 10) + { now: 0, prepare: 1, "not-now": 2, later: 3 }[v];
  };
  const sorted = [...cards].sort((a, b) => order(a) - order(b));
  return (
    <div className="plans">
      {threat && (
        <div className="plans-urgent" role="note" onMouseEnter={() => onHoverPoint(threat.marks)} onMouseLeave={() => onHoverPoint(null)}>
          <b>First things first.</b> {sideName(turn === "w" ? "b" : "w")} threatens <Peek line={threat.line}>{threat.label}</Peek>
          {threat.why ? `, ${threat.why}` : ""}. Plans that ignore it are marked Not now{bestSan ? `; the engine's move is ${bestSan}` : ""}.
        </div>
      )}
      <p className="plans-intro">
        Plans for both sides. For {sideName(turn)}, the side to move, each one is checked by the engine: good now, prepare first, or not now (and why). Hover a reason to see it on the board.
      </p>
      <ol className="plan-list">
        {sorted.map((c) => {
          const t = timings[c.id];
          const on = focus === c.id;
          const verdict: PlanVerdict | "pending" = t === "pending" ? "pending" : (t?.verdict ?? "later");
          return (
            <li key={c.id} className={`pcard pcard-${verdict} ${on ? "pcard-on" : ""}`} onMouseEnter={() => onHover(c.id)} onMouseLeave={() => onHover(null)}>
              <button className="pcard-head" onClick={() => onFocus(on ? null : c.id)} aria-expanded={on}>
                <span className={`side-dot side-${c.side}`} aria-hidden />
                <span className="pcard-titles">
                  <span className="pcard-kind">
                    {sideName(c.side)} · {PLAN_KIND_LABEL[c.kind]} · {c.style}
                  </span>
                  <span className="pcard-title">{c.title}</span>
                </span>
                <span className={`pverdict pverdict-${verdict}`}>{verdict === "pending" ? "Checking…" : VERDICT[verdict]}</span>
              </button>
              {t && t !== "pending" && (
                <p className="pcard-when">
                  <PeekText text={t.text} lines={t.lines} />
                </p>
              )}
              <Meter m={c.meter} />
              <div className="pcard-cols">
                {c.benefits.length > 0 && (
                  <div>
                    <h4>Why</h4>
                    <List items={c.benefits} onHoverPoint={onHoverPoint} sign="+" />
                  </div>
                )}
                {c.drawbacks.length > 0 && (
                  <div>
                    <h4>But</h4>
                    <List items={c.drawbacks} onHoverPoint={onHoverPoint} sign="−" />
                  </div>
                )}
              </div>
              {t && t !== "pending" && t.pv && (
                <button className="btn btn-sm btn-ghost" onClick={() => onShow(t.pv!)}>
                  ▶ Show it on the board
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
