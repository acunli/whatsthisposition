"use client";

import { useState } from "react";
import type { Color } from "@/lib/chess/types";
import { PLAN_CATEGORY, categoryOrder, type Commentary, type StrategicPlan } from "@/lib/commentary";
import type { Marks } from "@/lib/facts/types";
import type { PlanCard, PlanMeter, PlanPoint } from "@/lib/plans/cards";
import type { PlanVerdict } from "@/lib/plans/timing";
import type { ThreatInfo } from "@/lib/reason/reason";
import { Peek, PeekText } from "../peek/Peek";
import { sideName } from "./bits";
import type { Shown } from "./OverviewPanel";
import type { TimingEntry } from "./usePlanTimings";

interface Props {
  commentary: Commentary;
  turn: Color;
  /** The engine's verdict on the first move of each of the side to move's plans. */
  timings: Record<string, TimingEntry>;
  /** What the board says about a plan's first move, where it was measured (lib/plans/cards). */
  details: Record<string, PlanCard>;
  /** The opponent's threat on the board right now (null: none). */
  threat: ThreatInfo | null;
  bestSan: string | null;
  pinned: string | null;
  onHover: (s: Shown | null) => void;
  onPin: (s: Shown | null) => void;
  onShow: (pv: string[]) => void;
  offRoot: boolean;
  onBackToRoot: () => void;
}

const VERDICT: Record<PlanVerdict, string> = { now: "Good now", prepare: "Prepare first", "not-now": "Not now", later: "Later" };
const METER: [keyof PlanMeter, string][] = [
  ["attack", "Attack"],
  ["defence", "Defence"],
  ["longTerm", "Long-term"],
  ["risk", "Risk"],
];

const drawn = (m: Marks) => m.squares.length + m.arrows.length + (m.bands?.length ?? 0) > 0;
const shown = (id: string, marks: Marks, side: Color, text: string, tone: Shown["tone"] = "idea"): Shown => ({ id, marks, kind: `${sideName(side)}'s plan`, text, tone });

/**
 * What the badge on a plan says. The engine's timing of the plan's first move, unless its
 * main line reaches the plan another way: then the plan is on, and that move just isn't
 * the way in yet.
 */
function badge(p: StrategicPlan, t: TimingEntry | undefined): { text: string; cls: string } {
  if (t === "pending") return { text: "Checking…", cls: "pending" };
  if (t && t.verdict === "now") return { text: VERDICT.now, cls: "now" };
  if (p.engine?.follows === "main") return { text: "In the engine's line", cls: "now" };
  if (t && t.verdict !== "later") return { text: VERDICT[t.verdict], cls: t.verdict };
  if (p.engine?.follows === "other") return { text: "An engine option", cls: "prepare" };
  return { text: "Long-term", cls: "later" };
}

