"use client";

import { useMemo, useRef, useState } from "react";
import { BoardStage } from "../BoardStage";
import { parseFen, placementFromFen, validateSetup } from "@/lib/chess/fen";
import type { PositionSetup } from "@/lib/chess/types";
import { Concepts } from "./Concepts";
import { Showcase } from "./Showcase";

export const SAMPLES = [
  { name: "Isolated queen's pawn", fen: "r1bq1rk1/pp2bppp/2n1pn2/8/3P4/2NB1N2/PP3PPP/R1BQ1RK1 w - - 0 10" },
  { name: "Is e5 free?", fen: "r1bqkbnr/pppp1ppp/8/4p3/2BnP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4" },
  { name: "Trouble on f7", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4" },
  { name: "Outside passer", fen: "8/5pk1/6p1/1P6/8/6P1/5PK1/8 w - - 0 1" },
];

interface Props {
  onPhoto: (file: File) => void;
  onFen: (setup: PositionSetup, complete: boolean) => void;
  onHand: () => void;
  onSample: (fen: string) => void;
}

function SampleChip({ name, fen, onClick }: { name: string; fen: string; onClick: () => void }) {
  const placement = useMemo(() => placementFromFen(fen), [fen]);
  return (
    <button className="chip" onClick={onClick}>
      <span className="chip-mini">
        <BoardStage placement={placement} orientation="w" coordinates={false} label="" />
      </span>
      {name}
    </button>
  );
}

export function Home({ onPhoto, onFen, onHand, onSample }: Props) {
  const [drag, setDrag] = useState(false);
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
      <section className="hero">
        <div>
          <div className="eyebrow hero-kicker">The chess position X-ray</div>
          <h1 className="hero-title">
            <span>See what</span>
            <span>the engine</span>
            <span>sees.</span>
          </h1>
          <p className="hero-sub">
            Snap any board. Watch the <b className="hl-red">threats</b>, <b className="hl-red">weaknesses</b>,{" "}
            <b className="hl-gold">strengths</b> and <b className="hl-sky">plans</b> for both sides light up on the squares,
            with Stockfish checking every claim.
          </p>

          <div className="dock">
            <button
              className={drag ? "drop drop-on" : "drop"}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const f = e.dataTransfer.files[0];
                if (f) onPhoto(f);
              }}
            >
              <span className="drop-icon">
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </span>
              <span>
                <span className="drop-title">Drop a photo of the board</span>
                <span className="drop-sub">Photo or screenshot · we&apos;ll read every square</span>
              </span>
              <span className="drop-kbd">JPG · PNG</span>
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
            </button>

            <form
              className="fen-inline"
              onSubmit={(e) => {
                e.preventDefault();
                submitFen();
              }}
            >
              <input
                className="input"
                placeholder="…or paste a FEN"
                value={fen}
                onChange={(e) => setFen(e.target.value)}
                aria-label="FEN"
                spellCheck={false}
              />
              <button className="btn btn-gold" disabled={!fen.trim()}>
                Analyze
              </button>
            </form>
            {fenError && <p className="hero-issue">{fenError}</p>}

            <div className="dock-row">
              <button className="chip" onClick={onHand}>
                ✎ Set up by hand
              </button>
              {SAMPLES.map((s) => (
                <SampleChip key={s.name} name={s.name} fen={s.fen} onClick={() => onSample(s.fen)} />
              ))}
            </div>
            <p className="dock-note">Stockfish runs in your browser. Photos are read on our server, never stored.</p>
          </div>
        </div>
        <Showcase />
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">What lights up</div>
            <h2 className="section-title">Eight ways to read a board</h2>
          </div>
          <p className="section-lede">
            Each idea a strong player checks has its own look on the board. Once you&apos;ve seen these, you&apos;ll start spotting them in your own games.
          </p>
        </div>
        <Concepts />
        <div className="palette-strip" aria-label="Colour key">
          <span className="swatch-pill t-danger">
            <i /> Danger &amp; weaknesses
          </span>
          <span className="swatch-pill t-opportunity">
            <i /> Strengths &amp; chances
          </span>
          <span className="swatch-pill t-white">
            <i /> White&apos;s influence
          </span>
          <span className="swatch-pill t-black">
            <i /> Black&apos;s influence
          </span>
          <span className="swatch-pill t-idea">
            <i /> Ideas to test
          </span>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <div className="eyebrow">How it works</div>
            <h2 className="section-title">From photo to plan</h2>
          </div>
        </div>
        <div className="steps">
          <div className="step">
            <div className="step-num">01</div>
            <h3>Snap it</h3>
            <p>Photo, screenshot, FEN or hand setup. You confirm the board and whose move it is. We never guess that.</p>
          </div>
          <div className="step">
            <div className="step-num">02</div>
            <h3>X-ray it</h3>
            <p>Every square is checked for threats, weaknesses and strengths for both sides, while Stockfish searches the best lines.</p>
          </div>
          <div className="step">
            <div className="step-num">03</div>
            <h3>Play it out</h3>
            <p>Take the guided tour, ask “why this move?”, play through the lines, and test your own ideas against the engine.</p>
          </div>
        </div>
      </section>
    </>
  );
}
