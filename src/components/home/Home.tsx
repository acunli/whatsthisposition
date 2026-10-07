"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BoardStage } from "../BoardStage";
import { parseFen, placementFromFen, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import { PgnError, parseFirstGame, type ParsedGame } from "@/lib/review/pgn";
import { holdPageVeil, useBootLogoPlayed } from "../PageVeil";
import { GameImport } from "../review/GameImport";
import { computeFacts } from "@/lib/facts";
import { buildLedger } from "@/lib/facts/ledger";
import { buildTour } from "@/lib/facts/tour";
import { Concepts } from "./Concepts";
import { Labels } from "./Labels";
import { Story } from "./Story";

const Hero3D = dynamic(() => import("./Hero3D"), { ssr: false });

/** Teaching positions for single-position analysis (games are reviewed from GameImport). */
export const SAMPLES = [
  { name: "Isolated queen's pawn", fen: "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10" },
  { name: "Is e5 free?", fen: "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4" },
  { name: "Outside passer", fen: "8/5pk1/6p1/1P6/8/6P1/5PK1/8 w - - 0 1" },
];

const HERO_FEN = "r2q1rk1/1b2bppp/p2p1n2/1p2p3/4P3/1BN2N2/PPP2PPP/R2Q1RK1 w - - 0 11";
const HERO_STEP_MS = 4200;

interface Props {
  onGame: (game: ParsedGame, orientation?: Color) => void;
  onPhoto: (file: File) => void;
  onFen: (setup: PositionSetup, complete: boolean) => void;
  onHand: () => void;
  onSample: (fen: string) => void;
}

/**
 * Can the browser do WebGL? Checked without creating a throwaway context: that alone
 * can stall the main thread for a long time (GPU start-up). If the 3D hero fails
 * anyway, HeroBoundary falls back to the flat board.
 */
function useWebGL() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability check
    setOk(typeof window !== "undefined" && ("WebGL2RenderingContext" in window || "WebGLRenderingContext" in window));
  }, []);
  return ok;
}

