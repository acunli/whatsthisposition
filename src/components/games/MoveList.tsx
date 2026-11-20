"use client";

import { ClassMark } from "@/components/review/ClassIcon";
import type { Color } from "@/lib/chess/types";
import { CLASS_INFO, type MoveClass } from "@/lib/review/classify";

/**
 * A reviewed game's moves, each with its label's badge (the page draws the badges once with
 * `ClassSprite`). A client component only so the page's payload carries the moves as two short
 * lists (~8 bytes a move) instead of the rendered list (~330 bytes a move): the HTML is the same,
 * but on Vercel a prerendered page is billed per 8 KB read from the ISR cache, and the list was
 * a third of a game's page.
 */
export function MoveList({ sans, labels, first }: { sans: string[]; labels: MoveClass[]; first: { num: number; color: Color } }) {
  // Colours alternate from the first move; a move number goes up after Black's move.
  const rows: { num: number; w?: number; b?: number }[] = [];
  let num = first.num;
  let color = first.color;
  sans.forEach((_, i) => {
    if (color === "w" || !rows.length) rows.push({ num });
    rows[rows.length - 1][color] = i;
    if (color === "b") num++;
    color = color === "w" ? "b" : "w";
  });
  const cell = (i?: number) => {
    if (i === undefined) return <span />;
    const cls = labels[i];
    return (
      <span className="game-move" title={CLASS_INFO[cls].label}>
        <ClassMark cls={cls} size={14} />
        {sans[i]}
      </span>
    );
  };
  return (
    <ol className="game-moves">
      {rows.map((r) => (
        <li key={r.num}>
          <span className="muted mono">{r.num}.</span>
          {cell(r.w)}
          {cell(r.b)}
        </li>
      ))}
    </ol>
  );
}
