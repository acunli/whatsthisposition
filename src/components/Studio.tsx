"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { EMPTY_CASTLING, parseFen, setupFromFen, setupToFen, START_FEN, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import type { ParsedGame } from "@/lib/review/pgn";
import { SITE_NAME } from "@/lib/brand";
import { Logo } from "./Logo";
import { showPageChange } from "./PageVeil";
import { SiteCredit, SiteFooter, SupportButton } from "./SiteLinks";
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

  // Every change of stage is a page change: it runs under the loading veil.
  const go = (s: Stage, also?: () => void) =>
    showPageChange(() => {
      also?.();
      setStage(s);
      window.scrollTo({ top: 0 });
    });

  const analyze = useCallback((s: PositionSetup, o?: Color) => {
    const f = setupToFen(s);
    showPageChange(() => {
      setSetup(s);
      setFen(f);
      setOrientation(o ?? s.turn ?? "w");
      setRunId((r) => r + 1);
      setStage("analysis");
      window.scrollTo({ top: 0 });
      const url = new URL(window.location.href);
      url.searchParams.set("fen", f);
      window.history.replaceState(null, "", url);
    });
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("fen");
    if (!q) return;
    const r = parseFen(q);
    if (r.ok && validateSetup(r.setup).length === 0) {
      analyze(r.setup);
    }
  }, [analyze]);

  const review = (g: ParsedGame, o?: Color) =>
    go("review", () => {
      setGame((cur) => ({ g, id: (cur?.id ?? 0) + 1 }));
      setReviewOrientation(o ?? "w");
      const url = new URL(window.location.href);
      url.searchParams.delete("fen");
      window.history.replaceState(null, "", url);
    });

  const deepFromReview = (f: string) => {
    setReviewScroll(window.scrollY);
    const r = parseFen(f);
    if (r.ok) analyze(r.setup, reviewOrientation);
  };

  const backToReview = () =>
    showPageChange(() => {
      setStage("review");
      requestAnimationFrame(() => window.scrollTo({ top: reviewScroll }));
      const url = new URL(window.location.href);
      url.searchParams.delete("fen");
      window.history.replaceState(null, "", url);
    });

  const home = () => {
    if (stage === "home") return window.scrollTo({ top: 0, behavior: "smooth" });
    go("home", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("fen");
      window.history.replaceState(null, "", url);
    });
  };

  return (
    <div className="shell">
      <header className={stage === "home" ? "topbar" : "topbar topbar-app"}>
        <button className="topbar-brand" onClick={home} aria-label={`${SITE_NAME} home`}>
          <Logo size={34} animate={false} />
        </button>
        <nav className="topbar-nav" aria-label="Site">
          {game && stage !== "review" && stage !== "home" && (
            <button className="btn btn-sm btn-primary" onClick={backToReview}>
              <span className="only-wide">← Back to game review</span>
              <span className="only-narrow">← Review</span>
            </button>
          )}
          {stage === "analysis" && (
            <button className="btn btn-sm" onClick={() => go("setup")}>
              Edit position
            </button>
          )}
          {stage !== "home" && (
            <button className="navlink navlink-wide" onClick={home}>
              {stage === "review" ? "New game" : "New position"}
            </button>
          )}
          {stage === "home" && game && (
            <button className="navlink" onClick={backToReview}>
              Last review
            </button>
          )}
          <Link className="navlink navlink-wide navlink-how" href="/credits">
            How it works
          </Link>
          <SiteCredit className="navlink navlink-wide" />
          <SupportButton />
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

      {stage === "home" && <SiteFooter />}
    </div>
  );
}
