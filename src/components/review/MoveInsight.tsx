"use client";

import type { Evaluation } from "@/lib/engine/score";
import type { InsightPoint } from "@/lib/facts/explain";
import type { Marks, PeekLine } from "@/lib/facts/types";
import type { Idea, MoveReasoning } from "@/lib/reason/types";
import { isBad, type ClassifiedMove } from "@/lib/review/classify";
import type { MoveStory } from "@/lib/review/explain";
import { EvidenceTag } from "../analysis/bits";
import { Peek, PeekText } from "../peek/Peek";
import { WhyBrilliant } from "./WhyBrilliant";
import type { ReasoningEntry } from "./useMoveReasoning";

interface Props {
  cm: ClassifiedMove;
  story: MoveStory;
  entry: ReasoningEntry | null;
  onHover: (m: Marks | null) => void;
  onPlay: (title: string, fen: string, pv: string[], e: Evaluation) => void;
}

type Point = Pick<InsightPoint, "text" | "tone" | "evidence" | "marks" | "line" | "lines">;

const hasMarks = (m: Marks) => m.arrows.length > 0 || m.squares.length > 0 || (m.bands?.length ?? 0) > 0;

export function Points({ items, onHover }: { items: Point[]; onHover: (m: Marks | null) => void }) {
  if (!items.length) return null;
  return (
    <ul className="rv-points">
      {items.map((p, i) => (
        <li key={i} className={`t-${p.tone}`} onMouseEnter={() => onHover(hasMarks(p.marks) ? p.marks : null)} onMouseLeave={() => onHover(null)}>
          <span>
            <PeekText text={p.text} line={p.line} lines={p.lines} />
          </span>{" "}
          <EvidenceTag e={p.evidence} />
        </li>
      ))}
    </ul>
  );
}

const fromIdea = (i: Idea): Point => ({ text: i.text, tone: i.tone, evidence: i.evidence, marks: i.marks, line: i.line });
const engineNote = (text: string, marks: Marks, tone: Point["tone"] = "info", line?: PeekLine): Point => ({ text, tone, evidence: "engine", marks, line });

/** Opening theory: what strong players do here (book moves) or play instead (the move that left the book). */
function Opening({ story, onHover }: { story: MoveStory; onHover: (m: Marks | null) => void }) {
  if (!story.opening?.length) return null;
  return (
    <>
      <p className="rv-section">Opening theory</p>
      <Points items={story.opening} onHover={onHover} />
    </>
  );
}

/** An engine line as a sentence, hoverable to watch it. */
const LineNote = ({ line }: { line: { text: string; line?: PeekLine } }) => (
  <p className="rv-line">
    <PeekText text={line.text} line={line.line} />
  </p>
);

