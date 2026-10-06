"use client";

import type { Marks } from "@/lib/facts/types";
import type { OpeningStory } from "@/lib/review/explain";
import { Points } from "./MoveInsight";

/** The opening as a whole: theory followed, where it ended, and what strong players play there. */
export function OpeningCard({ story, masters, onGo, onHover }: { story: OpeningStory; masters: { games: number } | null; onGo: (ply: number) => void; onHover: (m: Marks | null) => void }) {
  return (
    <section className="rv-opening" aria-label="The opening">
      <div className="rv-opening-head">
        <span className="eyebrow">The opening{story.eco ? ` · ${story.eco}` : ""}</span>
        {story.leftPly != null && (
          <button className="linkish small" onClick={() => onGo(story.leftPly!)}>
            Go to where it left theory
          </button>
        )}
      </div>
      {story.name && <h3 className="rv-opening-name">{story.name}</h3>}
      <Points items={story.points} onHover={onHover} />
      {masters && (
        <p className="small muted">
          Theory: {masters.games.toLocaleString("en-US")} games between strong players (over-the-board broadcasts and the Lichess Elite Database). Underlined moves show
          how the line goes when you hover or tap them.
        </p>
      )}
    </section>
  );
}
