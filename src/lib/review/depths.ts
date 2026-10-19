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

/** The preset with this search depth, or the default. */
export const depthIndex = (depth?: number) => {
  const i = REVIEW_DEPTHS.findIndex((d) => d.depth === depth);
  return i < 0 ? DEFAULT_REVIEW_DEPTH : i;
};