/** Ideas worth listing: strongest first, no near-duplicates, downsides only when they matter. */
function listIdeas(r: MoveReasoning, max: number) {
  const seen = new Set<string>();
  return r.ideas
    .filter((i) => i.tone !== "danger" || i.weight >= 6)
    .filter((i) => {
      const k = i.kind + i.phrase.split(" ").slice(0, 2).join(" ");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, max)
    .map(fromIdea);
}

export function MoveInsight({ cm, story, entry, onHover, onPlay }: Props) {
  const r = entry?.status === "done" ? entry.data : null;
  const thinking = entry?.status === "pending";
  const bad = isBad(cm.cls);

  // Until the deeper look is ready (or if it fails), the quick explanation stands in.
  if (!r?.played) {
    return (
      <>
        <p className="rv-headline">{story.headline}</p>
        <Points items={story.points} onHover={onHover} />
        <Opening story={story} onHover={onHover} />
        {thinking && (
          <p className="rv-thinking">
            {cm.cls === "brilliant"
              ? "Working out why the sacrifice works: what happens if it's taken, and why the obvious move falls short…"
              : "Looking deeper: what the move threatens, what it stops, and how the opponent answers…"}
          </p>
        )}
        <Actions cm={cm} better={story.better ? { san: story.better.san, pv: story.better.pv } : null} onPlay={onPlay} />
      </>
    );
  }

  const p = r.played;
  if (cm.cls === "brilliant" && r.sacrifice?.steps.length) {
    return (
      <>
        <p className="rv-headline">{r.sacrifice.headline}</p>
        <WhyBrilliant x={r.sacrifice} onHover={onHover} />
        <Opening story={story} onHover={onHover} />
        <Actions cm={cm} better={null} onPlay={onPlay} />
        <span className="small muted">Hover a step to see it on the board; hover the moves to watch the line.</span>
      </>
    );
  }
  if (!bad) {
    const headline = cm.cls === "brilliant" ? story.headline : p.headline;
    const items = cm.cls === "brilliant" ? [...story.points.slice(0, 2), ...listIdeas(p, 3)] : listIdeas(p, 5);
    return (
      <>
        <p className="rv-headline">{headline}</p>
        <Points items={items} onHover={onHover} />
        {p.line && <LineNote line={p.line} />}
        {p.alternatives[0] && (
          <>
            <p className="rv-section">Why not something else?</p>
            <Points items={[engineNote(p.alternatives[0].text, p.alternatives[0].marks, "danger", p.alternatives[0].line)]} onHover={onHover} />
          </>
        )}
        <Opening story={story} onHover={onHover} />
        <Actions cm={cm} better={null} onPlay={onPlay} alt={p.alternatives[0] ? { san: p.alternatives[0].san, pv: p.alternatives[0].pv } : null} />
      </>
    );
  }

  // A mistake: what goes wrong first, then what it was going for, then the better move and why.
  const wrong: Point[] = [];
  if (p.refutation) wrong.push(engineNote(p.refutation.text, p.refutation.marks, "danger", p.refutation.line));
  if (p.opponentThreat && !p.opponentThreat.parried)
    wrong.push(
      engineNote(`It doesn't deal with the threat: ${p.opponentThreat.text.charAt(0).toLowerCase()}${p.opponentThreat.text.slice(1)}`, p.opponentThreat.marks, "danger", p.opponentThreat.line),
    );
  wrong.push(...p.ideas.filter((i) => i.tone === "danger" && i.weight >= 5).slice(0, 2).map(fromIdea));
  const intent = p.ideas.find((i) => i.tone !== "danger" && i.weight >= 10 && i.kind !== "prepare");
  const b = r.better;
  return (
    <>
      <p className="rv-headline">{story.headline}</p>
      <p className="rv-section">What goes wrong</p>
      <Points items={wrong} onHover={onHover} />
      {p.line && <LineNote line={p.line} />}
      {intent && <p className="rv-intent">The idea was that it {intent.phrase}, but the reply above comes first.</p>}
      {b && (
        <>
          <p className="rv-section">
            Better:{" "}
            <b>
              <Peek line={cm.bestLine ? { fen: cm.move.fenBefore, pv: cm.bestLine.pv } : null}>{b.label}</Peek>
            </b>
          </p>
          <p className="rv-better">{b.headline}</p>
          <Points items={listIdeas(b, 3)} onHover={onHover} />
          {b.line && <LineNote line={b.line} />}
        </>
      )}
      <Opening story={story} onHover={onHover} />
      <Actions cm={cm} better={b && cm.bestLine ? { san: b.san, pv: cm.bestLine.pv } : null} onPlay={onPlay} />
      <span className="small muted">Gold arrow on the board: the engine&apos;s move. Hover a reason to see it.</span>
    </>
  );
}

function Actions({ cm, better, alt, onPlay }: { cm: ClassifiedMove; better: { san: string; pv: string[] } | null; alt?: { san: string; pv: string[] } | null; onPlay: Props["onPlay"] }) {
  return (
    <div className="rv-actions">
      {better && (
        <button className="btn btn-sm" onClick={() => onPlay(`Better was ${better.san}`, cm.move.fenBefore, better.pv, cm.evalBefore)}>
          ▶ Play {better.san} instead
        </button>
      )}
      {cm.replyLine && (
        <button className="btn btn-sm btn-ghost" onClick={() => onPlay("What happens next (engine)", cm.move.fenAfter, cm.replyLine!.pv, cm.evalAfter)}>
          ▶ Engine&apos;s follow-up
        </button>
      )}
      {alt && cm.secondLine && (
        <button className="btn btn-sm btn-ghost" onClick={() => onPlay(`If ${alt.san} instead`, cm.move.fenBefore, alt.pv, cm.secondLine!.eval)}>
          ▶ Try {alt.san}
        </button>
      )}
    </div>
  );
}
