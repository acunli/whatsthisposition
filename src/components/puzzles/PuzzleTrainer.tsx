"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PlayBoard } from "../PlayBoard";
import { placementFromFen } from "@/lib/chess/fen";
import { COLOR_NAME, other, type Square } from "@/lib/chess/types";
import { getBrowserEngine } from "@/lib/engine/browser";
import { emptyMarks, type Marks } from "@/lib/facts/types";
import { judgeAtOnce, judgeSearched } from "@/lib/puzzles/judge";
import { weaknessName } from "@/lib/puzzles/profile";
import type { Outcome, Puzzle, PuzzleSet, Weakness } from "@/lib/puzzles/types";
import { buildVariation } from "@/lib/variation";

/** The engine looks this deep at a move that isn't the answer, to see whether it is as good. */
const CHECK_DEPTH = 12;
/** How long each move of the answer stays on the board when it is played out. */
const STEP_MS = 950;

interface Props {
  set: PuzzleSet;
  done: Record<string, Outcome>;
  at: number;
  onAt: (i: number) => void;
  onOutcome: (id: string, o: Outcome) => void;
  onNewSet: () => void;
}

const moveLabel = (m: { moveNumber: number; color: "w" | "b"; san: string }) => `${m.moveNumber}${m.color === "w" ? "." : "…"}${m.san}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Phase = "solve" | "checking" | "solved" | "shown";
interface Note {
  tone: "good" | "bad" | "info";
  text: string;
}

/** One puzzle on the board. Keyed by the puzzle, so each one starts clean. */
function Solve({ puzzle, first, onOutcome, onNext, last }: { puzzle: Puzzle; first: boolean; onOutcome: (o: Outcome) => void; onNext: () => void; last: boolean }) {
  const [phase, setPhase] = useState<Phase>("solve");
  const [note, setNote] = useState<Note | null>(null);
  const [tries, setTries] = useState(0);
  const [hint, setHint] = useState(0);
  // How many moves of the answer are on the board once it is being played out.
  const [shownPlies, setShownPlies] = useState(0);
  const pending = useRef<{ cancel: () => void } | null>(null);

  const answer = useMemo(() => buildVariation(puzzle.fen, puzzle.solution, 7), [puzzle]);
  const key = answer.moves[0];
  const over = phase === "solved" || phase === "shown";
  const fen = over && shownPlies > 0 ? answer.moves[shownPlies - 1].fenAfter : puzzle.fen;
  const placement = useMemo(() => placementFromFen(fen), [fen]);
  const solverName = COLOR_NAME[puzzle.solver];

  useEffect(() => () => pending.current?.cancel(), []);

  // The answer plays itself out, a move at a time.
  useEffect(() => {
    if (!over || shownPlies >= answer.moves.length) return;
    const t = setTimeout(() => setShownPlies((n) => n + 1), shownPlies === 0 ? 150 : STEP_MS);
    return () => clearTimeout(t);
  }, [over, shownPlies, answer.moves.length]);

  const finish = (how: Phase, o: Outcome, text: string, tone: Note["tone"]) => {
    setPhase(how);
    setNote({ tone, text });
    setShownPlies(how === "solved" ? 1 : 0);
    if (first) onOutcome(o);
  };

  const onMove = (uci: string) => {
    if (phase !== "solve") return;
    const mine = buildVariation(puzzle.fen, [uci], 1).moves[0];
    if (!mine) return;
    const quick = judgeAtOnce(uci, puzzle);
    if (quick === "answer") return finish("solved", tries === 0 && hint === 0 ? "first" : "later", tries === 0 && hint === 0 ? "Right, first time." : "That's it.", "good");
    if (quick === "game-move") {
      setTries((n) => n + 1);
      return setNote({ tone: "bad", text: `${moveLabel(mine)} is the move from the game. ${puzzle.inGame.replace(/^In the game: \S+ ?/, "It went ")}` });
    }
    setPhase("checking");
    setNote({ tone: "info", text: `Checking ${moveLabel(mine)}…` });
    try {
      const handle = getBrowserEngine().analyze({ fen: puzzle.fen, depth: CHECK_DEPTH, multipv: 1, searchmoves: [uci] });
      pending.current = handle;
      handle.promise.then(
        (snap) => {
          if (snap.cancelled) return;
          const line = snap.lines[0];
          const verdict = line ? judgeSearched(puzzle.eval, line.eval, puzzle.solver) : "wrong";
          if (verdict === "as-good") {
            setPhase("solved");
            setNote({ tone: "good", text: `${moveLabel(mine)} is as good as the engine's ${key ? moveLabel(key) : "move"}. Here is the engine's line.` });
            setShownPlies(0);
            if (first) onOutcome(tries === 0 && hint === 0 ? "first" : "later");
            return;
          }
          const reply = line ? buildVariation(puzzle.fen, line.pv, 2).moves[1] : undefined;
          setTries((n) => n + 1);
          setPhase("solve");
          setNote({ tone: "bad", text: `${moveLabel(mine)} isn't it${reply ? `: ${COLOR_NAME[other(puzzle.solver)]} answers ${moveLabel(reply)}` : ""}. Try again.` });
        },
        () => {
          setPhase("solve");
          setNote({ tone: "bad", text: `${moveLabel(mine)} isn't the move. Try again.` });
        },
      );
    } catch {
      setPhase("solve");
      setNote({ tone: "bad", text: `${moveLabel(mine)} isn't the move. Try again.` });
    }
  };

  const marks: Marks = useMemo(() => {
    const m = emptyMarks();
    if (phase !== "solve" || !key) return m;
    if (hint >= 1) m.squares.push({ sq: key.from, tone: "opportunity", style: "ring" });
    if (hint >= 2) m.squares.push({ sq: key.to, tone: "opportunity", style: "dashed" });
    return m;
  }, [phase, hint, key]);

  const lastShown = over && shownPlies > 0 ? answer.moves[shownPlies - 1] : null;
  const justPlayed = puzzle.task === "punish" ? { from: puzzle.played.uci.slice(0, 2) as Square, to: puzzle.played.uci.slice(2, 4) as Square } : null;
  const lastMove = lastShown ? { from: lastShown.from, to: lastShown.to } : !over ? justPlayed : null;

  return (
    <>
      <section className="pz-board" aria-label="Puzzle board">
        <PlayBoard
          fen={fen}
          onMove={phase === "solve" ? onMove : undefined}
          placement={placement}
          orientation={puzzle.solver}
          marks={marks}
          revealKey={`${puzzle.id}-${hint}`}
          lastMove={lastMove}
          animate={lastShown ? { from: lastShown.from, to: lastShown.to, key: `${puzzle.id}-${shownPlies}` } : null}
          label={`Puzzle position, ${solverName} to move`}
          annotate={false}
        />
      </section>
      <section className="pz-card" aria-live="polite">
        <p className="pz-task">
          <span className={`side-dot side-${puzzle.solver}`} aria-hidden />
          <b>{solverName} to move.</b>{" "}
          {puzzle.task === "better" ? `In the game ${puzzle.played.label} was played here. Find the move that was there.` : `${puzzle.played.label} has just been played. Take ${solverName}'s side and show why it was a mistake.`}
        </p>
        {note && <p className={`pz-note pz-note-${note.tone}`}>{note.text}</p>}
        {over && (
          <div className="pz-after">
            <p>{puzzle.point}</p>
            {puzzle.task === "better" && <p className="muted">{puzzle.inGame}</p>}
            <p className="small muted">
              This one counts under <b>{weaknessName(puzzle.key).toLowerCase()}</b>, from {puzzle.source.white} vs {puzzle.source.black}
              {puzzle.source.url ? (
                <>
                  {" "}
                  (
                  <a href={puzzle.source.url} target="_blank" rel="noopener noreferrer">
                    the game
                  </a>
                  )
                </>
              ) : null}
              .
            </p>
          </div>
        )}
        <div className="pz-actions">
          {!over ? (
            <>
              <button className="btn btn-sm" onClick={() => setHint((h) => Math.min(2, h + 1))} disabled={phase === "checking" || hint >= 2}>
                {hint === 0 ? "Hint: which piece" : "Hint: where to"}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={phase === "checking"}
                onClick={() => finish("shown", "shown", key ? `The move is ${moveLabel(key)}.` : "Here is the line.", "info")}
              >
                Show the answer
              </button>
              <button className="btn btn-sm btn-ghost" onClick={onNext} disabled={last}>
                Skip
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" onClick={onNext} disabled={last} autoFocus>
                {last ? "Last puzzle" : "Next puzzle"}
              </button>
              {shownPlies >= answer.moves.length && answer.moves.length > 1 && (
                <button className="btn btn-sm btn-ghost" onClick={() => setShownPlies(0)}>
                  Play the line again
                </button>
              )}
            </>
          )}
        </div>
      </section>
    </>
  );
}

