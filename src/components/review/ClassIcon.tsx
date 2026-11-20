import { CLASS_INFO, type MoveClass } from "@/lib/review/classify";
import { CLASS_PATHS as PATHS, CLASS_TEXT as TEXT, STROKED } from "@/lib/review/classGlyphs";

/** A label's badge in a 24×24 box: its coloured disc and its text ("!!", "?") or drawn glyph. */
function Badge({ cls }: { cls: MoveClass }) {
  const text = TEXT[cls];
  const d = PATHS[cls];
  return (
    <>
      <circle cx="12" cy="12" r="11.5" fill={CLASS_INFO[cls].color} />
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
    </>
  );
}

export function ClassIcon({ cls, size = 20, title }: { cls: MoveClass; size?: number; title?: string }) {
  return (
    <svg className="cls-icon" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={title ?? CLASS_INFO[cls].label}>
      <Badge cls={cls} />
    </svg>
  );
}

/**
 * The badges of long server-rendered lists (a game's moves, the reviewed games): drawn once per
 * page by `ClassSprite`, each badge a short `<use>` of it. The same drawing as `ClassIcon` at a
 * sixth of the bytes, which matters on Vercel: prerendered pages are billed per 8 KB read from
 * the ISR cache, and a game's 80-odd badges were a third of its page.
 */
export function ClassMark({ cls, size = 20 }: { cls: MoveClass; size?: number }) {
  return (
    <svg className="cls-icon" width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={CLASS_INFO[cls].label}>
      <use href={`#cls-badge-${cls}`} />
    </svg>
  );
}

/** The drawings `ClassMark` uses, once per page that shows any: pass the labels it shows. */
export function ClassSprite({ classes }: { classes: Iterable<MoveClass | null | undefined> }) {
  const used = [...new Set(classes)].filter((c): c is MoveClass => !!c && c in CLASS_INFO);
  if (!used.length) return null;
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      {used.map((cls) => (
        <symbol key={cls} id={`cls-badge-${cls}`} viewBox="0 0 24 24">
          <Badge cls={cls} />
        </symbol>
      ))}
    </svg>
  );
}
