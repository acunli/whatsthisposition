"use client";

import { countUse } from "@/lib/usage";
import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { parseFen, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import { PgnError, parseFirstGame, type ParsedGame } from "@/lib/review/pgn";
import { holdPageVeil, useBootLogoPlayed } from "../PageVeil";
import { GameImport, type ImportSource } from "../review/GameImport";
import { AddToChrome } from "../AddToChrome";
import { LogoMark, Wordmark } from "../Logo";
import { useTheme } from "../ThemeToggle";
import { Concepts } from "./Concepts";
import { Extension } from "./Extension";
import { Faq } from "./Faq";
import { Labels } from "./Labels";
import { ReviewedCount } from "./ReviewedCount";
import { Story } from "./Story";

const HeroKnight = dynamic(() => import("./HeroKnight"), { ssr: false });

/** Teaching positions for single-position analysis (games are reviewed from GameImport). */
export const SAMPLES = [
  { name: "Isolated queen's pawn", fen: "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10" },
  { name: "Is e5 free?", fen: "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4" },
  { name: "Outside passer", fen: "8/5pk1/6p1/1P6/8/6P1/5PK1/8 w - - 0 1" },
];

/** A landing page's hero (lib/landing.ts): its own heading, and the tool its box opens with. */
export interface HomeVariant {
  title: string;
  lede: string;
  /** A game import open on this tab, or the single-position inputs. */
  tool: ImportSource | "position";
}

interface Props {
  /** Whether the hero's wordmark is in view (the top bar shows its own logo when it isn't). */
  onHero: (inView: boolean) => void;
  onGame: (game: ParsedGame, orientation?: Color) => void;
  onPhoto: (file: File) => void;
  onFen: (setup: PositionSetup, complete: boolean) => void;
  onHand: () => void;
  onSample: (fen: string) => void;
  /** On a landing page: its hero, and its own sections (`children`) in place of the home page's. */
  variant?: HomeVariant;
  children?: ReactNode;
}

type DropHandlers = Pick<React.DOMAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">;

/**
 * A single position, three ways: a board picture, a FEN, or a board set up by hand (plus the
 * teaching samples). `dropHandlers` is left out when a parent already takes the drop.
 */
function PositionInputs({ drag, dropHandlers, onPhoto, onFen, onHand, onSample }: Pick<Props, "onPhoto" | "onFen" | "onHand" | "onSample"> & { drag: boolean; dropHandlers?: DropHandlers }) {
  const [fen, setFen] = useState("");
  const [fenError, setFenError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submitFen = () => {
    const r = parseFen(fen);
    if (!r.ok) {
      setFenError(r.issues[0].message);
      return;
    }
    setFenError(null);
    onFen(r.setup, validateSetup(r.setup).length === 0);
  };

  return (
    <>
      <div className="position-grid">
        <button className={drag ? "drop drop-on" : "drop"} onClick={() => input.current?.click()} {...dropHandlers}>
          <span className="drop-icon" aria-hidden>
            <svg viewBox="0 0 24 24">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
          <span>
            <span className="drop-title">Board screenshot or photo</span>
            <span className="drop-sub">Drop it here or choose a file. It&apos;s read on your device.</span>
          </span>
        </button>
        <div className="position-side">
          <form
            className="dock-fen"
            onSubmit={(e) => {
              e.preventDefault();
              submitFen();
            }}
          >
            <input className="input input-code" placeholder="Paste a FEN" value={fen} onChange={(e) => setFen(e.target.value)} aria-label="FEN" spellCheck={false} />
            <button className="btn" disabled={!fen.trim()}>
              Analyse
            </button>
          </form>
          {fenError && <p className="hero-issue">{fenError}</p>}
          <div className="dock-row">
            <button className="chip" onClick={onHand}>
              Set up a board
            </button>
            {SAMPLES.map((s) => (
              <button key={s.name} className="chip" onClick={() => onSample(s.fen)}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhoto(f);
        }}
      />
    </>
  );
}

/**
 * Can the browser do WebGL? Checked without creating a throwaway context: that alone
 * can stall the main thread for a long time (GPU start-up). If the knight fails anyway,
 * KnightBoundary falls back to the flat logo mark.
 */
function useWebGL() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability check
    setOk(typeof window !== "undefined" && ("WebGL2RenderingContext" in window || "WebGLRenderingContext" in window));
  }, []);
  return ok;
}

/** Falls back to the flat mark if the 3D knight throws (no WebGL context, lost GPU). */
class KnightBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Whether a media query matches, kept in sync as the window changes. */
function useMedia(query: string) {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the media query
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return r;
}

