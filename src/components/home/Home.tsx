"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoardStage } from "../BoardStage";
import { parseFen, placementFromFen, validateSetup } from "@/lib/chess/fen";
import type { Color, PositionSetup } from "@/lib/chess/types";
import { PgnError, parseFirstGame, type ParsedGame } from "@/lib/review/pgn";
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

function useWebGL() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    let supported = false;
    try {
      const c = document.createElement("canvas");
      supported = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      supported = false;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability check
    setOk(supported);
  }, []);
  return ok;
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

const TICKER = [
  "Brilliant moves",
  "Blunders",
  "Missed wins",
  "Book moves",
  "Accuracy",
  "Hanging pieces",
  "Pins & skewers",
  "Forks",
  "Poisoned pawns",
  "Holes",
  "Outposts",
  "Passed pawns",
  "Pawn chains",
  "King danger",
  "Open files",
  "Space",
  "Only moves",
  "Plans for both sides",
];

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
            <Hero3D placement={heroPlacement} marks={scene?.fact.marks ?? null} sceneKey={scene?.id ?? "none"} reduced={reduced} active={heroOn} lite={lite} />
          ) : webgl === false ? (
            <div className="hero3d-fallback">
              <BoardStage placement={heroPlacement} orientation="w" marks={scene?.fact.marks} revealKey={scene?.id} coordinates={false} label="" />
            </div>
          ) : null}
        </div>
        <div className="hero3d-veil" aria-hidden />

        <div className="hero3d-content">
          <span className="pill">
            <i aria-hidden /> Stockfish 19 · runs in your browser · free
          </span>
          <h1 className="h-hero">
            See what the
            <br />
            engine <em>sees.</em>
          </h1>
          <p className="hero-lede">
            Review any game from Chess.com, Lichess or a PGN: every move is labelled from <span className="hl-gold">Brilliant</span> to <span className="hl-red">Blunder</span> and explained
            from Stockfish&apos;s own lines. Then open any position and watch threats flash red and strong pieces light up.
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
              <span className="eyebrow">Or analyse one position</span>
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
                  <input className="input" placeholder="paste a FEN…" value={fen} onChange={(e) => setFen(e.target.value)} aria-label="FEN" spellCheck={false} />
                  <button className="btn" disabled={!fen.trim()}>
                    Analyse →
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
                  ✎ Set up a board
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
                Live read · {scene.side === "w" ? "White" : "Black"} · {scene.polarity}
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
        <div className="scroll-cue" aria-hidden>
          <span />
        </div>
      </section>

      <div className="ticker" aria-hidden>
        <div className="ticker-track">
          {[...TICKER, ...TICKER].map((t, k) => (
            <span key={k}>
              {t}
              <i>✦</i>
            </span>
          ))}
        </div>
      </div>

      <Labels />

      <Story onTry={onSample} />

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">The visual language</div>
            <h2 className="h-section">
              Every idea has a <em>look.</em>
            </h2>
          </div>
          <p className="section-lede">Once you&apos;ve seen these on the board a few times, you start spotting them in your own games, before the engine tells you.</p>
        </div>
        <Concepts />
      </section>

      <section className="cta">
        <h2 className="h-cta">
          Your game.
          <br />
          <em>Explained.</em>
        </h2>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn btn-gold btn-xl" onClick={toImport}>
            Review a game
          </button>
          <button className="btn btn-xl btn-ghost" onClick={pick}>
            Upload a board photo
          </button>
        </div>
        <p className="dock-note">Games and photos are never stored. The engine runs on your device.</p>
      </section>
    </>
  );
}
