"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoardStage } from "../BoardStage";
import { placementFromFen } from "@/lib/chess/fen";
import { computeFacts, mergeMarks, type Fact, type Marks } from "@/lib/facts";
import { buildLedger } from "@/lib/facts/ledger";
import { findPlans } from "@/lib/facts/plans";
import { emptyMarks } from "@/lib/facts/types";

/**
 * A typical isolated-queen's-pawn middlegame. Every line below is computed live
 * from the board by the same code that reads uploaded positions; nothing is written by hand.
 */
export const STORY_FEN = "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10";
const FEN = STORY_FEN;

interface Step {
  n: string;
  title: string;
  accent: string;
  tone: string;
  lines: { text: string; tone: string }[];
  marks: Marks;
  fen: string;
}

function buildSteps(): Step[] {
  const facts = computeFacts(FEN);
  const ledger = buildLedger(facts);
  const threats = facts.byLens.threats.slice(0, 3);
  const weak = [...ledger.w.weaknesses.slice(0, 2), ...ledger.b.weaknesses.slice(0, 2)];
  const strong = [...ledger.w.strengths.slice(0, 2), ...ledger.b.strengths.slice(0, 2)];
  const plans = findPlans(facts.ctx).slice(0, 3);
  const line = (f: Fact) => ({ text: f.title, tone: f.tone });

  const steps: Step[] = [
    {
      n: "01",
      title: "What's under attack",
      accent: "right now?",
      tone: "t-danger",
      lines: threats.length ? threats.map(line) : [{ text: "Nothing is hanging and no piece is attacked by something cheaper: a quiet position.", tone: "info" }],
      marks: mergeMarks(...threats.map((f) => f.marks)),
      fen: FEN,
    },
    {
      n: "02",
      title: "Where are the",
      accent: "weaknesses?",
      tone: "t-danger",
      lines: weak.map((e) => ({ text: e.fact.title, tone: "danger" })),
      marks: mergeMarks(...weak.map((e) => e.fact.marks)),
      fen: FEN,
    },
    {
      n: "03",
      title: "What's working",
      accent: "for each side?",
      tone: "t-opportunity",
      lines: strong.map((e) => ({ text: e.fact.title, tone: "opportunity" })),
      marks: mergeMarks(...strong.map((e) => e.fact.marks)),
      fen: FEN,
    },
    {
      n: "04",
      title: "What could",
      accent: "happen next?",
      tone: "t-idea",
      lines: plans.map((p) => ({ text: `${p.title} ${p.conditions.filter((c) => !c.met).length ? "Needs: " + p.conditions.filter((c) => !c.met).map((c) => c.text).join("; ") + "." : "Conditions hold now."}`, tone: "idea" })),
      marks: mergeMarks(...plans.map((p) => p.marks)),
      fen: FEN,
    },
  ];
  return steps.filter((s) => s.lines.length);
}

export function Story({ onTry }: { onTry: (fen: string) => void }) {
  const steps = useMemo(() => buildSteps(), []);
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const placement = useMemo(() => placementFromFen(steps[active].fen), [steps, active]);
  const s = steps[active];

  return (
    <section className="story">
      <div className="story-head">
        <div className="eyebrow">One position, read four ways · computed live</div>
        <h2 className="h-section">
          How a strong player <em>reads</em> a board.
        </h2>
      </div>
      <div className="story-grid">
        <div className="story-board">
          <div className="story-board-inner">
            <BoardStage placement={placement} orientation="w" marks={s.marks ?? emptyMarks()} revealKey={`story-${active}`} label="An isolated queen's pawn position" />
            <div className="story-progress">
              {steps.map((st, k) => (
                <span key={st.n} className={k === active ? "on" : k < active ? "done" : ""} />
              ))}
            </div>
          </div>
        </div>
        <div className="story-steps">
          {steps.map((st, k) => (
            <article
              key={st.n}
              ref={(el) => {
                refs.current[k] = el;
              }}
              data-i={k}
              className={`story-step ${st.tone} ${k === active ? "story-step-on" : ""}`}
            >
              <span className="story-n">{st.n}</span>
              <h3>
                {st.title} <em>{st.accent}</em>
              </h3>
              <ul>
                {st.lines.map((l, j) => (
                  <li key={j} className={`t-${l.tone}`}>
                    {l.text}
                  </li>
                ))}
              </ul>
              {k === steps.length - 1 && (
                <button className="btn btn-gold" onClick={() => onTry(FEN)}>
                  Explore this position with the engine →
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