export function Home({ onHero, onGame, onPhoto, onFen, onHand, onSample, variant, children }: Props) {
  const [drag, setDrag] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const positionFirst = variant?.tool === "position";
  const webgl = useWebGL();
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const theme = useTheme();
  const heroRef = useRef<HTMLElement>(null);
  const [heroOn, setHeroOn] = useState(true);
  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHeroOn(e.isIntersecting), { threshold: 0.02 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const brandRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = brandRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => onHero(e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => {
      io.disconnect();
      onHero(true);
    };
  }, [onHero]);

  // The loading veil waits for the knight's first frames (shaders compile then), so the
  // page doesn't stutter as it appears. Asked for at once, before the veil counts holds.
  const releaseVeil = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!("WebGL2RenderingContext" in window || "WebGLRenderingContext" in window)) return;
    releaseVeil.current = holdPageVeil(6000);
    return () => releaseVeil.current?.();
  }, []);
  const knightReady = () => releaseVeil.current?.();
  // The 3D scene starts once the loading logo has played: compiling its shaders on a
  // phone takes long enough to make the logo stutter if both run at once.
  const logoPlayed = useBootLogoPlayed();

  const boxRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef<HTMLElement>(null);
  const gameRef = useRef<HTMLElement>(null);
  const scrollTo = (el: HTMLElement | null, block: ScrollLogicalPosition) => {
    el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block });
    el?.querySelector<HTMLInputElement>("input, textarea")?.focus({ preventScroll: true });
  };

  /** A dropped .pgn is reviewed; a dropped image is read as a board photo. */
  const dropFile = async (f: File) => {
    setDropError(null);
    if (f.type.startsWith("image/")) return onPhoto(f);
    if (/\.pgn$|\.txt$/i.test(f.name) || f.type.startsWith("text/")) {
      try {
        const g = parseFirstGame(await f.text());
        countUse("review", "file");
        onGame(g);
      } catch (e) {
        setDropError(e instanceof PgnError ? e.message : "That file couldn't be read as a game.");
      }
      return;
    }
    setDropError("Drop a board photo (JPEG, PNG, WebP) or a .pgn file.");
  };
  const dropHandlers: DropHandlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(true);
    },
    onDragLeave: () => setDrag(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files[0];
      if (f) void dropFile(f);
    },
  };

  const fallbackMark = (
    <div className="knight-flat">
      <LogoMark size={168} animate={!reduced} />
    </div>
  );

  return (
    <>
      <section className={drag ? "hero hero-drop" : "hero"} ref={heroRef} aria-labelledby="hero-title" {...dropHandlers}>
        <div className="knight-stage" aria-hidden>
          {webgl ? (
            <KnightBoundary onError={knightReady} fallback={fallbackMark}>
              {logoPlayed && <HeroKnight theme={theme} reduced={reduced} active={heroOn} onReady={knightReady} />}
            </KnightBoundary>
          ) : webgl === false ? (
            fallbackMark
          ) : null}
        </div>

        <div className="hero-content">
          <p className="hero-brand" ref={brandRef}>
            <Wordmark className="logo-word hero-word" />
          </p>
          <h1 className="hero-title" id="hero-title">
            {variant?.title ?? "Review any chess game, move by move."}
          </h1>
          <p className="hero-lede">
            {variant?.lede ??
              "Enter a Chess.com or Lichess username, a game link or a PGN. Stockfish labels every move from Brilliant to Blunder and explains why. Free, in your browser."}
          </p>

          <div ref={boxRef} className="hero-box">
            {positionFirst ? (
              // The hero takes the drop itself, so the drop zone inside it doesn't.
              <PositionInputs drag={drag} onPhoto={onPhoto} onFen={onFen} onHand={onHand} onSample={onSample} />
            ) : (
              <GameImport onGame={onGame} initialSource={variant?.tool === "position" ? undefined : variant?.tool} />
            )}
            {dropError && <p className="hero-issue">{dropError}</p>}
          </div>

          <div className="hero-actions">
            {positionFirst ? (
              <button className="btn btn-ghost hero-alt" onClick={() => scrollTo(gameRef.current, "start")}>
                Review a whole game
              </button>
            ) : (
              <>
                <AddToChrome from="hero" className="btn btn-chrome">
                  Add to Chrome
                </AddToChrome>
                <button className="btn btn-ghost hero-alt" onClick={() => scrollTo(positionRef.current, "start")}>
                  Analyse a single position
                </button>
              </>
            )}
          </div>
          {!positionFirst && <p className="hero-note">The Chrome extension reviews your Chess.com games right where you play them.</p>}
          {!variant && <ReviewedCount />}
        </div>
      </section>

      {positionFirst ? (
        <section className="section" ref={gameRef} id="game" aria-labelledby="game-title">
          <div className="section-head">
            <h2 className="h-section" id="game-title">
              Or review a whole game
            </h2>
            <p className="section-lede">
              Enter a Chess.com or Lichess username, a game link or a PGN. Every move gets a label from Brilliant to Blunder and an explanation.
            </p>
          </div>
          <div className="hero-box game-box">
            <GameImport onGame={onGame} />
          </div>
        </section>
      ) : (
        <section className="section position" ref={positionRef} id="position" aria-labelledby="position-title">
          <div className="section-head">
            <h2 className="h-section" id="position-title">
              Or analyse a single position
            </h2>
            <p className="section-lede">
              A screenshot from a game, a FEN or a board you set up. It shows the threats, weaknesses and plans for both sides on the board, checked by Stockfish.
            </p>
          </div>
          <PositionInputs drag={drag} dropHandlers={dropHandlers} onPhoto={onPhoto} onFen={onFen} onHand={onHand} onSample={onSample} />
        </section>
      )}

      {variant ? (
        children
      ) : (
        <>
          <Labels />

          <Extension />

          <Story onTry={onSample} />

          <section className="section">
            <div className="section-head">
              <h2 className="h-section">What each idea looks like on the board</h2>
              <p className="section-lede">Once you&apos;ve seen these a few times, you start spotting them in your own games before the engine points them out.</p>
            </div>
            <Concepts />
          </section>

          <Faq />

          <section className="closing">
            <h2 className="h-section">Bring the game you lost last night.</h2>
            <p className="section-lede">Type your Chess.com username, or paste a game link or the PGN, then step through it move by move.</p>
            <div className="closing-actions">
              <button className="btn btn-primary btn-xl" onClick={() => scrollTo(boxRef.current, "center")}>
                Review a game
              </button>
              <AddToChrome from="closing" className="btn btn-xl btn-ghost closing-ext">
                Add to Chrome
              </AddToChrome>
            </div>
          </section>
        </>
      )}
    </>
  );
}