/** Falls back to the flat board if the 3D hero throws (no WebGL context, lost GPU). */
class HeroBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError: () => void }, { failed: boolean }> {
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

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the media query
    setR(m.matches);
    const on = () => setR(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

export function Home({ onGame, onPhoto, onFen, onHand, onSample }: Props) {
  const [drag, setDrag] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const [fen, setFen] = useState("");
  const [fenError, setFenError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const webgl = useWebGL();
  const reduced = useReducedMotion();
  const heroRef = useRef<HTMLElement>(null);
  const [heroOn, setHeroOn] = useState(true);
  const [lite, setLite] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time viewport check
    setLite(window.innerWidth < 760);
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setHeroOn(e.isIntersecting), { threshold: 0.02 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The loading veil waits for the 3D hero's first frames (shaders compile then), so the
  // page doesn't stutter as it appears. Asked for at once, before the veil counts holds.
  const releaseVeil = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!("WebGL2RenderingContext" in window || "WebGLRenderingContext" in window)) return;
    releaseVeil.current = holdPageVeil(6000);
    return () => releaseVeil.current?.();
  }, []);
  const heroReady = () => releaseVeil.current?.();
  // The 3D scene starts once the loading logo has played: compiling its shaders on a
  // phone takes long enough to make the logo stutter if both run at once.
  const logoPlayed = useBootLogoPlayed();

  const heroPlacement = useMemo(() => placementFromFen(HERO_FEN), []);
  const scenes = useMemo(() => {
    const facts = computeFacts(HERO_FEN);
    return buildTour(buildLedger(facts), facts.ctx.turn, 6);
  }, []);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || reduced || scenes.length < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % scenes.length), HERO_STEP_MS);
    return () => clearTimeout(t);
  }, [i, paused, reduced, scenes.length]);
  const scene = scenes[i];

  const submitFen = () => {
    const r = parseFen(fen);
    if (!r.ok) {
      setFenError(r.issues[0].message);
      return;
    }
    setFenError(null);
    onFen(r.setup, validateSetup(r.setup).length === 0);
  };

  const pick = () => input.current?.click();
  const dockRef = useRef<HTMLDivElement>(null);
  const toImport = () => {
    dockRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
    dockRef.current?.querySelector<HTMLInputElement>("input, textarea")?.focus({ preventScroll: true });
  };

  /** A dropped .pgn is reviewed; a dropped image is read as a board photo. */
  const dropFile = async (f: File) => {
    setDropError(null);
    if (f.type.startsWith("image/")) return onPhoto(f);
    if (/\.pgn$|\.txt$/i.test(f.name) || f.type.startsWith("text/")) {
      try {
        onGame(parseFirstGame(await f.text()));
      } catch (e) {
        setDropError(e instanceof PgnError ? e.message : "That file couldn't be read as a game.");
      }
      return;
    }
    setDropError("Drop a board photo (JPEG, PNG, WebP) or a .pgn file.");
  };

  return (
    <>
      <section className="hero3d" ref={heroRef} onMouseEnter={() => setPaused(false)}>
        <div className="hero3d-stage" aria-hidden>
          {webgl ? (
            <HeroBoundary
              onError={heroReady}
              fallback={
                <div className="hero3d-fallback">
                  <BoardStage placement={heroPlacement} orientation="w" marks={scene?.fact.marks} revealKey={scene?.id} coordinates={false} label="" />
                </div>
              }
            >
              {logoPlayed && (
                <Hero3D placement={heroPlacement} marks={scene?.fact.marks ?? null} sceneKey={scene?.id ?? "none"} reduced={reduced} active={heroOn} lite={lite} onReady={heroReady} />
              )}
            </HeroBoundary>
          ) : webgl === false ? (
            <div className="hero3d-fallback">
              <BoardStage placement={heroPlacement} orientation="w" marks={scene?.fact.marks} revealKey={scene?.id} coordinates={false} label="" />
            </div>
          ) : null}
        </div>
        <div className="hero3d-veil" aria-hidden />

        <div className="hero3d-content">
          <h1 className="h-hero">See what the engine sees.</h1>
          <p className="hero-lede">
            Review a game from Chess.com, Lichess or a PGN. Every move gets a label, from brilliant to blunder, and an explanation taken from Stockfish&apos;s own lines. It all
            runs in your browser, free.
          </p>

          <div
            ref={dockRef}
            className={drag ? "dock dock-on" : "dock"}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void dropFile(f);
            }}
          >
            <GameImport onGame={onGame} />
            {dropError && <p className="hero-issue">{dropError}</p>}

            <div className="dock-alt">
              <span className="dock-label">Or open a single position</span>
              <div className="dock-alt-row">
                <button className="btn" onClick={pick}>
                  <svg viewBox="0 0 24 24" aria-hidden>
                    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                    <circle cx="12" cy="13" r="3.5" />
                  </svg>
                  Board photo
                </button>
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
        </div>

        {scene && (
          <div className="hero3d-caption" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
            <div key={scene.id} className={`caption ${scene.polarity === "strength" ? "t-opportunity" : "t-danger"}`}>
              <span className="caption-tag">{scene.polarity === "strength" ? "+" : "−"}</span>
              <span className="caption-kind">
                {scene.side === "w" ? "White" : "Black"}&apos;s {scene.polarity}, read live from the board
              </span>
              <span className="caption-text">{scene.fact.title}</span>
            </div>
            <div className="hero3d-dots">
              {scenes.map((s, k) => (
                <button key={s.id} aria-label={s.label} aria-current={k === i} onClick={() => setI(k)} />
              ))}
            </div>
          </div>
        )}
      </section>

      <Labels />

      <Story onTry={onSample} />

      <section className="section">
        <div className="section-head">
          <h2 className="h-section">What each idea looks like on the board</h2>
          <p className="section-lede">Once you&apos;ve seen these a few times, you start spotting them in your own games before the engine points them out.</p>
        </div>
        <Concepts />
      </section>

      <section className="closing">
        <h2 className="h-section">Bring the game you lost last night.</h2>
        <p className="section-lede">Type your Chess.com username or paste the PGN, then step through it move by move.</p>
        <div className="closing-actions">
          <button className="btn btn-primary btn-xl" onClick={toImport}>
            Review a game
          </button>
          <button className="btn btn-xl btn-ghost" onClick={pick}>
            Upload a board photo
          </button>
        </div>
      </section>
    </>
  );
}
