import { CLASS_INFO, type MoveClass } from "@/lib/review/classify";

/** Glyphs drawn in a 24×24 box, centred in the badge. */
const PATHS: Partial<Record<MoveClass, string>> = {
  best: "M12 4.2l2.3 4.9 5.3.6-3.9 3.6 1 5.3L12 16l-4.7 2.6 1-5.3-3.9-3.6 5.3-.6z",
  excellent: "M8 11v8H5v-8zM10 19h6.6a2 2 0 002-1.6l1.1-5.3A1.8 1.8 0 0017.9 10H14.5l.6-3a1.7 1.7 0 00-3.1-1.2L10 10.5z",
  good: "M6 12.5l4 4 8-9",
  book: "M4 6.5c2.7-1 5.3-.8 8 .9 2.7-1.7 5.3-1.9 8-.9V18c-2.7-1-5.3-.8-8 .9-2.7-1.7-5.3-1.9-8-.9zM12 7.4v11.5",
  miss: "M7 7l10 10M17 7L7 17",
  forced: "M5 12h12M13 7l5 5-5 5",
};

const TEXT: Partial<Record<MoveClass, string>> = {
  brilliant: "!!",
  great: "!",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

const STROKED = new Set<MoveClass>(["good", "book", "miss", "forced"]);

export function ClassIcon({ cls, size = 20, title }: { cls: MoveClass; size?: number; title?: string }) {
  const info = CLASS_INFO[cls];
  const text = TEXT[cls];
  const d = PATHS[cls];
  return (
    <svg className="cls-icon" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title ?? info.label}>
      <circle cx="12" cy="12" r="11.5" fill={info.color} />
      {text ? (
        <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize={text.length > 1 ? 11.5 : 14} fontWeight={800} fill="#fff" fontFamily="var(--font-display), system-ui, sans-serif" letterSpacing={text.length > 1 ? -0.8 : 0}>
          {text}
        </text>
      ) : d ? (
        STROKED.has(cls) ? (
          <path d={d} fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d={d} fill="#fff" />
        )
      ) : null}
    </svg>
  );
}
