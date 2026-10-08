/**
 * The move-label badges (Brilliant "!!", Best ★, …) as drawing data, shared by the
 * site's `ClassIcon` and the browser extension. Glyphs are drawn in a 24×24 box.
 */
import { CLASS_INFO, type MoveClass } from "./classify";

export const CLASS_PATHS: Partial<Record<MoveClass, string>> = {
  best: "M12 4.2l2.3 4.9 5.3.6-3.9 3.6 1 5.3L12 16l-4.7 2.6 1-5.3-3.9-3.6 5.3-.6z",
  excellent: "M8 11v8H5v-8zM10 19h6.6a2 2 0 002-1.6l1.1-5.3A1.8 1.8 0 0017.9 10H14.5l.6-3a1.7 1.7 0 00-3.1-1.2L10 10.5z",
  good: "M6 12.5l4 4 8-9",
  book: "M4 6.5c2.7-1 5.3-.8 8 .9 2.7-1.7 5.3-1.9 8-.9V18c-2.7-1-5.3-.8-8 .9-2.7-1.7-5.3-1.9-8-.9zM12 7.4v11.5",
  miss: "M7 7l10 10M17 7L7 17",
  forced: "M5 12h12M13 7l5 5-5 5",
};

export const CLASS_TEXT: Partial<Record<MoveClass, string>> = {
  brilliant: "!!",
  great: "!",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

export const STROKED = new Set<MoveClass>(["good", "book", "miss", "forced"]);

/** The badge as an SVG string, for pages without React. */
export function classIconSvg(cls: MoveClass, size = 20): string {
  const text = CLASS_TEXT[cls];
  const d = CLASS_PATHS[cls];
  const glyph = text
    ? `<text x="12" y="12.5" text-anchor="middle" dominant-baseline="central" font-size="${text.length > 1 ? 11.5 : 14}" font-weight="800" fill="#fff" font-family="system-ui, sans-serif" letter-spacing="${text.length > 1 ? -0.8 : 0}">${text}</text>`
    : d
      ? STROKED.has(cls)
        ? `<path d="${d}" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="${d}" fill="#fff"/>`
      : "";
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="${CLASS_INFO[cls].color}"/>${glyph}</svg>`;
}
