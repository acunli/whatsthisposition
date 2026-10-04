"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EMPTY_CASTLING, parseFen, setupFromFen, setupToFen, START_FEN, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import type { ParsedGame } from "@/lib/review/pgn";
import { Logo } from "./Logo";
import { Home } from "./home/Home";
import { SetupView } from "./setup/SetupView";
import { AnalysisView } from "./analysis/AnalysisView";
import { ReviewView } from "./review/ReviewView";

type Stage = "home" | "setup" | "analysis" | "review";

export function Studio() {
  const [stage, setStage] = useState<Stage>("home");
  const [setup, setSetup] = useState<PositionSetup>(() => setupFromFen(START_FEN));
  const [orientation, setOrientation] = useState<Color>("w");
  const [fen, setFen] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [runId, setRunId] = useState(0);
  // The reviewed game stays mounted (hidden) while one of its positions is analysed.
  const [game, setGame] = useState<{ g: ParsedGame; id: number } | null>(null);
  const [reviewOrientation, setReviewOrientation] = useState<Color>("w");
  const [reviewScroll, setReviewScroll] = useState(0);

  const go = (s: Stage) => {
    setStage(s);
    window.scrollTo({ top: 0 });
  };

  const analyze = useCallback((s: PositionSetup, o?: Color) => {
    const f = setupToFen(s);
    setSetup(s);
    setFen(f);
    setOrientation(o ?? s.turn ?? "w");
    setRunId((r) => r + 1);
    setStage("analysis");
    window.scrollTo({ top: 0 });
    const url = new URL(window.location.href);
    url.searchParams.set("fen", f);
    window.history.replaceState(null, "", url);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("fen");
    if (!q) return;
    const r = parseFen(q);
    if (r.ok && validateSetup(r.setup).length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from the URL
      analyze(r.setup);
    }
  }, [analyze]);

  const review = (g: ParsedGame, o?: Color) => {
    setGame((cur) => ({ g, id: (cur?.id ?? 0) + 1 }));
    setReviewOrientation(o ?? "w");
    go("review");
    const url = new URL(window.location.href);
    url.searchParams.delete("fen");
    window.history.replaceState(null, "", url);
  };

  const deepFromReview = (f: string) => {
    setReviewScroll(window.scrollY);
    const r = parseFen(f);
    if (r.ok) analyze(r.setup, reviewOrientation);
  };

  const backToReview = () => {
    setStage("review");
    requestAnimationFrame(() => window.scrollTo({ top: reviewScroll }));
    const url = new URL(window.location.href);
    url.searchParams.delete("fen");
    window.history.replaceState(null, "", url);
  };

  const home = () => {
    go("home");
    const url = new URL(window.location.href);
    url.searchParams.delete("fen");
    window.history.replaceState(null, "", url);
  };

  return (
    <div className="shell">
      <header className="topbar">
        <button className="topbar-brand" onClick={home} aria-label="WhatsThisPosition home">
          <Logo size={38} />
        </button>
        <nav className="topbar-nav">
          {game && stage !== "review" && stage !== "home" && (
            <button className="btn btn-sm btn-gold" onClick={backToReview}>
              ← Back to game review
            </button>
          )}
          {stage === "analysis" && (
            <button className="btn btn-sm" onClick={() => go("setup")}>
              ✎ Edit position
            </button>
          )}
          {stage !== "home" && (
            <button className="navlink" onClick={home}>
              {stage === "review" ? "New game" : "New position"}
            </button>
          )}
          {stage === "home" && game && (
            <button className="navlink" onClick={backToReview}>
              Last review
            </button>
          )}
          <Link className="navlink" href="/credits">
            How it works &amp; credits
          </Link>
        </nav>
      </header>

      {stage === "home" && (
        <Home
          onGame={review}
          onPhoto={(f) => {
            setPhoto(f);
            setSetup({ placement: {}, turn: null, castling: { ...EMPTY_CASTLING }, epSquare: null, halfmove: 0, fullmove: 1 });
            go("setup");
          }}
          onFen={(s, complete) => {
            if (complete) analyze(s);
            else {
              setSetup(s);
              setPhoto(null);
              go("setup");
            }
          }}
          onHand={() => {
            setPhoto(null);
            setSetup(setupFromFen(START_FEN));
            go("setup");
          }}
          onSample={(f) => analyze(setupFromFen(f))}
        />
      )}

      {stage === "setup" && (
        <SetupView
          setup={setup}
          onChange={setSetup}
          orientation={orientation}
          onOrientation={setOrientation}
          onAnalyze={(s) => analyze(s, orientation)}
          initialPhoto={photo}
          onPhotoConsumed={() => setPhoto(null)}
        />
      )}

      {game && (
        <div hidden={stage !== "review"}>
          <ReviewView
            key={game.id}
            game={game.g}
            orientation={reviewOrientation}
            onOrientation={setReviewOrientation}
            onDeep={deepFromReview}
            active={stage === "review"}
          />
        </div>
      )}

      {stage === "analysis" && fen && (
        <AnalysisView key={`${fen}-${runId}`} fen={fen} orientation={orientation} onOrientation={setOrientation} onEdit={() => go("setup")} />
      )}

      {stage === "home" && (
        <footer className="footer">
          <Logo size={22} animate={false} />
          <span>
            Engine: Stockfish 19 (GPL-3.0) running in your browser · <Link href="/credits">Licences &amp; privacy</Link>
          </span>
        </footer>
      )}
    </div>
  );
}
