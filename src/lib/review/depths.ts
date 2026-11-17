/** Review search depths, shared by the site and the browser extension. */
export const REVIEW_DEPTHS = [
  { label: "Fast", depth: 12, note: "a few seconds" },
  { label: "Standard", depth: 14, note: "the default" },
  { label: "Thorough", depth: 18, note: "slower, sharper" },
];

/** Reviews start at Standard (the owner's choice); the browser extension uses the same depth. */
export const DEFAULT_REVIEW_DEPTH = 1;

/** Critical positions are searched this much deeper in the second pass. */
export const VERIFY_EXTRA = 4;

/**
 * The most nodes a review search at `depth` may use. A few positions make the lite engine's search
 * explode (a trapped king, a long checking sequence): one depth-14 search took 14M+ nodes, minutes
 * in a browser, while the review sat on that position. Measured on 1,115 positions of Ay7u's games
 * (2026-11-17, MultiPV 2, fresh hash): depth 14 needs a median 133k nodes, p99 600k, every normal
 * search under 1.8M; depth 18 a median 750k, p99 2.9M, all under 6.5M. The cap, 3M at depth 14
 * and doubling every two plies (12M at 18), sits far above all of those, so it only stops the
 * explosions, which then end at the deepest depth they finished.
 */
export const reviewNodes = (depth: number) => Math.round(3_000_000 * 2 ** ((depth - 14) / 2));

/** The preset with this search depth, or the default. */
export const depthIndex = (depth?: number) => {
  const i = REVIEW_DEPTHS.findIndex((d) => d.depth === depth);
  return i < 0 ? DEFAULT_REVIEW_DEPTH : i;
};
