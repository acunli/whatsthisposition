import { CLASS_INFO, type MoveClass } from "@/lib/review/classify";
import { CLASS_PATHS as PATHS, CLASS_TEXT as TEXT, STROKED } from "@/lib/review/classGlyphs";


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
