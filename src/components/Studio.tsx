"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { parseFen, setupToFen, START_FEN, setupFromFen, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import { SetupView } from "./setup/SetupView";
import { AnalysisView } from "./analysis/AnalysisView";

export function Studio() {
  const [stage, setStage] = useState<"setup" | "analysis">("setup");
  const [setup, setSetup] = useState<PositionSetup>(() => setupFromFen(START_FEN));
  const [orientation, setOrientation] = useState<Color>("w");
  const [fen, setFen] = useState<string | null>(null);

  const analyze = useCallback((s: PositionSetup, o?: Color) => {
    const f = setupToFen(s);
    setSetup(s);
    setFen(f);
    if (o) setOrientation(o);
    setStage("analysis");
    const url = new URL(window.location.href);
    url.searchParams.set("fen", f);
    window.history.replaceState(null, "", url);
  }, []);

  // Deep link: ?fen=...
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("fen");
    if (!q) return;
    const r = parseFen(q);
    if (r.ok && validateSetup(r.setup).length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from the URL
      analyze(r.setup, r.setup.turn ?? "w");
    }
  }, [analyze]);

  const edit = () => {
    setStage("setup");
    const url = new URL(window.location.href);
    url.searchParams.delete("fen");
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="app">
      <header className="masthead">
        <button className="wordmark" onClick={edit} aria-label="WhatsThisPosition — new position">
          <span className="wordmark-a">Whats</span>
          <span className="wordmark-b">This</span>
          <span className="wordmark-a">Position</span>
          <span className="wordmark-q">?</span>
        </button>
        <p className="masthead-tag">See why the engine likes a side — on the board, not in an essay.</p>
        <nav className="masthead-nav">
          {stage === "analysis" && (
            <button className="btn btn-ghost" onClick={edit}>
              ← Edit position
            </button>
          )}
          <Link className="navlink" href="/credits">
            Notes &amp; licences
          </Link>
        </nav>
      </header>

      {stage === "setup" || !fen ? (
        <SetupView
          setup={setup}
          onChange={setSetup}
          orientation={orientation}
          onOrientation={setOrientation}
          onAnalyze={(s) => analyze(s)}
        />
      ) : (
        <AnalysisView key={fen} fen={fen} orientation={orientation} onOrientation={setOrientation} onEdit={edit} />
      )}
    </div>
  );
}
