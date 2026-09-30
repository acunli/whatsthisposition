"use client";

import type { Color } from "@/lib/chess/types";
import type { Advice } from "@/lib/facts/advice";
import type { Ledger, LedgerEntry } from "@/lib/facts/ledger";
import type { Fact } from "@/lib/facts/types";
import { EvidenceTag, sideName } from "./bits";

interface Props {
  ledger: Ledger;
  advice: Record<Color, Advice[]>;
  selected: string | null;
  onHover: (f: Fact | null) => void;
  onSelect: (f: Fact | null) => void;
  turn: Color;
}

const KIND_LABEL: Record<Advice["kind"], string> = { now: "Now", fix: "Fix", attack: "Attack", use: "Use" };
const KIND_TONE: Record<Advice["kind"], string> = { now: "t-white", fix: "t-danger", attack: "t-danger", use: "t-opportunity" };

function Entries({ items, tone, selected, onHover, onSelect }: { items: LedgerEntry[]; tone: string } & Pick<Props, "selected" | "onHover" | "onSelect">) {
  if (!items.length) return <p className="entry-none">Nothing notable.</p>;
  return (
    <ul className="entries">
      {items.slice(0, 7).map((e) => (
        <li key={e.fact.id}>
          <button
            className={`entry ${tone} ${selected === e.fact.id ? "entry-on" : ""}`}
            onMouseEnter={() => onHover(e.fact)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => onHover(e.fact)}
            onBlur={() => onHover(null)}
            onClick={() => onSelect(selected === e.fact.id ? null : e.fact)}
            title={e.fact.title}
          >
            {e.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function LedgerPanel({ ledger, advice, selected, onHover, onSelect, turn }: Props) {
  return (
    <div className="desk-body" style={{ display: "grid", gap: 12 }}>
      <div className="ledger">
        {(["w", "b"] as Color[]).map((c) => (
          <div key={c} className="ledger-col">
            <h3 className="ledger-side">
              <span className={`side-dot side-${c}`} aria-hidden />
              {sideName(c)}
            </h3>
            <div className="ledger-group t-opportunity">
              <h4>
                <span>Strengths</span>
                <span>{ledger[c].strengths.length}</span>
              </h4>
              <Entries items={ledger[c].strengths} tone="t-opportunity" selected={selected} onHover={onHover} onSelect={onSelect} />
            </div>
            <div className="ledger-group t-danger">
              <h4>
                <span>Weaknesses</span>
                <span>{ledger[c].weaknesses.length}</span>
              </h4>
              <Entries items={ledger[c].weaknesses} tone="t-danger" selected={selected} onHover={onHover} onSelect={onSelect} />
            </div>
          </div>
        ))}
      </div>

      <div className="advice">
        <h3>What each side should try</h3>
        <div className="advice-cols">
          {(["w", "b"] as Color[]).map((c) => (
            <div key={c}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                {sideName(c)}
                {turn === c ? " · to move" : ""}
              </div>
              {advice[c].length ? (
                <ol className="advice-list">
                  {advice[c].map((a) => (
                    <li key={a.id}>
                      <button
                        className="advice-item"
                        onMouseEnter={() => onHover(a.fact ?? null)}
                        onMouseLeave={() => onHover(null)}
                        onClick={() => a.fact && onSelect(selected === a.fact.id ? null : a.fact)}
                      >
                        <span className={`advice-kind ${KIND_TONE[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                        <span>{a.text}</span>
                        <EvidenceTag e={a.evidence} />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="entry-none">No clear plan stands out. Improve piece placement.</p>
              )}
            </div>
          ))}
        </div>
        <p className="small muted" style={{ margin: "10px 0 0" }}>
          Advice is built from the ledger above. “Engine” items come from Stockfish; “Idea” items are plans worth testing, not guarantees.
        </p>
      </div>
    </div>
  );
}
