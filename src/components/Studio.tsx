"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { EMPTY_CASTLING, parseFen, setupFromFen, setupToFen, START_FEN, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import { parseFirstGame, type ParsedGame } from "@/lib/review/pgn";
import { readReviewHash, unpackReview } from "@/lib/review/share";
import { countUse, type UsageSource } from "@/lib/usage";
import type { FinishedReview } from "./review/useReview";
import { SITE_NAME } from "@/lib/brand";
import { AddToChrome } from "./AddToChrome";
import { Logo } from "./Logo";
import { showPageChange } from "./PageVeil";
import { SiteCredit, SiteFooter, SupportButton } from "./SiteLinks";
import { ThemeToggle } from "./ThemeToggle";
import { Home, type HomeVariant } from "./home/Home";
import { SetupView } from "./setup/SetupView";
import { AnalysisView } from "./analysis/AnalysisView";
import { ReviewView } from "./review/ReviewView";

type Stage = "home" | "setup" | "analysis" | "review";

/** A game to open straight into its review: from a #review link, or a shared review's page (/r/[id]). */
export interface SharedGame {
  pgn: string;
  as?: Color;
  depth?: number;
  /** The finished review, packed (`packReview`). */
  data?: string;
}

/**
 * The app: the home page and every screen it leads to. A landing page passes its own hero
 * (`variant`) and sections (`children`), shown in place of the home page's; a shared review's
 * page passes the game (`shared`), which opens straight into its review.
 */
export function Studio({ variant, children, shared: given }: { variant?: HomeVariant; children?: ReactNode; shared?: SharedGame }) {
  const [stage, setStage] = useState<Stage>("home");
  const [setup, setSetup] = useState<PositionSetup>(() => setupFromFen(START_FEN));
  const [orientation, setOrientation] = useState<Color>("w");
  const [fen, setFen] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [runId, setRunId] = useState(0);
  // The reviewed game stays mounted (hidden) while one of its positions is analysed.
  const [game, setGame] = useState<{ g: ParsedGame; id: number; depth?: number; finished?: FinishedReview } | null>(null);
  const [reviewOrientation, setReviewOrientation] = useState<Color>("w");
  const [reviewScroll, setReviewScroll] = useState(0);
  // On the home page the hero carries the logo: the top bar's appears once it scrolls away.
  const [atHero, setAtHero] = useState(true);

  // Every change of stage is a page change: it runs under the loading veil.
  const go = (s: Stage, also?: () => void) =>
    showPageChange(() => {
      also?.();
      setStage(s);
      window.scrollTo({ top: 0 });
    });

  const analyze = useCallback((s: PositionSetup, o?: Color, from?: UsageSource<"analysis">) => {
    const f = setupToFen(s);
    countUse("analysis", from);
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
      analyze(r.setup, undefined, "link");
    }
  }, [analyze]);

  const review = (g: ParsedGame, o?: Color, depth?: number, finished?: FinishedReview) =>
    go("review", () => {
      setGame((cur) => ({ g, id: (cur?.id ?? 0) + 1, depth, finished }));
      setReviewOrientation(o ?? "w");
      const url = new URL(window.location.href);
      url.searchParams.delete("fen");
      window.history.replaceState(null, "", url);
    });

  // A game handed over in the link (#review=…, from the browser extension) or by a shared
  // review's page: open its review. If it was already reviewed (data), that review is shown as is.
  useEffect(() => {
    const shared = given ?? readReviewHash(window.location.hash);
    // The visit itself is counted by <UsageTracker/> in the layout, on every page.
    if (!shared) return;
    if (!given) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    let g: ParsedGame;
    try {
      g = parseFirstGame(shared.pgn);
    } catch {
      return; // not a readable game: stay on the home page
    }
    countUse("review", shared.data && !given ? "extension" : "link");
    void (shared.data ? unpackReview(shared.data) : Promise.resolve(null)).then((done) => review(g, shared.as, done?.depth ?? shared.depth, done ?? undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on first load
  }, []);

  const deepFromReview = (f: string) => {
    setReviewScroll(window.scrollY);
    const r = parseFen(f);
    if (r.ok) analyze(r.setup, reviewOrientation, "review");
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
      <header className={stage === "home" ? `topbar topbar-home${atHero ? " topbar-hero" : ""}${game ? " topbar-back" : ""}` : `topbar topbar-app${stage === "analysis" ? " topbar-crowded" : ""}`}>
        {variant && stage === "home" ? (
          <Link className="topbar-brand" href="/" aria-label={`${SITE_NAME} home`}>
            <Logo size={34} animate={false} />
          </Link>
        ) : (
          <button className="topbar-brand" onClick={home} aria-label={`${SITE_NAME} home`}>
            <Logo size={34} animate={false} />
          </button>
        )}
        <nav className="topbar-nav" aria-label="Site">
          {game && stage !== "review" && (
            <button className="btn btn-sm btn-primary" onClick={backToReview}>
              <span className="only-wide">← Back to game review</span>
              <span className="only-narrow">← Review</span>
            </button>
          )}
          {stage === "analysis" && (
            <button className="btn btn-sm" onClick={() => go("setup")}>
              <span className="only-wide">Edit position</span>
              <span className="only-narrow">Edit</span>
            </button>
          )}
          {stage !== "home" && (
            <button className="navlink navlink-wide" onClick={home}>
              {stage === "review" ? "New game" : "New position"}
            </button>
          )}
          {(stage === "home" || stage === "review") && (
            <AddToChrome from="header" className="btn btn-sm navlink-wide topbar-ext">
              Add to Chrome
            </AddToChrome>
          )}
          <Link className="navlink navlink-wide navlink-how" href="/credits">
            How it works
          </Link>
          <SiteCredit className="navlink navlink-wide" />
          <ThemeToggle />
          <SupportButton />
        </nav>
      </header>

      {stage === "home" && (
        <Home
          onHero={setAtHero}
          onGame={review}
          onPhoto={(f) => {
            setPhoto(f);
            setSetup({ placement: {}, turn: null, castling: { ...EMPTY_CASTLING }, epSquare: null, halfmove: 0, fullmove: 1 });
            go("setup");
          }}
          onFen={(s, complete) => {
            if (complete) analyze(s, undefined, "fen");
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
          onSample={(f) => analyze(setupFromFen(f), undefined, "sample")}
          variant={variant}
        >
          {children}
        </Home>
      )}

      {stage === "setup" && (
        <SetupView
          setup={setup}
          onChange={setSetup}
          orientation={orientation}
          onOrientation={setOrientation}
          onAnalyze={(s, readFromPhoto) => analyze(s, orientation, readFromPhoto ? "photo" : "setup")}
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
            depth={game.depth}
            finished={game.finished}
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
