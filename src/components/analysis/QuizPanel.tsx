"use client";

import { useMemo, useState } from "react";
import type { EngineLine } from "@/lib/engine/client";
import { evalLoss } from "@/lib/engine/score";
import { buildVariation } from "@/lib/variation";
import { EvalChip } from "./bits";
import { toRef, type LineRef } from "./LinesPanel";

interface Props {
  fen: string;
  lines: EngineLine[];
  done: boolean;
  onWhy: (l: LineRef) => void;
  onWhyNot: (l: LineRef) => void;
}

/** Stable shuffle so the engine's order isn't given away. */
function shuffle<T>(xs: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function QuizPanel({ fen, lines, done, onWhy, onWhyNot }: Props) {
  const [picked, setPicked] = useState<number | null>(null);
  const options = useMemo(() => {
    const opts = lines.slice(0, 4).map((l) => ({ l, san: buildVariation(fen, l.pv.slice(0, 1)).moves[0]?.san ?? l.pv[0] }));
    return shuffle(opts, fen);
  }, [fen, lines]);

  if (!done) return <p className="muted pad">Let the analysis finish first, so the engine&apos;s choice is settled.</p>;
  if (lines.length < 2) return <p className="muted pad">Set “Lines” to 2 or more to get a choice of moves.</p>;

  const best = lines[0];
  const turn = fen.split(" ")[1] === "w" ? "White" : "Black";
  const chosen = picked !== null ? lines.find((l) => l.multipv === picked) : null;

  return (
    <div className="quiz">
      <p className="quiz-q">
        {turn} to move. <b>Which would you play?</b>
      </p>
      <div className="quiz-options">
        {options.map(({ l, san }) => {
          const reveal = picked !== null;
          const cls = !reveal ? "quiz-opt" : l.multipv === 1 ? "quiz-opt quiz-best" : l.multipv === picked ? "quiz-opt quiz-mine" : "quiz-opt quiz-dim";
          return (
            <button key={l.multipv} className={cls} onClick={() => setPicked(l.multipv)} disabled={reveal}>
              <span className="quiz-san">{san}</span>
              {reveal && (
                <span className="quiz-meta">
                  #{l.multipv} <EvalChip e={l.eval} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {chosen && (
        <div className="quiz-result" aria-live="polite">
          {chosen.multipv === 1 ? (
            <p className="verdict">That&apos;s the engine&apos;s first choice.</p>
          ) : (
            <p className={evalLoss(best.eval, chosen.eval, fen.split(" ")[1] as "w" | "b") >= 30 ? "verdict verdict-bad" : "verdict"}>
              The engine ranks it #{chosen.multipv},{" "}
              {(() => {
                const loss = evalLoss(best.eval, chosen.eval, fen.split(" ")[1] as "w" | "b");
                return loss < 30 ? "practically as good as its top move." : `about ${(loss / 100).toFixed(1)} pawns worse than its top move.`;
              })()}
            </p>
          )}
          <div className="row">
            <button className="btn btn-sm" onClick={() => onWhy(toRef(best))}>
              Why is the top move best?
            </button>
            {chosen.multipv !== 1 && (
              <button className="btn btn-ghost btn-sm" onClick={() => onWhyNot(toRef(chosen))}>
                Why not my move?
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(null)}>
              Hide answers
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
