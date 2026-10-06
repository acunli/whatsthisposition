"use client";

import type { Marks } from "@/lib/facts/types";
import type { SacrificeExplanation } from "@/lib/reason/sacrifice";
import { PeekText } from "../peek/Peek";

const hasMarks = (m: Marks) => m.arrows.length > 0 || m.squares.length > 0 || (m.bands?.length ?? 0) > 0;

/** Why a Brilliant move works, step by step: what's given, what it does, each way of taking, the obvious move. */
export function WhyBrilliant({ x, onHover }: { x: SacrificeExplanation; onHover: (m: Marks | null) => void }) {
  return (
    <>
      <p className="rv-section">Why it&apos;s brilliant</p>
      <ol className="rv-steps">
        {x.steps.map((st, i) => (
          <li key={i} className={`t-${st.tone}`} onMouseEnter={() => onHover(hasMarks(st.marks) ? st.marks : null)} onMouseLeave={() => onHover(null)}>
            <b>{st.title}</b>
            <span>
              <PeekText text={st.text} line={st.lines ? undefined : st.line} lines={st.lines} />
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}