function Report({ set, done, onPractise }: { set: PuzzleSet; done: Record<string, Outcome>; onPractise: (w: Weakness) => void }) {
  const [all, setAll] = useState(false);
  const total = set.weaknesses.reduce((t, w) => t + w.loss, 0) || 1;
  const list = all ? set.weaknesses : set.weaknesses.slice(0, 4);
  return (
    <section className="pz-report" aria-label="What the games show">
      <h2 className="read-h">What these games show</h2>
      <p className="small muted pz-report-sum">
        {plural(set.slips.length, "mistake")} in {set.player ? `${set.player}'s ` : ""}
        {plural(set.moves, "move")} over {plural(set.games, "game")}, grouped by what went wrong. The costliest comes first.
      </p>
      <ul className="pz-weak">
        {list.map((w) => {
          const left = w.puzzles.filter((id) => !done[id]).length;
          return (
            <li key={w.key}>
              <div className="pz-weak-head">
                <b>{w.name}</b>
                <span className="small muted">
                  {w.count === 1 ? "once" : `${w.count} times`}
                  {w.games > 1 ? ` in ${w.games} games` : ""}
                </span>
              </div>
              <div className="pz-bar" role="img" aria-label={`${Math.round((100 * w.loss) / total)}% of what was given away`}>
                <span style={{ width: `${Math.max(3, (100 * w.loss) / total)}%` }} />
              </div>
              <p>{w.text}</p>
              {w.advice && <p className="muted">{w.advice}</p>}
              {w.puzzles.length > 0 && (
                <button className="linkish" onClick={() => onPractise(w)}>
                  {left ? `Practise this: ${plural(left, "puzzle")} left` : `Practise this again: ${plural(w.puzzles.length, "puzzle")}`}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {set.weaknesses.length > 4 && (
        <button className="linkish" onClick={() => setAll((x) => !x)}>
          {all ? "Show the main ones" : `Show all ${set.weaknesses.length}`}
        </button>
      )}
    </section>
  );
}

/** The trainer: one puzzle at a time, the strip of all of them, and what the games showed. */
export function PuzzleTrainer({ set, done, at, onAt, onOutcome, onNewSet }: Props) {
  const puzzle = set.puzzles[at];
  const solved = set.puzzles.filter((p) => done[p.id] === "first" || done[p.id] === "later").length;
  const firstTry = set.puzzles.filter((p) => done[p.id] === "first").length;
  const finished = set.puzzles.length > 0 && set.puzzles.every((p) => done[p.id]);

  return (
    <div className="pz-train">
      {puzzle ? (
        <Solve key={`${puzzle.id}-${at}`} puzzle={puzzle} first={!done[puzzle.id]} onOutcome={(o) => onOutcome(puzzle.id, o)} onNext={() => onAt(Math.min(set.puzzles.length - 1, at + 1))} last={at >= set.puzzles.length - 1} />
      ) : (
        <section className="pz-card pz-none">
          <p>
            <b>No puzzles came out of these games.</b>{" "}
            {set.slips.length ? "The mistakes in them had no single clear answer to look for, which is what a puzzle needs. They are still counted below." : "No mistakes or blunders were found in them. Try more games, or longer ones."}
          </p>
        </section>
      )}
      <aside className="pz-side">
        <section className="pz-progress" aria-label="Progress">
          <div className="pz-progress-head">
            <h2 className="read-h">
              {set.puzzles.length ? `Puzzle ${at + 1} of ${set.puzzles.length}` : "No puzzles"}
            </h2>
            <button className="btn btn-sm btn-ghost" onClick={onNewSet}>
              New set
            </button>
          </div>
          {set.puzzles.length > 0 && (
            <>
              <ol className="pz-strip">
                {set.puzzles.map((p, i) => (
                  <li key={p.id}>
                    <button
                      className={`pz-dot ${done[p.id] ? `pz-dot-${done[p.id]}` : ""}`}
                      aria-current={i === at}
                      aria-label={`Puzzle ${i + 1}${done[p.id] ? `, ${done[p.id] === "first" ? "solved first time" : done[p.id] === "later" ? "solved" : "answer shown"}` : ""}`}
                      onClick={() => onAt(i)}
                    />
                  </li>
                ))}
              </ol>
              <p className="small muted pz-score">
                {solved} solved, {firstTry} at the first try.
                {finished ? " That is the whole set: make a new one from your next games, or go through these again." : ""}
              </p>
            </>
          )}
        </section>
        <Report
          set={set}
          done={done}
          onPractise={(w) => {
            const next = set.puzzles.findIndex((p) => p.key === w.key && !done[p.id]);
            const any = set.puzzles.findIndex((p) => p.key === w.key);
            if (next >= 0 || any >= 0) onAt(next >= 0 ? next : any);
          }}
        />
      </aside>
    </div>
  );
}
