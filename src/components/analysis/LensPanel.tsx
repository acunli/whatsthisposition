"use client";

import { useState } from "react";
import { LENSES, type Fact, type LensId, type PositionFacts } from "@/lib/facts";
import { materialSummary, MATERIAL_ORDER } from "@/lib/facts/material";
import { pawnSummary } from "@/lib/facts/pawns";
import { EvidenceTag, Swatch } from "./bits";

interface Props {
  facts: PositionFacts;
  active: LensId[];
  onToggle: (id: LensId) => void;
  onClean: () => void;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onHover: (id: string | null) => void;
  extraThreats: Fact[];
}

const LENS_GLYPH: Record<LensId, string> = {
  threats: "M4 20L20 4M20 4h-7M20 4v7",
  king: "M12 3v4M10 5h4M7 21h10l1-8-4 3-2-5-2 5-4-3z",
  pawns: "M12 4a3 3 0 110 6 3 3 0 010-6zM8 20h8l-1.5-6h-5z",
  activity: "M4 16l5-5 4 4 7-8",
  control: "M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7",
  material: "M4 18h16M6 18V9M12 18V5M18 18v-6",
};

export function LensPanel({ facts, active, onToggle, onClean, focus, onFocus, onHover, extraThreats }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const clean = active.length === 0;

  return (
    <div className="lenses">
      <div className="lensbar" role="group" aria-label="Board lenses">
        {LENSES.map((l) => {
          const on = active.includes(l.id);
          return (
            <button key={l.id} className={on ? "lens lens-on" : "lens"} aria-pressed={on} onClick={() => onToggle(l.id)} title={l.question}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d={LENS_GLYPH[l.id]} />
              </svg>
              <span>{l.short}</span>
            </button>
          );
        })}
        <button className={clean ? "lens lens-clean lens-on" : "lens lens-clean"} onClick={onClean} aria-pressed={clean} title="Hide all annotations">
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M4 4h16v16H4z" />
          </svg>
          <span>Clean</span>
        </button>
      </div>

      {clean && <p className="lens-empty">Clean board. Turn on a lens to see what matters, or tap any piece to trace its attacks and defenders.</p>}

      {LENSES.filter((l) => active.includes(l.id)).map((l) => {
        const list = l.id === "threats" ? [...extraThreats, ...facts.byLens.threats] : facts.byLens[l.id];
        const showAll = expanded[l.id];
        const shown = showAll ? list : list.slice(0, 6);
        return (
          <section key={l.id} className="lens-section">
            <header className="lens-head">
              <h3>{l.label}</h3>
              <p>{l.question}</p>
            </header>
            <ul className="legend" aria-label={`${l.label} legend`}>
              {l.legend.map((item) => (
                <li key={item.label}>
                  <Swatch tone={item.tone} style={item.style} />
                  {item.label}
                </li>
              ))}
            </ul>
            {l.id === "material" && <MaterialStrip facts={facts} />}
            {l.id === "pawns" && <p className="lens-summary">{pawnSummary(facts.ctx.p)}</p>}
            {list.length === 0 ? (
              <p className="lens-none">Nothing notable here in this position.</p>
            ) : (
              <ol className="facts">
                {shown.map((f) => {
                  const isFocus = focus === f.id;
                  return (
                    <li key={f.id} className={`fact fact-${f.tone} ${isFocus ? "fact-focus" : ""}`}>
                      <button
                        className="fact-btn"
                        onClick={() => onFocus(isFocus ? null : f.id)}
                        onMouseEnter={() => onHover(f.id)}
                        onMouseLeave={() => onHover(null)}
                        onFocus={() => onHover(f.id)}
                        onBlur={() => onHover(null)}
                        aria-expanded={isFocus}
                      >
                        <span className={`fact-mark fact-mark-${f.tone}`} aria-hidden />
                        <span className="fact-title">{f.title}</span>
                        <EvidenceTag e={f.evidence} />
                      </button>
                      {isFocus && f.detail && <p className="fact-detail">{f.detail}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
            {list.length > 6 && (
              <button className="linkish" onClick={() => setExpanded((e) => ({ ...e, [l.id]: !showAll }))}>
                {showAll ? "Show fewer" : `Show ${list.length - 6} more`}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function MaterialStrip({ facts }: { facts: PositionFacts }) {
  const m = materialSummary(facts.ctx.p);
  const max = Math.max(m.w.points, m.b.points, 1);
  return (
    <div className="material">
      {(["w", "b"] as const).map((c) => (
        <div key={c} className="material-row">
          <span className="material-side">{c === "w" ? "White" : "Black"}</span>
          <span className="material-pieces">
            {MATERIAL_ORDER.map((t) =>
              Array.from({ length: m[c].counts[t] }, (_, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${t}${i}`} src={`/pieces/${c}${t.toUpperCase()}.svg`} alt="" className={`mp mp-${t}`} />
              )),
            )}
          </span>
          <span className="material-bar">
            <span className={`material-fill material-fill-${c}`} style={{ width: `${(m[c].points / max) * 100}%` }} />
          </span>
          <span className="mono material-pts">{m[c].points}</span>
        </div>
      ))}
    </div>
  );
}
