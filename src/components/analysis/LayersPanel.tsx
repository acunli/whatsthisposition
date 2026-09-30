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
  onHover: (f: Fact | null) => void;
  extraThreats: Fact[];
}

const GLYPH: Record<LensId, string> = {
  threats: "M12 3l9 16H3zM12 10v4M12 17v.5",
  king: "M12 3v4M10 5h4M6 21h12l1-9-4 3-3-6-3 6-4-3z",
  pawns: "M12 4a3 3 0 110 6 3 3 0 010-6zM8 20h8l-1.5-7h-5z",
  activity: "M4 17l5-5 4 4 7-9",
  control: "M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7",
  material: "M4 19h16M6 19v-8M12 19V5M18 19v-6",
};

export function LayersPanel({ facts, active, onToggle, onClean, focus, onFocus, onHover, extraThreats }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return (
    <div className="desk-body">
      <div className="layers" role="group" aria-label="Board layers">
        {LENSES.map((l) => {
          const on = active.includes(l.id);
          const count = (l.id === "threats" ? extraThreats.length : 0) + facts.byLens[l.id].length;
          return (
            <button key={l.id} className={on ? "layer layer-on" : "layer"} aria-pressed={on} onClick={() => onToggle(l.id)} title={l.question}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d={GLYPH[l.id]} />
              </svg>
              <span>{l.label}</span>
              <small>{count} finding{count === 1 ? "" : "s"}</small>
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn btn-sm btn-ghost" onClick={onClean}>
          {active.length ? "Clear the board" : "Restore layers"}
        </button>
        <span className="small muted">Stack layers to compare. Tap any piece on the board to see what it controls.</span>
      </div>

      {LENSES.filter((l) => active.includes(l.id)).map((l) => {
        const list = l.id === "threats" ? [...extraThreats, ...facts.byLens.threats] : facts.byLens[l.id];
        const shown = expanded[l.id] ? list : list.slice(0, 6);
        return (
          <section key={l.id} className="lens-section">
            <header className="lens-head">
              <h3>{l.label}</h3>
              <p>{l.question}</p>
            </header>
            <ul className="legend">
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
              <p className="lens-none">Nothing notable here.</p>
            ) : (
              <ol className="facts">
                {shown.map((f) => {
                  const on = focus === f.id;
                  return (
                    <li key={f.id} className={`t-${f.tone} ${on ? "fact-focus" : ""}`}>
                      <button
                        className="fact-btn"
                        onClick={() => onFocus(on ? null : f.id)}
                        onMouseEnter={() => onHover(f)}
                        onMouseLeave={() => onHover(null)}
                        aria-expanded={on}
                      >
                        <span className={`fact-mark t-${f.tone}`} aria-hidden />
                        <span>{f.title}</span>
                        <EvidenceTag e={f.evidence} />
                      </button>
                      {on && f.detail && <p className="fact-detail">{f.detail}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
            {list.length > 6 && (
              <button className="linkish" style={{ marginTop: 8 }} onClick={() => setExpanded((e) => ({ ...e, [l.id]: !e[l.id] }))}>
                {expanded[l.id] ? "Show fewer" : `Show ${list.length - 6} more`}
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
          <b>{c === "w" ? "White" : "Black"}</b>
          <span className="material-line">
            {MATERIAL_ORDER.map((t) =>
              Array.from({ length: m[c].counts[t] }, (_, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={`${t}${i}`} src={`/pieces/${c}${t.toUpperCase()}.svg`} alt="" />
              )),
            )}
          </span>
          <span className="mono">{m[c].points}</span>
          <span className="material-bar">
            <span className={`material-fill material-fill-${c}`} style={{ width: `${(m[c].points / max) * 100}%` }} />
          </span>
        </div>
      ))}
    </div>
  );
}
