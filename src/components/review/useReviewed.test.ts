// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Color } from "@/lib/chess/types";
import type { PositionAnalysis } from "@/lib/review/classify";
import type { GameReview } from "@/lib/review/review";
import type { FinishedReview, ReviewStatus } from "./useReview";
import { useReviewed, type ReviewedInfo } from "./useReviewed";

// React's act() needs the environment flag; jsdom gives it a document to render into.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCURACY: Record<Color, number | null> = { w: 53.1, b: 47.8 };
/** The review classified before the opening book arrives (no opening named). */
const REVIEW_BEFORE_BOOK = {} as GameReview;
/** The same review once the book has named the opening. */
const REVIEW_AFTER_BOOK = { opening: { eco: "", name: "Philidor Defense" } } as unknown as GameReview;
const POSITIONS: (PositionAnalysis | null)[] = [];

interface HarnessProps {
  status: ReviewStatus;
  accuracy: Record<Color, number | null> | null;
  bookSettled?: boolean;
  review?: GameReview;
  onReviewed: (done: FinishedReview, info: ReviewedInfo) => void;
}

/** The smallest component that uses the hook: the wiring ReviewView has, without the review UI. */
function Harness({ status, accuracy, bookSettled = true, review = REVIEW_BEFORE_BOOK, onReviewed }: HarnessProps) {
  useReviewed(status, accuracy, review, POSITIONS, bookSettled, 12, onReviewed);
  return null;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(props: HarnessProps): Promise<void> {
  await act(async () => {
    root.render(createElement(Harness, props));
  });
}

describe("useReviewed", () => {
  it("hears of a review that arrives finished (the extension's hand-off, a reload)", async () => {
    const onReviewed = vi.fn();
    await render({ status: "done", accuracy: ACCURACY, onReviewed });

    expect(onReviewed).toHaveBeenCalledTimes(1);
    expect(onReviewed).toHaveBeenCalledWith({ depth: 12, positions: POSITIONS }, { review: REVIEW_BEFORE_BOOK, accuracy: ACCURACY });
  });

  it("hears of it once, not on every render", async () => {
    const onReviewed = vi.fn();
    await render({ status: "done", accuracy: ACCURACY, onReviewed });
    await render({ status: "done", accuracy: ACCURACY, onReviewed });

    expect(onReviewed).toHaveBeenCalledTimes(1);
  });

  it("hears of a review that finishes here", async () => {
    const onReviewed = vi.fn();
    await render({ status: "running", accuracy: null, onReviewed });
    expect(onReviewed).not.toHaveBeenCalled();

    await render({ status: "done", accuracy: ACCURACY, onReviewed });
    expect(onReviewed).toHaveBeenCalledTimes(1);
  });

  it("hears again when the review is re-run at another depth", async () => {
    const onReviewed = vi.fn();
    await render({ status: "done", accuracy: ACCURACY, onReviewed });
    await render({ status: "loading", accuracy: null, onReviewed });
    await render({ status: "done", accuracy: ACCURACY, onReviewed });

    expect(onReviewed).toHaveBeenCalledTimes(2);
  });

  it("waits for the accuracy before it hears", async () => {
    const onReviewed = vi.fn();
    await render({ status: "done", accuracy: null, onReviewed });
    expect(onReviewed).not.toHaveBeenCalled();

    await render({ status: "done", accuracy: ACCURACY, onReviewed });
    expect(onReviewed).toHaveBeenCalledTimes(1);
  });

  it("waits for the opening book before hearing of a review that arrived finished", async () => {
    const onReviewed = vi.fn();
    // Handed over at mount: status is already "done" but the book is still loading.
    await render({ status: "done", accuracy: ACCURACY, bookSettled: false, review: REVIEW_BEFORE_BOOK, onReviewed });
    expect(onReviewed).not.toHaveBeenCalled();

    // The book arrives; the review is reclassified with it, and only now is it heard of.
    await render({ status: "done", accuracy: ACCURACY, bookSettled: true, review: REVIEW_AFTER_BOOK, onReviewed });
    expect(onReviewed).toHaveBeenCalledTimes(1);
    expect(onReviewed).toHaveBeenCalledWith({ depth: 12, positions: POSITIONS }, { review: REVIEW_AFTER_BOOK, accuracy: ACCURACY });
  });

  it("hears of a review that finishes here only after the book has settled too", async () => {
    const onReviewed = vi.fn();
    await render({ status: "done", accuracy: ACCURACY, bookSettled: false, onReviewed });
    expect(onReviewed).not.toHaveBeenCalled();

    await render({ status: "done", accuracy: ACCURACY, bookSettled: true, onReviewed });
    expect(onReviewed).toHaveBeenCalledTimes(1);
  });
});
