"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EMPTY_CASTLING, parseFen, setupFromFen, setupToFen, START_FEN, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import { keepReview, keptReview, updateKeptReview } from "@/lib/review/kept";
import { gamePgn, parseFirstGame, type ParsedGame } from "@/lib/review/pgn";
import { packReview, readReviewHash, unpackReview } from "@/lib/review/share";
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

/** The review page: a game opened on the home page (or a landing page) is reviewed at this address. */
const REVIEW_PATH = "/review";

/** A game to open straight into its review: from a #review link, or a shared review's page (/r/[id]). */
export interface SharedGame {
  pgn: string;
  as?: Color;
  depth?: number;
  /** The finished review, packed (`packReview`). */
  data?: string;
}

/** The reviewed game, and the address its review is at (/review, or a shared review's page). */
interface Reviewed {
  g: ParsedGame;
  id: number;
  at: string;
  /** The PGN it's kept under for this tab (only a game at /review is kept). */
  kept?: string;
  depth?: number;
  finished?: FinishedReview;
}

/** A position in the address (?fen=) that can be analysed, or null. */
function linkedPosition(): PositionSetup | null {
  const q = new URLSearchParams(window.location.search).get("fen");
  const r = q ? parseFen(q) : null;
  return r?.ok && validateSetup(r.setup).length === 0 ? r.setup : null;
}

/**
 * The app: the home page and every screen it leads to. A landing page passes its own hero
 * (`variant`) and sections (`children`), shown in place of the home page's; a shared review's
 * page passes the game (`shared`), which opens straight into its review.
 *
 * A game's review is a page of its own: opening one goes to /review (a shared review stays at its
 * own address), so the browser's Back button returns to where the game was picked, and a reload
 * shows the same game again (kept in the tab, `lib/review/kept.ts`). A position deep-analysed from
 * the review adds ?fen= to the review's address; Back returns to the review.
 */