function BoardPoints({ title, items, sign, onHover }: { title: string; items: PlanPoint[]; sign: string; onHover: (m: Marks | null) => void }) {
  if (!items.length) return null;
  return (
    <div>
      <h5 className="eyebrow">{title}</h5>
      <ul className="plist">
        {items.map((p, i) => (
          <li key={i} className={`t-${p.tone}`} onMouseEnter={() => onHover(drawn(p.marks) ? p.marks : null)} onMouseLeave={() => onHover(null)}>
            <b aria-hidden>{sign}</b> {p.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Plans by type, for one side at a time (lib/commentary/plans.ts). The side to move's plans
 * are checked by the engine: is the first move good now, does it need preparing, or does
 * it fail (and to what). Where the plan starts with one concrete move, what that move does
 * on the board is listed under it.
 */
export function StrategyPanel({ commentary, turn, timings, details, threat, bestSan, pinned, onHover, onPin, onShow, offRoot, onBackToRoot }: Props) {
  const [side, setSide] = useState<Color>(turn);
  const plans = commentary.sides[side].plans;
  // The plans come most important first; a type is listed where its best plan stands.
  const groups = categoryOrder
    .map((cat) => ({ cat, plans: plans.filter((p) => p.category === cat) }))
    .filter((g) => g.plans.length)
    .sort((a, b) => plans.indexOf(a.plans[0]) - plans.indexOf(b.plans[0]));
  return (
    <div className="strat desk-body">
      {offRoot && (
        <p className="small muted read-note">
          These are the plans in the position the analysis started from.{" "}
          <button className="linkish" onClick={onBackToRoot}>
            Back to it
          </button>
        </p>
      )}
      {threat && (
        <div
          className="plans-urgent"
          role="note"
          onMouseEnter={() => onHover(shown("threat", threat.marks, turn === "w" ? "b" : "w", threat.label, "danger"))}
          onMouseLeave={() => onHover(null)}
        >
          <b>First things first.</b> {sideName(turn === "w" ? "b" : "w")} threatens <Peek line={threat.line}>{threat.label}</Peek>
          {threat.why ? `, ${threat.why}` : ""}. A plan that ignores it is marked Not now{bestSan ? `; the engine's move is ${bestSan}` : ""}.
        </div>
      )}
      <div className="tabs strat-sides" role="tablist" aria-label="Whose plans">
        {(["w", "b"] as Color[]).map((c) => (
          <button key={c} role="tab" aria-selected={side === c} className={side === c ? "tab tab-on" : "tab"} onClick={() => setSide(c)}>
            {sideName(c)}&apos;s plans
            <span className="count">{commentary.sides[c].plans.length}</span>
          </button>
        ))}
      </div>
      <p className="plans-intro">
        {side === turn
          ? `${sideName(side)} is to move, so the engine checks the first move of each plan: good now, prepare first, or not now and why.`
          : `It is ${sideName(turn)}'s move. These are what ${sideName(side)} is aiming for once it is played.`}
      </p>
      {!groups.length && <p className="muted pad">No plan stands out for {sideName(side)} here: the position is decided by concrete moves, in the Best move tab.</p>}
      {groups.map(({ cat, plans: list }) => (
        <section key={cat} className="strat-group" aria-label={PLAN_CATEGORY[cat].name}>
          <header className="strat-head">
            <h3 className="read-h">{PLAN_CATEGORY[cat].name}</h3>
            <p className="small muted">{PLAN_CATEGORY[cat].about}</p>
          </header>
          <ol className="plan-list">
            {list.map((p) => {
              const t = side === turn ? timings[p.id] : undefined;
              const b = badge(p, t);
              const on = pinned === p.id;
              const whole = shown(p.id, p.marks, p.side, p.title);
              const timing = t && t !== "pending" ? t : null;
              const card = details[p.id];
              return (
                <li key={p.id} className={`pcard pcard-${b.cls} ${on ? "pcard-on" : ""}`}>
                  <button
                    className="pcard-head"
                    aria-pressed={on}
                    onMouseEnter={() => drawn(p.marks) && onHover(whole)}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onPin(on ? null : whole)}
                  >
                    <span className="pcard-titles">
                      <span className="pcard-title">{p.title}</span>
                      {p.keySan && <span className="pcard-kind">starts with {p.keySan}</span>}
                    </span>
                    <span className={`strat-badge strat-badge-${b.cls}`}>{b.text}</span>
                  </button>
                  <p className="strat-why">{p.why}</p>
                  {p.engine?.note && (!timing || timing.verdict !== "now") && (
                    <p className="pcard-when">
                      <PeekText text={p.engine.note} line={p.engine.line} />
                    </p>
                  )}
                  {timing && (
                    <p className="pcard-when">
                      <PeekText text={timing.text} lines={timing.lines} />
                    </p>
                  )}
                  <ol className="strat-steps">
                    {p.steps.map((s, i) => (
                      <li key={i} onMouseEnter={() => drawn(s.marks) && onHover(shown(`${p.id}-${i}`, s.marks, p.side, p.title))} onMouseLeave={() => onHover(null)}>
                        {s.text}
                      </li>
                    ))}
                  </ol>
                  {p.risk && (
                    <p className="strat-risk">
                      <b>Watch out.</b> {p.risk}
                    </p>
                  )}
                  {card && (card.benefits.length > 0 || card.drawbacks.length > 0) && (
                    <details className="strat-more">
                      <summary>What {card.keySan ?? "the first move"} does on the board</summary>
                      <div className="pmeter" aria-label="Character of the move">
                        {METER.map(([k, label]) => (
                          <div key={k} className={`pmeter-row pmeter-${k}`}>
                            <span>{label}</span>
                            <span className="pmeter-track">
                              <span style={{ width: `${Math.round(card.meter[k] * 100)}%` }} />
                            </span>
                          </div>
                        ))}
                      </div>
                      <div className="pcard-cols">
                        <BoardPoints title="For it" items={card.benefits} sign="+" onHover={(m) => onHover(m ? shown(`${p.id}-pt`, m, p.side, p.title) : null)} />
                        <BoardPoints title="Against it" items={card.drawbacks} sign="−" onHover={(m) => onHover(m ? shown(`${p.id}-pt`, m, p.side, p.title, "danger") : null)} />
                      </div>
                    </details>
                  )}
                  {timing?.pv && (
                    <button className="btn btn-sm btn-ghost strat-show" onClick={() => onShow(timing.pv!)}>
                      ▶ Play it on the board
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
