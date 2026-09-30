"use client";

import type { Plan } from "@/lib/facts/plans";
import { EvidenceTag } from "./bits";

interface Props {
  plans: Plan[];
  focus: string | null;
  onFocus: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

export function PlansPanel({ plans, focus, onFocus, onHover }: Props) {
  if (!plans.length) return <p className="muted pad">No clear pawn breaks, piece routes or rook lifts stand out from the structure.</p>;
  return (
    <div className="plans">
      <p className="plans-intro">
        Ideas that could follow. Each one lists what it depends on, checked against the current board. Only the ones marked <EvidenceTag e="engine" /> appear in an engine line.
      </p>
      <ol className="plan-list">
        {plans.map((p) => {
          const on = focus === p.id;
          const met = p.conditions.filter((c) => c.met).length;
          return (
            <li key={p.id} className={on ? "plan plan-on" : "plan"}>
              <button
                className="plan-btn"
                onClick={() => onFocus(on ? null : p.id)}
                onMouseEnter={() => onHover(p.id)}
                onMouseLeave={() => onHover(null)}
                aria-expanded={on}
              >
                <span className={`side-dot side-${p.side}`} aria-hidden />
                <span className="plan-title">{p.title}</span>
                <EvidenceTag e={p.evidence} />
              </button>
              <ul className="conds">
                {p.conditions.map((c) => (
                  <li key={c.text} className={c.met ? "cond cond-met" : "cond cond-unmet"}>
                    <span aria-hidden>{c.met ? "✓" : "○"}</span> {c.text}
                  </li>
                ))}
              </ul>
              <p className="plan-foot">
                {met === p.conditions.length ? "Conditions hold right now." : `${p.conditions.length - met} condition${p.conditions.length - met > 1 ? "s" : ""} still to arrange.`}
                {p.engineNote ? ` ${p.engineNote}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
