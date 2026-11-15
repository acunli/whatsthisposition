"use client";

import { useEffect, useRef } from "react";
import type { Color } from "@/lib/chess/types";
import type { PositionAnalysis } from "@/lib/review/classify";
import type { GameReview } from "@/lib/review/review";
import type { FinishedReview, ReviewStatus } from "./useReview";

/** What the page hears when a review is finished. */
export interface ReviewedInfo {
  review: GameReview;
  accuracy: Record<Color, number | null>;
}

/**
 * Heard of once per finished review: the review this page just finished, or one that arrived
 * finished (the extension's hand-off, a reload, a game opened from the history). A re-run at
 * another depth is a new review, so it is heard of again.
 *
 * `heard` starts false rather than from `status`: `useReview` starts at "done" when a finished
 * review is handed over, and seeding the ref from that swallowed the only time it was news.
 *
 * It also waits for the opening book to settle (loaded or failed): a handed-over review is
 * classified while `loadBook()` is still pending, so hearing of it then would save a summary
 * with no opening and different counts from the same game reviewed here. By the time the book
 * settles, `review` and `accuracy` are the corrected ones.
 */
export function useReviewed(
  status: ReviewStatus,
  accuracy: Record<Color, number | null> | null,
  review: GameReview,
  positions: (PositionAnalysis | null)[],
  bookSettled: boolean,
  depth: number,
  onReviewed?: (done: FinishedReview, info: ReviewedInfo) => void,
): void {
  const heard = useRef(false);
  useEffect(() => {
    const done = status === "done" && accuracy != null && bookSettled;
    if (done && !heard.current) onReviewed?.({ depth, positions }, { review, accuracy });
    heard.current = done;
  }, [status, accuracy, review, positions, bookSettled, depth, onReviewed]);
}
