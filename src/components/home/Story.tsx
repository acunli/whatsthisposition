"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BoardStage } from "../BoardStage";
import { placementFromFen } from "@/lib/chess/fen";
import { computeFacts, mergeMarks, type Fact, type Marks } from "@/lib/facts";
import { staticMovePoints } from "@/lib/facts/explain";
import { buildLedger } from "@/lib/facts/ledger";
import { findPlans } from "@/lib/facts/plans";
import { emptyMarks } from "@/lib/facts/types";
import { buildVariation } from "@/lib/variation";

/** The owner's reference position: 43.g4!! (verified by src/lib/deep/deep.test.ts against Stockfish). */
const FEN = "7r/1pp1nk2/2n2p2/1bPp2q1/3P3p/rPB2RP1/5Q1P/2NBR1K1 w - - 3 43";

interface Step {
  n: string;
  title: string;
  accent: string;
  tone: string;
  lines: { text: string; tone: string }[];
  marks: Marks;
  fen: string;
  lastMove?: { from: "g3"; to: "g4" };
}

function buildSteps(): Step[] {
  const facts = computeFacts(FEN);
  const ledger = buildLedger(facts);
  const threats = facts.byLens.threats.slice(0, 3);
  const weak = [...ledger.b.weaknesses.slice(0, 3), ...ledger.w.weaknesses.slice(0, 1)];
  const strong = [...ledger.w.strengths.slice(0, 3), ...ledger.b.strengths.slice(0, 1)];
  const plans = findPlans(facts.ctx).slice(0, 2);
  const g4 = buildVariation(FEN, ["g3g4"]).moves[0];
  const g4pts = staticMovePoints(g4).filter((p) => p.tone === "opportunity");
  const line = (f: Fact) => ({ text: f.title, tone: f.tone });
  const moveMarks = mergeMarks(...g4pts.map((p) => p.marks));
  moveMarks.arrows.unshift({ from: "g3", to: "g4", tone: "opportunity" });

  return [
    {
      n: "01",
      title: "What's under attack",
      accent: "right now?",
      tone: "t-danger",
      lines: threats.map(line),
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
    {
      n: "05",
      title: "And the move:",
      accent: "43.g4!!",
      tone: "t-white",
      lines: [
        ...g4pts.map((p) => ({ text: p.text, tone: "opportunity" })),
        {
          text: "Stockfish's side lines show the pawn is poisoned: 43…Qxg4+ 44.Kh1 and Rg3 hits the queen, which is even better for White than when Black declines.",
          tone: "white",
        },
      ],
      marks: moveMarks,
      fen: g4.fenAfter,
      lastMove: { from: "g3", to: "g4" },
    },
  ];
}

export function Story({ onTry }: { onTry: () => void }) {
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
        <div className="eyebrow">A real position, read five ways</div>
        <h2 className="h-section">
          How a strong player <em>reads</em> a board.
        </h2>
      </div>
      <div className="story-grid">
        <div className="story-board">
          <div className="story-board-inner">
            <BoardStage placement={placement} orientation="w" marks={s.marks ?? emptyMarks()} revealKey={`story-${active}`} lastMove={s.lastMove ?? null} label="The g4 position" />
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
                <button className="btn btn-gold" onClick={onTry}>
                  Explore this position live →
                </button>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