export function Studio({ variant, children, shared: given }: { variant?: HomeVariant; children?: ReactNode; shared?: SharedGame }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("home");
  const [setup, setSetup] = useState<PositionSetup>(() => setupFromFen(START_FEN));
  const [orientation, setOrientation] = useState<Color>("w");
  const [fen, setFen] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [runId, setRunId] = useState(0);
  // The reviewed game stays mounted (hidden) while one of its positions is analysed.
  const [game, setGame] = useState<Reviewed | null>(null);
  const [reviewOrientation, setReviewOrientation] = useState<Color>("w");
  const [reviewScroll, setReviewScroll] = useState(0);
  // On the home page the hero carries the logo: the top bar's appears once it scrolls away.
  const [atHero, setAtHero] = useState(true);
  // This page's own addresses, read on first load: its home (the review page's is the home page)
  // and, on a shared review's page, the shared game's.
  const paths = useRef<{ home: string; given?: string }>({ home: "/" });

  // Every change of stage is a page change: it runs under the loading veil.
  const go = (s: Stage, also?: () => void) => {
    if (stage === "review") setReviewScroll(window.scrollY);
    showPageChange(() => {
      also?.();
      setStage(s);
      window.scrollTo({ top: 0 });
    });
  };

  /**
   * Analyses a position. `nav` is what happens to the address: ?fen= set in place, a new entry
   * after the review's (so Back returns to the review), or nothing (Back/Forward got here).
   */
  const analyze = useCallback((s: PositionSetup, o?: Color, from?: UsageSource<"analysis">, nav: "replace" | "push" | "none" = "replace") => {
    const f = setupToFen(s);
    if (nav !== "none") countUse("analysis", from);
    showPageChange(() => {
      setSetup(s);
      setFen(f);
      setOrientation(o ?? s.turn ?? "w");
      setRunId((r) => r + 1);
      setStage("analysis");
      window.scrollTo({ top: 0 });
      if (nav === "none") return;
      const url = new URL(window.location.href);
      url.searchParams.set("fen", f);
      if (nav === "push") window.history.pushState({ fromReview: true }, "", url);
      else window.history.replaceState(null, "", url);
    });
  }, []);

  /** Shows a game's review, reviewed at `at`; `push` adds the review page to the browser's history. */
  const review = (g: ParsedGame, o: Color | undefined, at: string, opts: { depth?: number; finished?: FinishedReview; kept?: string; push?: boolean } = {}) =>
    go("review", () => {
      setGame((cur) => ({ g, id: (cur?.id ?? 0) + 1, at, kept: opts.kept, depth: opts.depth, finished: opts.finished }));
      setReviewOrientation(o ?? "w");
      if (opts.push && window.location.pathname !== at) window.history.pushState(null, "", at);
    });

  /** A game picked on this page: its review opens at /review, kept for this tab. */
  const reviewNew = (g: ParsedGame, o?: Color) => {
    const pgn = gamePgn(g);
    keepReview({ pgn, ...(o ? { as: o } : {}) });
    review(g, o, REVIEW_PATH, { kept: pgn, push: true });
  };

  /**
   * Opens a game that comes with the page: a shared review's, one handed over in the link, or the
   * one this tab keeps for /review. If it was already reviewed (data), that review is shown as is.
   * With `behind`, it only stands behind the position being analysed (← Back to game review).
   */
  const openGiven = (shared: SharedGame, at: string, kept: string | undefined, behind: boolean) => {
    let g: ParsedGame;
    try {
      g = parseFirstGame(shared.pgn);
    } catch {
      return false;
    }
    void (shared.data ? unpackReview(shared.data) : Promise.resolve(null)).then((done) => {
      const opts = { depth: done?.depth ?? shared.depth, finished: done ?? undefined, kept };
      if (!behind) return review(g, shared.as, at, opts);
      setGame((cur) => ({ g, id: (cur?.id ?? 0) + 1, at, ...opts }));
      setReviewOrientation(shared.as ?? "w");
    });
    return true;
  };

  // On first load: a position in the link (?fen=) opens its analysis. A game handed over in the
  // link (#review=…, from the browser extension), a shared review's page, or the game this tab
  // keeps (a reload of /review) opens its review, or waits behind the analysis.
  useEffect(() => {
    const path = window.location.pathname;
    paths.current = given ? { home: "/", given: path } : { home: path === REVIEW_PATH ? "/" : path };
    const position = linkedPosition();
    if (position) analyze(position, undefined, "link");
    if (given) {
      if (openGiven(given, path, undefined, !!position)) countUse("review", "link");
      return;
    }
    // The visit itself is counted by <UsageTracker/> in the layout, on every page.
    const handed = readReviewHash(window.location.hash);
    if (handed) {
      const ok = openGiven(handed, REVIEW_PATH, handed.pgn, !!position);
      if (!ok) return window.history.replaceState(null, "", path + window.location.search); // not a readable game: stay here
      countUse("review", handed.data ? "extension" : "link");
      keepReview(handed);
      window.history.replaceState(null, "", REVIEW_PATH + window.location.search);
      return;
    }
    if (path !== REVIEW_PATH) return;
    const kept = keptReview();
    // Nothing to review here (the tab never had a game): the home page instead.
    if (!kept || !openGiven(kept, REVIEW_PATH, kept.pgn, !!position)) {
      if (!position) router.replace("/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on first load
  }, []);

  // The browser's Back and Forward: each address shows its screen again (an in-page #anchor
  // leaves the screen as it is). One listener for the page's life, reading the latest screen:
  // the router re-renders synchronously in its own popstate listener, and a listener swapped
  // during that render would miss the event.
  const onPop = useRef(() => {});
  useEffect(() => {
    const listen = () => onPop.current();
    window.addEventListener("popstate", listen);
    return () => window.removeEventListener("popstate", listen);
  }, []);
  useEffect(() => {
    onPop.current = () => {
      const path = window.location.pathname;
      const position = linkedPosition();
      if (position) {
        if (fen !== setupToFen(position)) analyze(position, game && path === game.at ? reviewOrientation : undefined, undefined, "none");
        else if (stage !== "analysis") go("analysis");
        return;
      }
      if (game && path === game.at) {
        if (stage !== "review")
          showPageChange(() => {
            setStage("review");
            requestAnimationFrame(() => window.scrollTo({ top: reviewScroll }));
          });
        return;
      }
      // A review page whose game has since been replaced by another: open its own again.
      if (given && path === paths.current.given && openGiven(given, path, undefined, false)) return;
      const kept = path === REVIEW_PATH ? keptReview() : null;
      if (kept && openGiven(kept, REVIEW_PATH, kept.pgn, false)) return;
      if (stage !== "home") go("home");
    };
  });

  // The review is a page of its own: the tab's title names the game (a shared review's page has its own).
  useEffect(() => {
    if (stage !== "review" || !game || game.at !== REVIEW_PATH) return;
    const before = document.title;
    const title = `${game.g.white} vs ${game.g.black}: game review · ${SITE_NAME}`;
    document.title = title;
    return () => {
      if (document.title === title) document.title = before;
    };
  }, [stage, game]);

  // What the tab keeps of the game follows the review: its orientation, and the finished review.
  const keptPgn = game?.kept;
  const turnReview = (c: Color) => {
    setReviewOrientation(c);
    if (keptPgn) updateKeptReview(keptPgn, { as: c });
  };
  const keepDone = useCallback(
    (done: FinishedReview) => {
      if (keptPgn) void packReview(done.positions, done.depth).then((data) => updateKeptReview(keptPgn, { depth: done.depth, data }));
    },
    [keptPgn],
  );

  const deepFromReview = (f: string) => {
    setReviewScroll(window.scrollY);
    const r = parseFen(f);
    if (r.ok) analyze(r.setup, reviewOrientation, "review", "push");
  };

  const backToReview = () => {
    if (!game) return;
    // Analysing a position from the review: the review is the page before this one.
    if (window.history.state?.fromReview) return window.history.back();
    showPageChange(() => {
      setStage("review");
      requestAnimationFrame(() => window.scrollTo({ top: reviewScroll }));
      if (window.location.pathname === game.at) window.history.replaceState(null, "", game.at);
      else window.history.pushState(null, "", game.at);
    });
  };

  const home = () => {
    if (stage === "home") return window.scrollTo({ top: 0, behavior: "smooth" });
    go("home", () => {
      // Leaving the review's page is a new page; elsewhere only the position leaves the address.
      if (game && window.location.pathname === game.at) return window.history.pushState(null, "", paths.current.home);
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
          onGame={reviewNew}
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
            onOrientation={turnReview}
            onDeep={deepFromReview}
            onDone={keepDone}
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
