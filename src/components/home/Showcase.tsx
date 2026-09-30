"use client";

import { useEffect, useMemo, useState } from "react";
import { BoardStage } from "../BoardStage";
import { placementFromFen } from "@/lib/chess/fen";
import { computeFacts } from "@/lib/facts";
import { buildLedger } from "@/lib/facts/ledger";
import { buildTour } from "@/lib/facts/tour";

const DEMO = "r2q1rk1/1b2bppp/p2p1n2/1p2p3/4P3/1BN2N2/PPP2PPP/R2Q1RK1 w - - 0 11";
const STEP_MS = 3800;

/** The hero board: plays the guided tour of a real position on a loop. */
export function Showcase() {
  const scenes = useMemo(() => {
    const facts = computeFacts(DEMO);
    return buildTour(buildLedger(facts), facts.ctx.turn, 6);
  }, []);
  const placement = useMemo(() => placementFromFen(DEMO), []);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || scenes.length < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % scenes.length), STEP_MS);
    return () => clearTimeout(t);
  }, [i, paused, scenes.length]);

  const s = scenes[i];
  if (!s) return null;
  const tone = s.polarity === "strength" ? "t-opportunity" : "t-danger";

  return (
    <div className="showcase" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="showcase-frame">
        <div className="showcase-hud">
          <span className="eyebrow showcase-live">Live read · White to move</span>
          <span className="eyebrow">
            {String(i + 1).padStart(2, "0")} / {String(scenes.length).padStart(2, "0")}
          </span>
        </div>
        <BoardStage placement={placement} orientation="w" marks={s.fact.marks} revealKey={`${i}-${s.id}`} label="Demo position being analysed" coordinates={false} />
        <div key={s.id} className={`caption ${tone}`}>
          <span className="caption-tag">{s.polarity === "strength" ? "+" : "−"}</span>
          <span className="caption-kind">
            {s.side === "w" ? "White" : "Black"} · {s.polarity}
          </span>
          <span className="caption-text">{s.fact.title}</span>
        </div>
        <div className="showcase-dots" role="tablist" aria-label="Demo findings">
          {scenes.map((sc, k) => (
            <button key={sc.id} aria-current={k === i} aria-label={sc.label} onClick={() => setI(k)} />
          ))}
        </div>
      </div>
    </div>
  );
}
